import { DurableObject } from 'cloudflare:workers';
import { WATCH_MAX_SECONDS } from '@marklayer/agent-tools';
import { ORIGIN } from '@marklayer/brand';
import { isAgentPeer } from '@marklayer/types/agents';
import { applyOpPatch, type DrawOp, drawOpSchema, parseOps } from '@marklayer/types/ops';
import {
  type AgentJoin,
  type AgentSnapshot,
  type AgentWatchRequest,
  type AgentWatchResult,
  type ClientMsg,
  clientMsgSchema,
  ROOM_ERROR_READ_ONLY,
  ROOM_EXPIRED_CLOSE_CODE,
  ROOM_GEN_HEADER,
  ROOM_LOCKED_CLOSE_CODE,
  RTC_MESSAGE_TYPES,
  type ServerMsg,
  SOCKET_BURST,
  SOCKET_RATE_LIMITED_CLOSE_CODE,
  SOCKET_REFILL_PER_S,
} from '@marklayer/types/wire';
import { z } from 'zod/mini';
import { canEditLink, effectiveExpiresAt, type LinkAccess } from '../shared/accounts';
import { userFromCookieHeader } from './auth/session';
import type { Env } from './env';
import { getIceServers } from './ice';
import { roomDestinations } from './integrations/destinations';
import type { SlackEnv } from './integrations/slack-config';
import { refusedSocket } from './lock/refused-socket';
import { type PeerInfo, readPeerInfo, sanitizeColor, sanitizeName, sanitizeUid } from './peers';
import { OutboundQueue } from './room-outbound';
import { relayRtc } from './room-rtc';
import type { SaveMode } from './room-stub';
import { captureAgentJoined, captureAgentLeft, SessionStats } from './room-telemetry';
import { annotationStore, type StoredAnnotation } from './store';
import { isExpired } from './time';

export { SOCKET_BURST, SOCKET_RATE_LIMITED_CLOSE_CODE };

type RoomEnv = SlackEnv &
  Pick<Env['Bindings'], 'DB' | 'TURN_KEY_ID' | 'TURN_KEY_TOKEN' | 'POSTHOG_KEY' | 'POSTHOG_HOST' | 'APP_ORIGIN'>;

/** Non-mutating types — always allowed. Everything else goes through `mutate`,
 * so a new mutating type is guarded by default, not by someone remembering. */
const READ_ONLY_SAFE_TYPES = new Set<ClientMsg['type']>([
  'ping',
  'cursor',
  'ripple',
  'profile',
  'flock',
  'teach_highlight',
  'teach_caption',
  'teach_state',
  'teach_control',
]);

type TeachingMessage = Extract<
  ClientMsg,
  { type: 'teach_highlight' | 'teach_caption' | 'teach_state' | 'teach_control' }
>;
const isTeaching = (msg: ClientMsg): msg is TeachingMessage =>
  msg.type === 'teach_highlight' ||
  msg.type === 'teach_caption' ||
  msg.type === 'teach_state' ||
  msg.type === 'teach_control';

/**
 * How long an agent stays in the peer list without calling again. Longer than
 * the longest watch, so an agent parked in one is never dropped mid-wait and
 * then re-announced as if it had rejoined.
 */
const AGENT_PRESENCE_TTL_MS = WATCH_MAX_SECONDS * 1000 + 5 * 60_000;

/** Messages kept for watchers to catch up on. Past this an agent gets the tail and re-snapshots. */
const LOG_CAP = 1000;

/** Debounce between a mutation and its flush to D1. */
const FLUSH_DELAY_MS = 3000;

/**
 * One op as the room stores and broadcasts it. The socket path arrives parsed and
 * an RPC call arrives as a literal; the schema fixes the key order so a row and a
 * broadcast are the same bytes whichever way the op came in. An op this build's
 * schema cannot read (a newer client's) is kept as it is rather than dropped.
 */
function canonicalOp<T>(op: T): T | DrawOp {
  const parsed = drawOpSchema.safeParse(op);
  return parsed.success ? parsed.data : op;
}

/** One parse per op: `stored` keeps what this build cannot read, `parsed` is what peers are told. */
function canonicalOps(raw: unknown[]): { stored: unknown[]; parsed: DrawOp[] } {
  const parsed: DrawOp[] = [];
  const stored = raw.map((o) => {
    const p = drawOpSchema.safeParse(o);
    if (!p.success) return o;
    parsed.push(p.data);
    return p.data;
  });
  return { stored, parsed };
}

/** Stored ops are unparsed JSON; this reads an id without trusting the shape. */
const opIdOf = (o: unknown) =>
  typeof o === 'object' && o !== null && 'id' in o && typeof o.id === 'string' ? o.id : undefined;

/**
 * Every change to the ops column, however it arrives. The socket's own union, plus the
 * REST save's two whole-array forms: `replace` (a deliberate publish) and `merge`.
 */
export type RoomChange =
  | Extract<ClientMsg, { type: 'op' | 'update_op' | 'undo' | 'clear' }>
  | { type: 'replace' | 'merge'; ops: unknown[] };

/** Who is asking. A socket is judged by its attachment; an RPC or REST caller by the link's access row. */
type Origin = { ws: WebSocket } | { userId?: string; peerId?: string };

export type MutateOutcome = 'applied' | 'noop' | 'refused';

/**
 * What survives eviction. Read first in `loadOps`: `rowExisted` is what lets a
 * room tell "never minted" from "deleted behind me", and `seq` keeps watch
 * cursors monotonic across a hibernation.
 */
const persistedSchema = z.object({
  roomId: z.optional(z.string()),
  rowExisted: z.optional(z.boolean()),
  dead: z.optional(z.boolean()),
  seq: z.optional(z.number()),
});
type Persisted = z.infer<typeof persistedSchema>;
const PERSISTED_KEYS: (keyof Persisted)[] = ['roomId', 'rowExisted', 'dead', 'seq'];

export class AnnotationRoom extends DurableObject<RoomEnv> {
  private ops: unknown[] | null = null;
  /** In-flight load promise — coalesces concurrent first-message reads. */
  private opsPromise: Promise<unknown[]> | null = null;
  private dirty = false;
  private annotationId: string | null = null;
  /** Whether D1 had a row when this room loaded. False is the one case the flush may insert. */
  private rowExisted = false;
  /**
   * The row vanished while this room was warm (or hibernating). Nothing in
   * memory is flushed again and every socket is closed; the next entrant
   * through the door starts the room afresh.
   */
  private dead = false;
  private createdAt: number | null = null;
  private expiresAt: number | null = null;
  private url: string | null = null;
  private width: number | null = null;
  /** Who may edit. 'edit' is every link's default; 'view' is set only by the owner's Settings PATCH. */
  private access: LinkAccess = 'edit';
  private ownerId: string | null = null;
  private ownerExpiresAt: number | null = null;

  private readonly stats = new SessionStats();
  private readonly outbound: OutboundQueue;
  /** Public origin of the request that opened this room, for the "open the room" link. */
  private origin: string | null = null;

  /**
   * The room's message log: every mutation as the message peers saw, numbered.
   * A watcher names where it left off and gets what landed since, so nothing
   * between an agent's snapshot and its watch is lost. `logBase` is the sequence
   * number of `log[0]`.
   */
  private log: ServerMsg[] = [];
  private logBase = 0;
  /** Parked watches, each waiting for a message past its cursor. */
  private watchers: { since: number; wake: (result: AgentWatchResult) => void }[] = [];

  /**
   * Agents attached over the remote MCP endpoint, which is HTTP and so holds no
   * socket to keep them present. They are kept here with a last-seen stamp and
   * folded into the peer list, so a person watching the room sees the agent the
   * same way they see anyone else. Losing this map to hibernation is correct:
   * nothing was holding the room open, so nobody was there to see the agent.
   */
  private httpAgents = new Map<
    string,
    {
      peer: Omit<PeerInfo, 'canEdit' | 'userId'>;
      lastSeen: number;
      /** The room as this agent's last watch left it. A shallow copy: every path replaces an op, none edits one. */
      seen: { cursor: number; ops: unknown[] };
    }
  >();

  constructor(ctx: DurableObjectState, env: RoomEnv) {
    super(ctx, env);
    this.outbound = new OutboundQueue(roomDestinations(env));
    // Our heartbeat is a text message, not a protocol ping frame, so it would wake
    // the room from hibernation 4x/min per client. Answered by the runtime instead.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"type":"ping"}', '{"type":"pong"}'));
  }

  /**
   * The room's name. `ctx.id.name` is set for an id made by `idFromName`, which
   * is how every stub to this class is made; the id on a socket's upgrade URL is the
   * fallback, and storage remembers it across evictions.
   * Fail closed: a room that cannot say which row it is must not touch any.
   */
  private async roomId(hint?: string | null): Promise<string> {
    const named = this.ctx.id.name ?? this.annotationId ?? hint ?? null;
    if (named) {
      this.annotationId = named;
      return named;
    }
    const stored = await this.readPersisted();
    if (stored.roomId) {
      this.annotationId = stored.roomId;
      return stored.roomId;
    }
    throw new Error('room has no name');
  }

  private async readPersisted(): Promise<Persisted> {
    const raw = await this.ctx.storage.get(PERSISTED_KEYS);
    const parsed = persistedSchema.safeParse(Object.fromEntries(raw));
    return parsed.success ? parsed.data : {};
  }

  private persist(fields: Persisted): Promise<void> {
    return this.ctx.storage.put({ ...fields });
  }

  private async getOps(hint?: string | null): Promise<unknown[]> {
    if (this.ops !== null) return this.ops;
    if (this.opsPromise) return this.opsPromise;
    this.opsPromise = this.loadOps(hint);
    try {
      return await this.opsPromise;
    } finally {
      this.opsPromise = null;
    }
  }

  private async loadOps(hint?: string | null): Promise<unknown[]> {
    const id = await this.roomId(hint);
    const [persisted, row] = await Promise.all([this.readPersisted(), annotationStore(this.env.DB).get(id)]);
    this.logBase = persisted.seq ?? 0;
    this.log = [];
    this.ops = row?.ops ?? [];
    this.applyRow(row);
    this.rowExisted = row !== null;
    // The row was there when this room last saw D1 and is not now: deleted behind
    // it, possibly while its sockets hibernated. Nothing it holds may come back.
    this.dead = persisted.rowExisted === true && row === null;
    await this.persist({ roomId: id, rowExisted: this.rowExisted, dead: this.dead, seq: this.logBase });
    if (this.dead) this.closeAll(ROOM_EXPIRED_CLOSE_CODE, 'room gone');
    else {
      this.ctx.waitUntil(annotationStore(this.env.DB).touch(id));
      await this.armExpiry();
    }
    return this.ops;
  }

  /** A fresh entrant after the row died: the door let it in, so the room starts over at this id. */
  private async revive(): Promise<void> {
    if (!this.dead) return;
    this.dead = false;
    this.ops = [];
    this.rowExisted = false;
    this.dirty = false;
    await this.persist({ rowExisted: false, dead: false });
  }

  /** Everything the room caches from its row, in one place, so no field lags behind the rest. */
  private applyRow(row: Omit<StoredAnnotation, 'ops'> | null): void {
    this.createdAt = row?.createdAt ?? null;
    this.expiresAt = row?.expiresAt ?? null;
    this.url = row?.url ?? null;
    this.width = row?.width ?? null;
    this.access = row?.access ?? 'edit';
    this.ownerId = row?.ownerId ?? null;
    this.ownerExpiresAt = row?.ownerExpiresAt ?? null;
  }

  /** The row as D1 has it now. `loadOps` runs once per isolate, and the Worker writes around a warm room. */
  private async refreshRow(): Promise<void> {
    const meta = await annotationStore(this.env.DB).getMeta(await this.roomId());
    // No row is not the defaults: one that was there was deleted, and its room must not reopen as an editable link.
    if (meta === null) {
      if (this.rowExisted) await this.rowGone();
      return;
    }
    const before = this.deadline();
    this.applyRow(meta);
    if (this.deadline() !== before) await this.armExpiry();
  }

  private deadline(): number | null {
    return effectiveExpiresAt({ expiresAt: this.expiresAt, ownerExpiresAt: this.ownerExpiresAt });
  }

  /**
   * An alarm for the deadline, so a socket idling past it is closed rather than left
   * reading. One alarm per object, shared with the flush: `alarm` re-arms whichever a
   * flush replaced. The second past the deadline, since `isExpired` is strict.
   */
  private async armExpiry(): Promise<void> {
    const deadline = this.deadline();
    if (deadline === null || isExpired(deadline)) return;
    const at = (deadline + 1) * 1000;
    const armed = await this.ctx.storage.getAlarm();
    if (armed === null || armed > at) await this.ctx.storage.setAlarm(at);
  }

  /**
   * The door only stops who is arriving. Whoever is already inside stops here, against
   * the row rather than the cache: an owner may have extended the link since this loaded.
   */
  private async pastDeadline(): Promise<boolean> {
    if (!isExpired(this.deadline())) return false;
    await this.refreshRow();
    if (!isExpired(this.deadline())) return false;
    this.closeAll(ROOM_EXPIRED_CLOSE_CODE, 'room expired');
    this.httpAgents.clear();
    this.wakeWatchers();
    return true;
  }

  /**
   * Parsed attachments, keyed by socket. The attachment is the source of truth
   * (it survives hibernation), but re-validating it on every message would tax
   * every peer's every stroke, so the parse is memoized and a fresh isolate
   * simply refills it on first read.
   */
  private peerInfo = new WeakMap<WebSocket, PeerInfo>();

  private getPeerInfo(ws: WebSocket): PeerInfo | null {
    const cached = this.peerInfo.get(ws);
    if (cached) return cached;
    const info = readPeerInfo(ws.deserializeAttachment());
    if (info) this.peerInfo.set(ws, info);
    return info;
  }

  private setPeerInfo(ws: WebSocket, info: PeerInfo) {
    ws.serializeAttachment(info);
    this.peerInfo.set(ws, info);
  }

  /** In memory only: hibernation drops it, but a room only hibernates once its sockets go quiet. */
  private socketBudget = new WeakMap<WebSocket, { tokens: number; at: number }>();

  /** Spend one message from this socket's bucket; false once it is empty. */
  private spendMessage(ws: WebSocket): boolean {
    const now = Date.now();
    const bucket = this.socketBudget.get(ws) ?? { tokens: SOCKET_BURST, at: now };
    bucket.tokens = Math.min(SOCKET_BURST, bucket.tokens + ((now - bucket.at) / 1000) * SOCKET_REFILL_PER_S) - 1;
    bucket.at = now;
    this.socketBudget.set(ws, bucket);
    return bucket.tokens >= 0;
  }

  /**
   * Count an agent's work on its own socket attachment. Only agents are counted:
   * this costs a write per op, and the per-peer breakdown is only ever read for
   * `agent_left`. Humans stay on the cheap in-memory counters.
   */
  private countAgentWork(ws: WebSocket, field: 'ops' | 'updates') {
    const info = this.getPeerInfo(ws);
    if (!info || !isAgentPeer(info.id)) return;
    this.setPeerInfo(ws, { ...info, [field]: (info[field] ?? 0) + 1 });
  }

  /** This room's access row applied to one user. The rule itself is shared. */
  private canEditFor(userId: string | undefined): boolean {
    return canEditLink({ access: this.access, ownerId: this.ownerId, userId });
  }

  /**
   * Live human peers, ignoring one socket. `exclude` is load-bearing: workerd
   * keeps a terminating socket in `getWebSockets()` for the whole of its close
   * handler, so a leaving peer counts itself unless the caller says otherwise.
   */
  private countHumans(exclude?: WebSocket): number {
    let n = 0;
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === exclude) continue;
      const info = this.getPeerInfo(ws);
      if (info && !isAgentPeer(info.id)) n++;
    }
    return n;
  }

  /**
   * Sockets already torn down. workerd dispatches `webSocketClose` or
   * `webSocketError` for one termination, never both, so this only guards
   * against a runtime that someday does otherwise.
   */
  private readonly closed = new WeakSet<WebSocket>();

  private getPeerList(): Omit<PeerInfo, 'canEdit' | 'userId'>[] {
    const list: Omit<PeerInfo, 'canEdit' | 'userId'>[] = [];
    for (const ws of this.ctx.getWebSockets()) {
      const info = this.getPeerInfo(ws);
      if (info) {
        // Bookkeeping for this room, not something one peer should read off another.
        const { canEdit: _canEdit, userId: _userId, ...peer } = info;
        list.push(peer);
      }
    }
    const cutoff = Date.now() - AGENT_PRESENCE_TTL_MS;
    for (const [peerId, entry] of this.httpAgents) {
      if (entry.lastSeen < cutoff) {
        this.httpAgents.delete(peerId);
        this.broadcast({ type: 'peer_leave', peerId });
        continue;
      }
      list.push(entry.peer);
    }
    return list;
  }

  private broadcast(msg: ServerMsg, exclude?: WebSocket) {
    const text = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws !== exclude && ws.readyState === WebSocket.OPEN) ws.send(text);
    }
  }

  private closeAll(code: number, reason: string, keep?: (info: PeerInfo | null) => boolean): void {
    for (const ws of this.ctx.getWebSockets()) {
      if (keep?.(this.getPeerInfo(ws))) continue;
      try {
        ws.close(code, reason);
      } catch {
        // Already closing on the client's side; nothing left to end.
      }
    }
  }

  /** Append to the log and wake every watcher it reaches. All at once: a watcher must never see half of one change. */
  /** A change to the ops, to sockets and HTTP agents alike: one without the other desyncs them silently. */
  private announce(msgs: ServerMsg[], exclude?: WebSocket): void {
    for (const msg of msgs) this.broadcast(msg, exclude);
    this.record(...msgs);
  }

  private record(...msgs: ServerMsg[]): void {
    this.log.push(...msgs);
    const over = this.log.length - LOG_CAP;
    if (over > 0) {
      this.log.splice(0, over);
      this.logBase += over;
    }
    const cursor = this.cursor();
    const woken = this.watchers;
    this.watchers = [];
    for (const w of woken) w.wake({ messages: this.since(w.since), cursor });
  }

  /** End every parked watch, empty-handed. */
  private wakeWatchers(): void {
    const woken = this.watchers;
    this.watchers = [];
    for (const w of woken) w.wake({ messages: [], cursor: this.cursor() });
  }

  /** Where the room stands, as an agent's `seen`. Only true synchronously after a change is fully applied. */
  private position(): { cursor: number; ops: unknown[] } {
    return { cursor: this.cursor(), ops: [...(this.ops ?? [])] };
  }

  private cursor(): number {
    return this.logBase + this.log.length;
  }

  private since(cursor: number): ServerMsg[] {
    return this.log.slice(Math.max(0, cursor - this.logBase));
  }

  /** Whether this caller may change the room. A socket answers for itself; everyone else is read against the row. */
  private async mayEdit(from: Origin): Promise<boolean> {
    if ('ws' in from) {
      // `canEdit === false` only, never `!info`: a socket with no parsed info yet
      // defaults to allowed, matching `'edit'` being every link's default.
      const info = this.getPeerInfo(from.ws);
      if (info?.canEdit === false) {
        from.ws.send(JSON.stringify({ type: 'error', code: ROOM_ERROR_READ_ONLY }));
        return false;
      }
      return true;
    }
    // The owner may have flipped the link since this isolate loaded it, and an
    // HTTP caller has no `init` message to carry a later value to it.
    await this.refreshAccess();
    return this.canEditFor(from.userId);
  }

  /**
   * Every mutation of the ops column, from a socket, an RPC call or a REST save:
   * one access check, one application, one broadcast, one log entry, one flush.
   * The sender's own socket is skipped on `op`, `undo` and `clear` (it already
   * applied them locally); `update_op` goes to everyone, as it always has.
   */
  private async mutate(change: RoomChange, from: Origin): Promise<MutateOutcome> {
    const ops = await this.getOps();
    if (this.dead || (await this.pastDeadline())) return 'refused';
    // `mayEdit` rereads the row, which may find it gone.
    if (!(await this.mayEdit(from)) || this.dead) return 'refused';
    const peerId = 'ws' in from ? this.getPeerInfo(from.ws)?.id : from.peerId;
    if (peerId && isAgentPeer(peerId)) {
      const status = change.type === 'update_op' ? change.patch.status : change.type === 'op' && 'status' in change.op ? change.op.status : undefined;
      if (status === 'approved') return 'refused';
      const mode = await annotationStore(this.env.DB).getExecMode(await this.roomId());
      if (mode === 'guide') {
        if (status === 'resolved' || status === 'dismissed') return 'refused';
        if (change.type === 'op' && change.op.tool === 'selection' && change.op.suggestion) return 'refused';
        if (change.type === 'update_op' && 'suggestion' in change.patch && change.patch.suggestion) return 'refused';
      }
    }
    return this.apply({ change, ops, ws: 'ws' in from ? from.ws : undefined });
  }

  /** The write itself, past every check: what `mutate` does once the caller may, and what `reset` does outright. */
  private async apply({
    change,
    ops,
    ws,
  }: {
    change: RoomChange;
    ops: unknown[];
    ws?: WebSocket;
  }): Promise<MutateOutcome> {
    switch (change.type) {
      case 'op': {
        // An id already present is a redelivery (Slack retries an event it thinks timed out): a no-op success.
        if (ops.some((o) => opIdOf(o) === change.op.id)) return 'noop';
        // A socket op already passed `clientMsgSchema`; only an RPC literal needs the schema's key order.
        const op = ws ? change.op : canonicalOp(change.op);
        ops.push(op);
        this.stats.noteOp(op.tool);
        if (ws) this.countAgentWork(ws, 'ops');
        this.announce([{ type: 'op', op }], ws);
        this.outbound.queue(op);
        break;
      }
      case 'update_op': {
        const idx = ops.findIndex((o) => opIdOf(o) === change.opId);
        const current = ops[idx];
        if (idx === -1 || current === undefined) return 'noop';
        // Reject rather than broadcast: this is the one path that persists a patched op.
        const merged = applyOpPatch({ op: current, patch: change.patch });
        if (!merged) return 'refused';
        ops[idx] = merged;
        this.stats.noteUpdate();
        if (ws) this.countAgentWork(ws, 'updates');
        this.announce([{ type: 'update_op', opId: change.opId, patch: change.patch }]);
        break;
      }
      case 'undo': {
        const idx = ops.findIndex((o) => opIdOf(o) === change.opId);
        if (idx === -1) return 'noop';
        ops.splice(idx, 1);
        this.announce([{ type: 'undo', opId: change.opId }], ws);
        break;
      }
      case 'clear': {
        ops.length = 0;
        this.announce([{ type: 'clear' }], ws);
        break;
      }
      case 'replace': {
        // The whole-array form, as a sequence of the messages peers understand:
        // what left is undone, what arrived or changed is an op. In place, since
        // `this.ops` is the array every other path holds.
        const before = new Map<string, unknown>();
        for (const o of ops) {
          const id = opIdOf(o);
          if (id) before.set(id, o);
        }
        const after = new Set(change.ops.map(opIdOf).filter((id): id is string => id !== undefined));
        const { stored, parsed } = canonicalOps(change.ops);
        ops.splice(0, ops.length, ...stored);
        const said: ServerMsg[] = [];
        for (const id of before.keys()) {
          if (!after.has(id)) said.push({ type: 'undo', opId: id });
        }
        for (const op of parsed) {
          const was = before.get(op.id);
          if (was !== undefined && JSON.stringify(was) === JSON.stringify(op)) continue;
          if (was !== undefined) {
            said.push({ type: 'undo', opId: op.id });
          } else {
            this.stats.noteOp(op.tool);
            this.outbound.queue(op);
          }
          said.push({ type: 'op', op });
        }
        this.announce(said);
        break;
      }
      case 'merge': {
        const known = new Set(ops.map(opIdOf));
        const added = change.ops.filter((o) => {
          const id = opIdOf(o);
          if (id === undefined || known.has(id)) return false;
          known.add(id);
          return true;
        });
        if (added.length === 0) return 'noop';
        const { stored, parsed } = canonicalOps(added);
        ops.push(...stored);
        const said: ServerMsg[] = [];
        for (const op of parsed) {
          this.stats.noteOp(op.tool);
          this.outbound.queue(op);
          said.push({ type: 'op', op });
        }
        this.announce(said);
        break;
      }
    }
    await this.scheduleFlush();
    return 'applied';
  }

  private async scheduleFlush() {
    this.dirty = true;
    await this.ctx.storage.setAlarm(Date.now() + FLUSH_DELAY_MS);
  }

  // The Worker's routes and the remote MCP endpoint are stateless: the session lives here,
  // in the room that owns the ops.

  /** Keep an HTTP-attached agent in the peer list; announce it the first time. Returns the room as it stands. */
  async join(peer: { id: string; uid: string; name: string; color: string }): Promise<AgentJoin> {
    await this.getOps();
    await this.revive();
    const known = this.httpAgents.get(peer.id);
    const announced = {
      id: peer.id,
      uid: sanitizeUid(peer.uid),
      name: sanitizeName(peer.name),
      color: sanitizeColor(peer.color),
    };
    const entry = { peer: announced, lastSeen: Date.now(), seen: known?.seen ?? this.position() };
    this.httpAgents.set(peer.id, entry);
    if (!known) {
      this.stats.noteAgent();
      this.broadcast({ type: 'peer_join', peer: announced });
    }
    const snapshot = await this.snapshot();
    // Past the log's cap the gap cannot be replayed, so the agent re-snapshots, as a watcher would.
    if (!known || entry.seen.cursor < this.logBase) {
      entry.seen = this.position();
      return { ...snapshot, missed: [] };
    }
    return { ...snapshot, ops: parseOps(entry.seen.ops), missed: this.since(entry.seen.cursor) };
  }

  async snapshot(): Promise<AgentSnapshot> {
    await this.getOps();
    await this.refreshAccess();
    return {
      // After the awaits, so `ops` and `cursor` are one instant: a message between them would be lost to a watch.
      ops: parseOps(this.ops ?? []),
      url: this.url,
      width: this.width,
      createdAt: this.createdAt,
      expiresAt: this.deadline(),
      canEdit: this.canEditFor(undefined),
      execMode: (await annotationStore(this.env.DB).getExecMode(await this.roomId())) ?? 'pair',
      cursor: this.cursor(),
    };
  }

  /** One client message from an agent. `false` means the link is view-only — never that the write failed silently. */
  async send(msg: ClientMsg, peerId?: string): Promise<boolean> {
    if (isTeaching(msg)) {
      if (!peerId || !clientMsgSchema.safeParse(msg).success) return false;
      await this.getOps();
      this.announce([{ ...msg, peerId }]);
      return true;
    }
    if (msg.type === 'op' || msg.type === 'update_op' || msg.type === 'undo' || msg.type === 'clear') {
      const outcome = await this.mutate(msg, { peerId });
      return outcome !== 'refused';
    }
    return true;
  }

  /**
   * Park until a message lands past `since`, or the timeout expires. A promise
   * held here rather than a poll from the handler: the request keeps this object
   * resident for its duration, so there is nothing to hibernate out from under it.
   */
  async watch({ timeoutMs, since, peerId }: AgentWatchRequest): Promise<AgentWatchResult> {
    await this.getOps();
    const seen = () => {
      const agent = this.httpAgents.get(peerId);
      if (agent) agent.seen = this.position();
    };
    if (since < this.cursor()) {
      seen();
      return { messages: this.since(since), cursor: this.cursor() };
    }
    return new Promise<AgentWatchResult>((resolve) => {
      let done = false;
      const wake = (result: AgentWatchResult) => {
        if (done) return;
        done = true;
        this.watchers = this.watchers.filter((w) => w.wake !== wake);
        seen();
        resolve(result);
      };
      this.watchers.push({ since, wake });
      setTimeout(() => wake({ messages: [], cursor: this.cursor() }), timeoutMs);
    });
  }

  /** The REST save: the whole array, applied here so a warm room's flush cannot overwrite it. */
  async saveOps({
    ops,
    userId,
    mode,
  }: {
    ops: unknown[];
    userId: string | undefined;
    mode: SaveMode;
  }): Promise<boolean> {
    await this.getOps();
    await this.revive();
    return (await this.mutate({ type: mode, ops }, { userId })) !== 'refused';
  }

  /** The cron wiping the public demo board. */
  async reset(): Promise<void> {
    // A cron, not a participant: no access to check.
    await this.apply({ change: { type: 'clear' }, ops: await this.getOps() });
  }

  /**
   * The owner changed who may edit while this room may be warm. `loadOps` runs
   * once per isolate, so without this a flip to view-only would bite only after
   * the next eviction — and the owner's own tab keeps the room resident.
   */
  async refreshAccess(): Promise<void> {
    await this.getOps();
    await this.refreshRow();
    for (const ws of this.ctx.getWebSockets()) {
      const info = this.getPeerInfo(ws);
      if (!info) continue;
      const canEdit = this.canEditFor(info.userId);
      if (canEdit === (info.canEdit ?? true)) continue;
      this.setPeerInfo(ws, { ...info, canEdit });
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'access', canEdit }));
    }
  }

  /**
   * Lowest password generation a new socket may arrive with. In memory only:
   * it closes the milliseconds between the Worker's check and this room hearing
   * of a change, and a room cold enough to lose it has no such race in flight.
   */
  private minGen = 0;

  /**
   * The owner set, changed or removed the password. Ends every session admitted
   * under an older one: sockets close with the code that sends a browser back to
   * the prompt, and parked agent watches return empty.
   */
  async revoke(gen: number): Promise<void> {
    await this.getOps();
    if (Number.isInteger(gen)) this.minGen = Math.max(this.minGen, gen);
    // The owner skips the prompt anyway; closing their tab would only reload the panel they changed it from.
    this.closeAll(ROOM_LOCKED_CLOSE_CODE, 'password changed', (info) => {
      const userId = info?.userId;
      return userId !== undefined && userId === this.ownerId;
    });
    this.httpAgents.clear();
    this.wakeWatchers();
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const id = url.searchParams.get('id');

    // The Worker admitted this socket against a generation; one older than a
    // revoke already seen lost a race with the change and is refused here.
    const admittedGen = Number(request.headers.get(ROOM_GEN_HEADER));
    if (!Number.isInteger(admittedGen) || admittedGen < this.minGen) {
      return refusedSocket({ code: ROOM_LOCKED_CLOSE_CODE, reason: 'refused' });
    }

    const roomId = await this.roomId(id);
    this.origin ??= this.env.APP_ORIGIN ?? url.origin;

    const peerId = url.searchParams.get('peerId') || crypto.randomUUID();
    const peerName = sanitizeName(url.searchParams.get('name'));
    const peerColor = sanitizeColor(url.searchParams.get('color'));
    const peerUid = sanitizeUid(url.searchParams.get('uid'));

    // getOps, the TURN fetch and the connecting user's session lookup are
    // independent and network-bound, so they overlap. getOps fills in
    // access/ownerId, so canEdit can only be resolved once it resolves.
    const [ops, iceServers, user] = await Promise.all([
      this.getOps(roomId),
      getIceServers(this.env),
      userFromCookieHeader({ header: request.headers.get('Cookie'), db: this.env.DB }),
    ]);
    // The door let this socket in, so a room whose row died starts over here. Both
    // before the accept: a load that finds the row dead closes every accepted socket.
    await this.revive();
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1], [roomId]);
    const canEdit = this.canEditFor(user?.id);
    this.setPeerInfo(pair[1], {
      id: peerId,
      uid: peerUid,
      name: peerName,
      color: peerColor,
      joinedAt: Date.now(),
      canEdit,
      userId: user?.id,
    });

    const sockets = this.ctx.getWebSockets();
    const humans = this.countHumans();
    // The MCP bridge joins as an ordinary peer under an `mcp-` id, so a room
    // worked by an agent is countable without the client reporting anything.
    this.stats.noteJoin({ peers: sockets.length, humans, agent: isAgentPeer(peerId) });

    const peerList = this.getPeerList();
    const init: ServerMsg = {
      type: 'init',
      ops,
      peers: peerList,
      createdAt: this.createdAt,
      // The tighter of the two deadlines: the client has one `expiresAt`
      // concept and must not learn about a link's own expiry while missing
      // its owner's, or the info panel counts down to the wrong date.
      expiresAt: this.deadline(),
      // Whether anyone claimed this link, not who: the info panel's countdown
      // needs to know the idle window no longer applies, and the owner's
      // identity is none of a visiting peer's business.
      owned: this.ownerId !== null,
      url: this.url,
      width: this.width,
      access: this.access,
      execMode: (await annotationStore(this.env.DB).getExecMode(await this.roomId())) ?? 'pair',
      canEdit,
      iceServers: iceServers.map((s) => ({ ...s })),
    };
    pair[1].send(JSON.stringify(init));

    this.broadcast(
      { type: 'peer_join', peer: { id: peerId, uid: peerUid, name: peerName, color: peerColor } },
      pair[1],
    );

    // Awaited before the 101 goes out. An accepted hibernatable socket does not
    // keep this object resident, and an unawaited fetch neither blocks hibernation
    // nor gets any delivery guarantee. Awaiting is what makes it pending I/O.
    // https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/
    if (isAgentPeer(peerId)) {
      await captureAgentJoined({ env: this.env, ctx: this.ctx, humans, peers: sockets.length, opsWaiting: ops.length });
    }
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    // Before any parsing: malformed frames cost the room as much as valid ones.
    if (!this.spendMessage(ws)) {
      try {
        ws.close(SOCKET_RATE_LIMITED_CLOSE_CODE, 'rate limited');
      } catch {
        // Already closing; the first over-budget frame did it.
      }
      return;
    }
    if (typeof message !== 'string') return;

    let raw: unknown;
    try {
      raw = JSON.parse(message);
    } catch {
      return;
    }
    if (!raw || typeof raw !== 'object') return;

    // RTC signaling relay — payloads carry arbitrary SDP/ICE fields, so they bypass
    // the strict client schema and are forwarded as-is to the targeted peer.
    // Checked by hand first: this runs on every frame, cursor moves included.
    const rtc = 'type' in raw && RTC_TYPES.has(raw.type) ? rtcEnvelope.safeParse(raw) : null;
    if (rtc?.success) {
      if (rtc.data.type === 'rtc_request_ice') {
        // Sender wants fresh TURN creds (likely an ICE restart in progress).
        // Broadcast to every socket in the room — if only the requester updates,
        // its peer keeps stale creds and the restart half-completes once the
        // remote relay rejects the old auth. Clients no-op when the URL set is unchanged.
        getIceServers(this.env)
          .then((iceServers) => this.broadcast({ type: 'ice_refresh', iceServers: iceServers.map((s) => ({ ...s })) }))
          .catch(() => {});
        return;
      }
      const from = this.getPeerInfo(ws);
      if (!from || typeof rtc.data.to !== 'string') return;
      relayRtc({
        sockets: this.ctx.getWebSockets(),
        peerOf: (sock) => this.getPeerInfo(sock),
        from,
        msg: { ...rtc.data, type: rtc.data.type, to: rtc.data.to },
      });
      return;
    }

    const parsed = clientMsgSchema.safeParse(raw);
    if (!parsed.success) return;
    const msg = parsed.data;

    if (!READ_ONLY_SAFE_TYPES.has(msg.type)) {
      // The tag names the room for a socket woken from hibernation on a fresh isolate.
      await this.getOps(this.ctx.getTags(ws)[0]);
    }

    switch (msg.type) {
      case 'set_exec_mode': {
        const info = this.getPeerInfo(ws);
        if (!info || isAgentPeer(info.id) || !(await this.mayEdit({ ws }))) return;
        if (await annotationStore(this.env.DB).setExecMode(await this.roomId(), msg.execMode)) {
          this.announce([{ type: 'exec_mode', execMode: msg.execMode }]);
        }
        return;
      }
      case 'teach_highlight':
      case 'teach_caption':
      case 'teach_state':
      case 'teach_control': {
        const info = this.getPeerInfo(ws);
        if (!info) return;
        await this.getOps(this.ctx.getTags(ws)[0]);
        this.announce([{ ...msg, peerId: info.id, color: info.color }]);
        return;
      }
      case 'op':
      case 'update_op':
      case 'undo':
      case 'clear':
        await this.mutate(msg, { ws });
        return;
      case 'ping':
        ws.send('{"type":"pong"}');
        return;
      case 'cursor': {
        const info = this.getPeerInfo(ws);
        if (!info) return;
        this.broadcast(
          { type: 'cursor', peerId: info.id, name: info.name, color: info.color, x: msg.x, y: msg.y, tool: msg.tool },
          ws,
        );
        return;
      }
      case 'ripple': {
        const info = this.getPeerInfo(ws);
        if (!info) return;
        this.broadcast({ type: 'ripple', peerId: info.id, color: info.color, x: msg.x, y: msg.y }, ws);
        return;
      }
      case 'profile': {
        const info = this.getPeerInfo(ws);
        if (!info) return;
        // Spread rather than rebuild: a rename must not drop `uid`, or the peer
        // stops being addressable the moment they change their name.
        const next: PeerInfo = {
          ...info,
          name: sanitizeName(msg.name, info.name),
          color: sanitizeColor(msg.color, info.color),
        };
        this.setPeerInfo(ws, next);
        this.broadcast({ type: 'profile', peerId: next.id, name: next.name, color: next.color }, ws);
        return;
      }
      case 'flock': {
        const info = this.getPeerInfo(ws);
        if (!info) return;
        // Not persisted and not replayed on join: presenting is a live gesture,
        // so someone arriving after it started is not dragged into it.
        this.broadcast({ type: 'flock', peerId: info.id, name: info.name, on: msg.on }, ws);
        return;
      }
    }
  }

  async webSocketClose(ws: WebSocket) {
    await this.teardown(ws);
  }

  async webSocketError(ws: WebSocket) {
    await this.teardown(ws);
  }

  /**
   * One exit path for both a clean close and an errored one. `webSocketError`
   * used to only close the socket, which left peers a ghost in their presence
   * list and never counted the session. Idempotent by way of `closed`.
   */
  private async teardown(ws: WebSocket) {
    if (this.closed.has(ws)) return;
    this.closed.add(ws);
    const info = this.getPeerInfo(ws);
    try {
      ws.close();
    } catch {
      // `revoke` closed it first, with the code that matters; a second close has nothing to add.
    }
    if (!info) return;

    this.broadcast({ type: 'peer_leave', peerId: info.id });

    // Awaited, not fire-and-forget: an agent's socket is usually the last one
    // out, and after that there is nothing keeping this object alive.
    const pending: Promise<unknown>[] = [];
    if (isAgentPeer(info.id)) {
      pending.push(captureAgentLeft({ env: this.env, ctx: this.ctx, info, humans: this.countHumans(ws) }));
    }

    // Not `length === 0`: workerd defers dropping a terminating socket until
    // this handler's promise resolves, so the leaver is still listed here.
    // https://github.com/cloudflare/workerd/blob/main/src/workerd/io/legacy-hibernation-manager.c++
    if (this.ctx.getWebSockets().every((s) => s === ws)) {
      pending.push(this.stats.captureSession({ env: this.env, ctx: this.ctx }));
      // Flush now: a recent mutation could be lost if the object is evicted before
      // the alarm. A failed flush leaves the room dirty; the fresh alarm retries it.
      if (this.dirty) pending.push(this.alarm().catch(() => this.scheduleFlush()));
    }
    await Promise.all(pending);
  }

  /**
   * The flush rule: UPDATE unless this room created the row. An UPDATE that
   * touches nothing on a room that had a row means the row was deleted while
   * the room was warm — the ops are dropped, never written back, and the
   * sockets are closed. Deleted rooms are never recreated by a flush.
   */
  async alarm() {
    // A deadline alarm wakes a room evicted long ago, with nothing in memory to go on.
    await this.getOps();
    if (this.dead || !this.annotationId) return;
    const id = this.annotationId;
    // Cleared up front so an op landing mid-write keeps the room dirty.
    const ops = this.dirty ? this.ops : null;
    if (ops) this.dirty = false;
    const write = ops ? this.writeOps({ id, ops }) : null;
    const origin = this.origin ?? this.env.APP_ORIGIN ?? ORIGIN;
    // Settled rather than raced so a failing send cannot swallow the persist.
    const [persisted] = await Promise.allSettled([
      write,
      this.outbound.flush({
        db: this.env.DB,
        roomId: id,
        origin,
        pageUrl: this.url,
        ops: () => parseOps(this.ops ?? []),
      }),
    ]);
    if (persisted.status === 'rejected') {
      // Thrown so the runtime retries the alarm; swallowed, the ops since the last good flush were gone.
      this.dirty = true;
      throw persisted.reason;
    }
    if (ops) await this.persist({ seq: this.cursor() });
    if (!(await this.pastDeadline())) await this.armExpiry();
  }

  private async writeOps({ id, ops }: { id: string; ops: unknown[] }): Promise<void> {
    const store = annotationStore(this.env.DB);
    if (!this.rowExisted) {
      // False: the id is too weak to mint a room at. The door refuses such ids, so this is a room with no row to be.
      if (!(await store.create({ id, ops, url: this.url, width: this.width, expiresAt: this.expiresAt }))) {
        await this.rowGone();
        return;
      }
      this.rowExisted = true;
      await this.persist({ rowExisted: true });
      return;
    }
    if ((await store.putOps({ id, ops })) === 'gone') await this.rowGone();
  }

  /** The row went away under a warm room. Nothing it holds survives; see `dead`. */
  private async rowGone(): Promise<void> {
    this.dead = true;
    this.dirty = false;
    this.ops = [];
    this.rowExisted = false;
    this.httpAgents.clear();
    await this.persist({ rowExisted: false, dead: true });
    this.closeAll(ROOM_EXPIRED_CLOSE_CODE, 'room gone');
    this.wakeWatchers();
  }
}

/** RTC messages are matched by type and forwarded unread; `to` is the only field the room looks at. */
const RTC_TYPES: ReadonlySet<unknown> = new Set(RTC_MESSAGE_TYPES);
const rtcEnvelope = z.looseObject({
  type: z.enum(RTC_MESSAGE_TYPES),
  to: z.optional(z.unknown()),
});
