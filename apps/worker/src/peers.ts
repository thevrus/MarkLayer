import { z } from 'zod/mini';

/**
 * What a socket carries as its attachment.
 *
 * A schema rather than an interface plus a hand-written guard: the attachment
 * comes back off the platform as `unknown` and has to be parsed, and the guard
 * this replaces needed six casts to convince the checker of what it had proven.
 */
export const peerInfoSchema = z.object({
  /** Per-connection. Two tabs of one browser are two peers. */
  id: z.string(),
  /**
   * The client's own stable id, when it announced one. Broadcast so peers can
   * address each other across reconnects — a mention has to keep pointing at the
   * right person after they close the tab and come back under a fresh `id`.
   */
  uid: z.optional(z.string()),
  name: z.string(),
  color: z.string(),
  /**
   * Connect time, and what this peer has done since. Kept on the attachment
   * rather than in an instance field because the attachment is the one piece of
   * per-socket state that survives hibernation — and an agent that idles in
   * `watch` mode hibernates the room almost every time, which is exactly how
   * the in-memory session counters came to report nothing at all.
   *
   * All optional: a socket that connected before this shipped parses fine.
   */
  joinedAt: z.optional(z.number()),
  ops: z.optional(z.number()),
  updates: z.optional(z.number()),
});

export type PeerInfo = z.infer<typeof peerInfoSchema>;

const DEFAULT_COLOR = '#8b5cf6';
const COLOR_RE = /^#[0-9a-f]{6}$/i;
const MAX_NAME_LEN = 64;
/** Client-supplied and stored verbatim, so it is length-capped like the name. */
const MAX_UID_LEN = 64;

export function sanitizeName(n: unknown, fallback = 'Anonymous'): string {
  if (typeof n !== 'string') return fallback;
  const trimmed = n.trim().slice(0, MAX_NAME_LEN);
  return trimmed || fallback;
}

/** Absent unless the client sent something usable — never invented here, since a
 *  server-minted id would not survive the client's next connection. */
export function sanitizeUid(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const trimmed = v.trim().slice(0, MAX_UID_LEN);
  return trimmed || undefined;
}

export function sanitizeColor(c: unknown, fallback = DEFAULT_COLOR): string {
  return typeof c === 'string' && COLOR_RE.test(c) ? c : fallback;
}

/** The parsed attachment, or null when a socket carries something else. */
export function readPeerInfo(value: unknown): PeerInfo | null {
  const parsed = peerInfoSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

// Moved to packages/types so client code can use it without importing server-side src/.
export { isAgentPeer } from '@marklayer/types';
