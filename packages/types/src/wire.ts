import { z } from 'zod/mini';
import type { DrawOp, Point } from './ops';
import { drawOpSchema } from './ops';

/** Peer presence for live cursors. Runtime-only state — not on the wire. */
export interface Peer {
  /** Per-connection, so two tabs of one browser are two peers. */
  id: string;
  /**
   * The peer's stable client id, when they announced one. Mentions and any other
   * record that has to survive a reconnect point at this, never at `id`.
   */
  uid?: string;
  name: string;
  color: string;
  cursor: Point | null;
  tool?: string;
  lastSeen: number;
}

/**
 * RTC signaling carries arbitrary SDP/ICE blobs that we forward verbatim.
 * Match these types separately and pass through; do not run them through `clientMsgSchema`.
 *
 * `rtc_request_ice` is a client→server fan-in (no `to:` field); the server replies
 * with a server-only `ice_refresh` push.
 */
export const RTC_MESSAGE_TYPES = ['rtc_offer', 'rtc_answer', 'rtc_ice', 'rtc_request_ice'] as const;
export type RtcMessageType = (typeof RTC_MESSAGE_TYPES)[number];

export const execModeSchema = z.enum(['solo', 'guide', 'pair']);
export type ExecMode = z.infer<typeof execModeSchema>;

// Teaching is live room traffic: it is broadcast and watched, never stored as an annotation.
const teachHighlight = {
  presentationId: z.string(),
  annotationId: z.optional(z.string()),
  selector: z.optional(z.string()),
  rect: z.optional(z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })),
  label: z.optional(z.string()),
};
const teachCaption = {
  presentationId: z.string(),
  text: z.string(),
  step: z.optional(z.number()),
  total: z.optional(z.number()),
};
const teachState = {
  presentationId: z.string(),
  state: z.enum(['active', 'paused', 'ended']),
  step: z.optional(z.number()),
  total: z.optional(z.number()),
};
const teachControl = {
  presentationId: z.string(),
  action: z.enum(['previous', 'pause', 'resume', 'next']),
  step: z.optional(z.number()),
};
const teachingPeer = { peerId: z.string(), color: z.optional(z.string()) };

/**
 * Operational client→server messages, strictly validated at the WS boundary.
 * Excludes RTC signaling (see RTC_MESSAGE_TYPES).
 */
export const clientMsgSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('set_exec_mode'), execMode: execModeSchema }),
  z.object({ type: z.literal('teach_highlight'), ...teachHighlight }),
  z.object({ type: z.literal('teach_caption'), ...teachCaption }),
  z.object({ type: z.literal('teach_state'), ...teachState }),
  z.object({ type: z.literal('teach_control'), ...teachControl }),
  z.object({ type: z.literal('op'), op: drawOpSchema }),
  z.object({
    type: z.literal('update_op'),
    opId: z.string(),
    patch: z.record(z.string(), z.unknown()),
  }),
  z.object({ type: z.literal('undo'), opId: z.string() }),
  z.object({ type: z.literal('clear') }),
  z.object({ type: z.literal('ping') }),
  z.object({
    type: z.literal('cursor'),
    x: z.number(),
    y: z.number(),
    tool: z.optional(z.string()),
  }),
  z.object({
    type: z.literal('ripple'),
    x: z.number(),
    y: z.number(),
  }),
  z.object({
    type: z.literal('profile'),
    name: z.optional(z.string()),
    color: z.optional(z.string()),
  }),
  /**
   * "Everyone follow me." Follow mode already lets one person opt into another's
   * scroll; this is the presenter pulling the room instead of asking each person
   * to click. It only sets what a follower could have set themselves, and any
   * scroll or click releases them, so it grants no control they cannot take back.
   */
  z.object({ type: z.literal('flock'), on: z.boolean() }),
]);
export type ClientMsg = z.infer<typeof clientMsgSchema>;

/** Who a peer is, as the room announces them. `uid` is absent on a worker older than this schema. */
const wirePeerSchema = z.object({
  id: z.string(),
  uid: z.optional(z.string()),
  name: z.string(),
  color: z.string(),
});

const iceServerSchema = z.looseObject({ urls: z.union([z.string(), z.array(z.string())]) });

/** Verbatim SDP/ICE fields ride beside these, which is why it is loose: the room forwards them unread. */
const rtcRelaySchema = z.looseObject({
  type: z.enum(['rtc_offer', 'rtc_answer', 'rtc_ice']),
  from: z.optional(z.string()),
  to: z.optional(z.string()),
});

/** Every message a room sends down a socket. Additive: it describes what is sent today. */
export const serverMsgSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('exec_mode'), execMode: execModeSchema }),
  z.object({ type: z.literal('teach_highlight'), ...teachHighlight, ...teachingPeer }),
  z.object({ type: z.literal('teach_caption'), ...teachCaption, ...teachingPeer }),
  z.object({ type: z.literal('teach_state'), ...teachState, ...teachingPeer }),
  z.object({ type: z.literal('teach_control'), ...teachControl, ...teachingPeer }),
  z.object({
    type: z.literal('init'),
    // Unknown, not `drawOpSchema`: one op from a newer client must not blank the room. Read through `parseOps`.
    ops: z.array(z.unknown()),
    peers: z.optional(z.array(wirePeerSchema)),
    createdAt: z.optional(z.nullable(z.number())),
    expiresAt: z.optional(z.nullable(z.number())),
    owned: z.optional(z.boolean()),
    url: z.optional(z.nullable(z.string())),
    width: z.optional(z.nullable(z.number())),
    access: z.optional(z.string()),
    canEdit: z.optional(z.boolean()),
    execMode: z.optional(execModeSchema),
    iceServers: z.optional(z.array(iceServerSchema)),
  }),
  z.object({ type: z.literal('access'), canEdit: z.boolean() }),
  z.object({ type: z.literal('error'), code: z.string() }),
  z.object({ type: z.literal('op'), op: drawOpSchema }),
  z.object({ type: z.literal('update_op'), opId: z.string(), patch: z.record(z.string(), z.unknown()) }),
  z.object({ type: z.literal('undo'), opId: z.string() }),
  z.object({ type: z.literal('clear') }),
  z.object({ type: z.literal('peer_join'), peer: wirePeerSchema }),
  z.object({ type: z.literal('peer_leave'), peerId: z.string() }),
  z.object({
    type: z.literal('cursor'),
    peerId: z.string(),
    name: z.optional(z.string()),
    color: z.optional(z.string()),
    x: z.number(),
    y: z.number(),
    tool: z.optional(z.string()),
  }),
  z.object({
    type: z.literal('ripple'),
    peerId: z.string(),
    color: z.optional(z.string()),
    x: z.number(),
    y: z.number(),
  }),
  z.object({
    type: z.literal('profile'),
    peerId: z.string(),
    name: z.optional(z.string()),
    color: z.optional(z.string()),
  }),
  z.object({ type: z.literal('flock'), peerId: z.string(), name: z.optional(z.string()), on: z.boolean() }),
  z.object({ type: z.literal('ice_refresh'), iceServers: z.array(iceServerSchema) }),
  z.object({ type: z.literal('pong') }),
  rtcRelaySchema,
]);
export type ServerMsg = z.infer<typeof serverMsgSchema>;

/** Why a write came back refused. `code` stays a string on the wire so an old client ignores a new reason. */
export const ROOM_ERROR_READ_ONLY = 'read_only';

/**
 * A room as an agent loads it over RPC. `cursor` marks the point in the room's message
 * log this snapshot covers: a watch passes it back, so what landed between the
 * snapshot and the watch is delivered instead of lost.
 */
export interface AgentSnapshot {
  /** Parsed by the room: RPC will not carry `unknown`, and a Worker should not be handed ops nobody validated. */
  ops: DrawOp[];
  url: string | null;
  width: number | null;
  createdAt: number | null;
  expiresAt: number | null;
  /** False on a view-only link, so a mutator can say why rather than report a missing id. */
  canEdit: boolean;
  cursor: number;
  execMode?: ExecMode;
}

/**
 * What joining over HTTP answers. Between two tool calls nothing holds the agent's state, so a
 * known peer gets `ops` as it last watched them and `missed`, the messages that lead from there
 * to now: replayed, they raise what a held-open core would have raised as they landed.
 */
export interface AgentJoin extends AgentSnapshot {
  missed: ServerMsg[];
}

export interface AgentWatchRequest {
  timeoutMs: number;
  since: number;
  /** Whose position this watch advances: only a watch reports work, so only a watch counts as having seen it. */
  peerId: string;
}

/** What a parked `agentWatch` answers with: every message since `since`, and where the next watch resumes. */
export interface AgentWatchResult {
  messages: ServerMsg[];
  cursor: number;
}

/**
 * Close code a room sends when a password change ends the session. 4000-4999 is
 * the application range; 4401 echoes HTTP 401 so a log reader can place it.
 */
export const ROOM_LOCKED_CLOSE_CODE = 4401;

/** The room's deadline passed. Same family as above; 4410 echoes HTTP 410. */
export const ROOM_EXPIRED_CLOSE_CODE = 4410;

/** A socket that outran its budget. 1008 is the protocol's own "policy violation". */
export const SOCKET_RATE_LIMITED_CLOSE_CODE = 1008;

/**
 * Per-socket message budget, as a token bucket. The burst covers a reconnect flushing
 * its offline queue and a rename sending one `update_op` per annotation; the refill
 * covers a guide drag at display rate plus 20 Hz cursors. Shared so a client's drain
 * pacing derives from the budget rather than a number tuned against it by hand.
 */
export const SOCKET_BURST = 1000;
export const SOCKET_REFILL_PER_S = 200;

/** Header an agent or API caller sends a link password in, for clients that cannot send a bearer token. */
export const ROOM_PASSWORD_HEADER = 'X-MarkLayer-Password';

/**
 * Header the Worker stamps on a socket it admitted, naming the password generation
 * it checked. Always overwritten, never forwarded from the client: the room trusts it.
 */
export const ROOM_GEN_HEADER = 'X-MarkLayer-Room-Gen';
