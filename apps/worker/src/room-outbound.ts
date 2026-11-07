import type { DrawOp } from '@marklayer/types/ops';
import type { IntegrationProvider } from '../shared/integrations';
import { createBreaker } from './breaker';
import { deliver, parseIntegrations } from './integrations/deliver';
import { notifiableFrom } from './integrations/types';
import { annotationStore } from './store';

/** Consecutive all-failed flushes before a destination stops being asked. Unlike the fetch relay's, it never re-tests. */
const MAX_FAILURES = 3;

/** The room a flush is for. */
export interface OutboundRoom {
  db: D1Database;
  roomId: string;
  roomUrl: string;
  origin: string;
  ops: () => DrawOp[];
}

/** Null: nothing in this batch was for it. */
type Send = (batch: DrawOp[]) => Promise<{ sent: number; failed: number } | null>;

/** A destination with its own wiring, beside the webhook providers every room can list. */
export interface OutboundDestination {
  /** The webhook provider it stands in for on a room that uses it: one post per channel (D5). */
  replaces: IntegrationProvider;
  /** How this room sends here, or null if it does not use it. Asked every flush, even with the breaker open. */
  open: (room: OutboundRoom) => Promise<Send | null>;
}

/**
 * What a room sends out: new annotations, batched on the room's own flush alarm
 * so ten comments in a burst arrive as one message. One queue, one `flush`, and
 * every destination behind it, which is what stops a room posting twice.
 */
export class OutboundQueue {
  private pending: DrawOp[] = [];
  private readonly delivery = createBreaker({ trips: MAX_FAILURES });
  private readonly destinations: { destination: OutboundDestination; breaker: ReturnType<typeof createBreaker> }[];

  constructor(destinations: OutboundDestination[]) {
    this.destinations = destinations.map((destination) => ({
      destination,
      breaker: createBreaker({ trips: MAX_FAILURES }),
    }));
  }

  queue(op: DrawOp): void {
    if (notifiableFrom(op)) this.pending.push(op);
  }

  /**
   * Drains before awaiting anything: a send that fails must not replay the same
   * annotations on the next flush, and a slow send must not block the ops
   * arriving while it is in flight. A room past the breaker still discards each
   * batch rather than accumulating every comment it ever sees.
   */
  async flush({
    db,
    roomId,
    origin,
    pageUrl,
    ops,
  }: {
    db: D1Database;
    roomId: string;
    origin: string;
    pageUrl: string | null;
    ops: () => DrawOp[];
  }): Promise<void> {
    if (this.pending.length === 0) return;
    const batch = this.pending;
    this.pending = [];
    const roomUrl = `${origin}/s/${roomId}`;

    // These first, because which ones the room uses decides what the providers get.
    const replaced = new Set<IntegrationProvider>();
    for (const { destination, breaker } of this.destinations) {
      const send = await destination.open({ db, roomId, roomUrl, origin, ops });
      if (!send) continue;
      replaced.add(destination.replaces);
      if (!breaker.admits()) continue;
      const result = await send(batch);
      if (!result) continue;
      if (result.sent > 0 || result.failed === 0) breaker.succeeded();
      else breaker.failed();
    }

    if (!this.delivery.admits()) return;
    const row = await annotationStore(db).getIntegrations(roomId);
    const integrations = parseIntegrations(row?.integrations ?? null).filter((i) => !replaced.has(i.provider));
    if (integrations.length === 0) return;
    const items = batch.flatMap((op) => {
      const item = notifiableFrom(op);
      return item ? [item] : [];
    });
    const { sent } = await deliver({
      integrations,
      event: { type: 'annotations.created', items },
      roomUrl,
      pageUrl,
    });
    // One destination succeeding is enough to say the room is still wired up.
    if (sent > 0) this.delivery.succeeded();
    else this.delivery.failed();
  }
}
