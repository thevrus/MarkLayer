import type { DrawOp, IntegrationProvider } from '@marklayer/types';

/** One annotation, reduced to the line a destination should show for it. */
export interface Notifiable {
  kind: string;
  author: string;
  text: string;
  priority?: string | null;
}

/** Something that happened in a room, worth telling the outside about. */
export type RoomEvent = { type: 'annotations.created'; items: Notifiable[] };

/** Everything a provider is given to render one event. */
export interface RenderArgs {
  event: RoomEvent;
  config: unknown;
  roomUrl: string;
  pageUrl: string | null;
}

/** A request a provider wants made. Describing one is all a provider may do. */
export interface OutboundRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

/**
 * One field of a provider's config, as the client needs to render it.
 *
 * The client ships a single generic form driven by this, so adding a provider
 * costs the client bundle nothing — see docs/adr/0003.
 */
export interface ConfigField {
  name: string;
  label: string;
  type: 'url' | 'text';
  placeholder?: string;
  help?: string;
  helpUrl?: string;
}

export interface Provider {
  id: IntegrationProvider;
  label: string;
  /** One line the UI shows under the provider's name. */
  blurb: string;
  fields: ConfigField[];
  /**
   * Hosts this provider may reach. Empty means "any public host", which is then
   * subject to the shared private-address guard instead. Checked by `deliver`
   * against the URL the provider returns — never by the provider itself.
   */
  allowedHosts: readonly string[];
  /**
   * Describe the request for this event, or null to decline it.
   *
   * Pure by contract: no provider calls fetch, so no provider can open an egress
   * path. This is the whole security argument of the integrations layer.
   */
  render(args: RenderArgs): OutboundRequest | null;
}

const MAX_LINES = 8;
const MAX_TEXT = 300;

const truncate = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/** One annotation as a single clean line, whatever whitespace the author used. */
export const oneLine = (s: string) => truncate(s.replace(/\s+/g, ' ').trim(), MAX_TEXT);

/**
 * The batch, trimmed to what a chat message should carry.
 *
 * Shared by every provider so a burst of feedback reads the same everywhere and
 * no destination can be flooded by one busy room.
 */
export function summarize(items: Notifiable[]): { shown: Notifiable[]; overflow: number; heading: string } {
  const shown = items.slice(0, MAX_LINES);
  return {
    shown,
    overflow: items.length - shown.length,
    heading: items.length === 1 ? '1 new annotation' : `${items.length} new annotations`,
  };
}

/**
 * The annotations worth interrupting someone for: the ones carrying words a
 * person wrote. A pen stroke or a ruler guide is real work, but it says nothing
 * on its own, and a channel full of "someone drew a line" is a channel people mute.
 */
export function notifiableFrom(op: DrawOp): Notifiable | null {
  const author = ('author' in op && op.author) || 'Someone';
  const priority = 'priority' in op ? op.priority : null;
  if (op.tool === 'comment') {
    if (!op.text.trim()) return null;
    return { kind: op.parentId ? 'Reply' : 'Comment', author, text: op.text, priority };
  }
  if (op.tool === 'area') {
    if (!op.comment?.trim()) return null;
    return { kind: 'Area note', author, text: op.comment, priority };
  }
  if (op.tool === 'selection') {
    const body = op.suggestion ? `“${op.text}” → “${op.suggestion}”` : op.comment;
    if (!body?.trim()) return null;
    return { kind: op.suggestion ? 'Suggested edit' : 'Selection', author, text: body, priority };
  }
  if (op.tool === 'inspect') {
    if (!op.comment?.trim()) return null;
    return { kind: 'Element', author, text: op.comment, priority };
  }
  return null;
}
