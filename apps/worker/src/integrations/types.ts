import type { ConfigFieldInfo, DrawOp, IntegrationProvider } from '@marklayer/types';

/** One annotation, reduced to the line a destination should show for it. */
export interface Notifiable {
  kind: string;
  author: string;
  text: string;
  priority?: string | null;
}

/** Every event tag, for the callers that need to try each in turn. */
export const ROOM_EVENT_TYPES = ['annotations.created', 'annotation.pushed'] as const;

/**
 * Something that happened in a room, worth telling the outside about.
 *
 * Every event carries `items`, so a destination that only wants to print the
 * annotations never has to care which one it got. The tag exists for the
 * destinations that do care: an issue tracker files on `annotation.pushed` and
 * declines `annotations.created`, because an issue per comment, unasked, is how
 * a team ends up turning the integration off.
 *
 * Derived from `ROOM_EVENT_TYPES` rather than restating it, so a new tag cannot
 * be added to one and forgotten in the other.
 */
export type RoomEvent = { type: (typeof ROOM_EVENT_TYPES)[number]; items: Notifiable[] };

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
 * costs the client bundle nothing — see docs/adr/0003. Defined in
 * `packages/types` because it is the shape `GET /providers` serves and the
 * client parses; `type` in particular decides whether a value may be stored, and
 * it has to mean the same thing at both ends.
 */
export type ConfigField = ConfigFieldInfo;

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
   * When this destination fires. `auto` posts every batch the room produces;
   * `manual` only ever sends when a person pushes one annotation at it.
   *
   * The client reads this to decide which destinations belong in the "file this
   * thread" menu, so the distinction lives in the manifest with everything else
   * the UI needs rather than as a list of ids the client has to keep in step.
   */
  trigger: 'auto' | 'manual';
  /**
   * Describe the request for this event, or null to decline it.
   *
   * Pure by contract: no provider calls fetch, so no provider can open an egress
   * path. This is the whole security argument of the integrations layer.
   */
  render(args: RenderArgs): OutboundRequest | null;
  /**
   * Pull the created thing's URL out of a success body, for the destinations
   * that make one. Optional because a chat hook creates nothing to link to.
   *
   * Pure, like `render`: it is handed a parsed body and returns a string. The
   * caller does the reading, so this cannot become a second egress path.
   */
  parseResult?(body: unknown): string | null;
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
