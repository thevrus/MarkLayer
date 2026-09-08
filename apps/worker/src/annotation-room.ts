import { DurableObject } from 'cloudflare:workers';
import {
  applyOpPatch,
  type ClientMsg,
  canEditLink,
  clientMsgSchema,
  type DrawOp,
  effectiveExpiresAt,
  type LinkAccess,
  RTC_MESSAGE_TYPES,
  type RtcMessageType,
} from '@marklayer/types';
import { userFromCookieHeader } from './auth';
import { STUN_ONLY, stripPort53 } from './ice';
import { deliver, parseIntegrations } from './integrations/deliver';
import { type Notifiable, notifiableFrom } from './integrations/types';
import { isAgentPeer, type PeerInfo, readPeerInfo, sanitizeColor, sanitizeName, sanitizeUid } from './peers';
import { captureServer } from './posthog';
import { annotationStore } from './store';

interface Env {
  DB: D1Database;
  TURN_KEY_ID?: string;
  TURN_KEY_TOKEN?: string;
  POSTHOG_KEY?: string;
  POSTHOG_HOST?: string;
}

// TURN creds are tied to the worker's key (not per-room), so a module-level
// cache works for all DO instances on this isolate. `turnPromise` coalesces
// concurrent first-time fetches.
const TURN_TTL_SECONDS = 3600;
const STUN_FALLBACK_TTL_MS = 60_000;
let turnCache: { iceServers: RTCIceServer[]; expiresAt: number } | null = null;
let turnPromise: Promise<{ iceServers: RTCIceServer[]; ttlMs: number }> | null = null;

async function fetchIceServers(env: Env): Promise<{ iceServers: RTCIceServer[]; ttlMs: number }> {
  if (!env.TURN_KEY_ID || !env.TURN_KEY_TOKEN) return { iceServers: STUN_ONLY, ttlMs: STUN_FALLBACK_TTL_MS };
  try {
    const res = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.TURN_KEY_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ttl: TURN_TTL_SECONDS }),
      },
    );
    if (!res.ok) return { iceServers: STUN_ONLY, ttlMs: STUN_FALLBACK_TTL_MS };
    const data = (await res.json()) as { iceServers?: RTCIceServer[] };
    if (!data.iceServers?.length) return { iceServers: STUN_ONLY, ttlMs: STUN_FALLBACK_TTL_MS };
    const cleaned = data.iceServers.map(stripPort53).filter((s): s is RTCIceServer => s !== null);
    if (cleaned.length === 0) return { iceServers: STUN_ONLY, ttlMs: STUN_FALLBACK_TTL_MS };
    return { iceServers: cleaned, ttlMs: (TURN_TTL_SECONDS * 1000) / 2 };
  } catch {
    return { iceServers: STUN_ONLY, ttlMs: STUN_FALLBACK_TTL_MS };
  }
}

async function getIceServers(env: Env): Promise<RTCIceServer[]> {
  if (turnCache && turnCache.expiresAt > Date.now()) return turnCache.iceServers;
  if (turnPromise) return (await turnPromise).iceServers;
  // Set the cache inside the awaited promise so a caller arriving between
  // promise-settle and the next microtask still sees the result without
  // starting a duplicate fetch.
  turnPromise = fetchIceServers(env).then((result) => {
    turnCache = { iceServers: result.iceServers, expiresAt: Date.now() + result.ttlMs };
    return result;
  });
  try {
    return (await turnPromise).iceServers;
  } finally {
    turnPromise = null;
  }
}

/** Non-mutating types — always allowed. Everything else hits `rejectIfReadOnly`
 * first, so a new mutating type is guarded by default, not by someone remembering. */
const READ_ONLY_SAFE_TYPES = new Set<ClientMsg['type']>(['ping', 'cursor', 'ripple', 'profile', 'flock']);

/**
 * How long an agent stays in the peer list without calling again. Longer than
 * the longest `agentWatch`, so an agent parked in a watch is never dropped
 * mid-wait and then re-announced as if it had rejoined.
 */
const AGENT_PRESENCE_TTL_MS = 15 * 60_000;

/** What the remote MCP endpoint needs to answer any tool call, in one round trip. */
export interface AgentSnapshot {
  ops: unknown[];
  url: string | null;
  width: number | null;
  createdAt: number | null;
  expiresAt: number | null;
  /** False on a view-only link, so a mutator can say why rather than report a missing id. */
  canEdit: boolean;
}

export class AnnotationRoom extends DurableObject<Env> {
  private ops: unknown[] | null = null;
  /** In-flight load promise — coalesces concurrent first-message reads. */
  private opsPromise: Promise<unknown[]> | null = null;
  private dirty = false;
  private annotationId: string | null = null;
  private createdAt: number | null = null;
  private expiresAt: number | null = null;
  private url: string | null = null;
  private width: number | null = null;
  /** Who may edit. 'edit' is every link's default; 'view' is set only by the owner's Settings PATCH. */
  private access: LinkAccess = 'edit';
  private ownerId: string | null = null;
  private ownerExpiresAt: number | null = null;

  // Aggregate telemetry for one room session, emitted once when the last peer
  // leaves (see webSocketClose). Counting in memory rather than per-op keeps
  // this to a single event per session instead of one per pen stroke — cheaper,
  // and far less of a surveillance surface. Hibernation resets these, which is
  // fine: it is best-effort product signal, not billing.
  private sessionStartedAt = 0;
  private sessionOps = 0;
  /** tool → ops drawn with it this session. A set only ever said "used at all". */
  private sessionTools = new Map<string, number>();
  private peakPeers = 0;
  private peakHumanPeers = 0;
  private sessionHadAgent = false;
  /** Status, priority and assignee edits — the triage half, which draws no ops. */
  private sessionUpdates = 0;

  /**
   * Annotations written since the last outbound send. They ride the existing 3s
   * flush alarm rather than a timer of their own, which makes the debounce the
   * batching window too: ten comments in a burst arrive as one message.
   */
  private pendingNotifications: Notifiable[] = [];
  /**
   * Consecutive flushes where every destination failed. A revoked hook errors
   * forever, and a room that keeps retrying one pays for a request on every
   * flush, so it stops asking after three — the same circuit breaker the fetch
   * relay uses.
   */
  private deliveryFailures = 0;
  /** Public origin of the request that opened this room, for the "open the room" link. */
  private origin: string | null = null;

  /**
   * Agents attached over the remote MCP endpoint, which is HTTP and so holds no
   * socket to keep them present. They are kept here with a last-seen stamp and
   * folded into the peer list, so a person watching the room sees the agent the
   * same way they see anyone else. Every RPC call refreshes the stamp; one that
   * goes quiet for `AGENT_PRESENCE_TTL_MS` drops out on the next read. Losing
   * this map to hibernation is correct rather than a bug: nothing was holding
   * the room open, so nobody was there to see the agent anyway.
   */
  private httpAgents = new Map<string, { peer: Omit<PeerInfo, 'canEdit' | 'userId'>; lastSeen: number }>();
  /** Parked `agentWatch` calls, woken by the next op from any source. */
  private opWaiters: ((ops: unknown[]) => void)[] = [];

  private async getOps(id: string): Promise<unknown[]> {
    if (this.ops !== null) return this.ops;
    if (this.opsPromise) return this.opsPromise;
    this.opsPromise = this.loadOps(id);
    try {
      return await this.opsPromise;
    } finally {
      this.opsPromise = null;
    }
  }

  private async loadOps(id: string): Promise<unknown[]> {
    this.annotationId = id;
    const store = annotationStore(this.env.DB);
    const row = await store.get(id);
    this.ops = row?.ops ?? [];
    this.createdAt = row?.createdAt ?? null;
    this.expiresAt = row?.expiresAt ?? null;
    this.url = row?.url ?? null;
    this.width = row?.width ?? null;
    this.applyAccessRow(row);
    store.touch(id);
    return this.ops;
  }

  /** Sets `access`/`ownerId`/`ownerExpiresAt` from a row — shared by `loadOps` and `refreshAccess`. */
  private applyAccessRow(
    row: { access: LinkAccess; ownerId: string | null; ownerExpiresAt: number | null } | null,
  ): void {
    this.access = row?.access ?? 'edit';
    this.ownerId = row?.ownerId ?? null;
    this.ownerExpiresAt = row?.ownerExpiresAt ?? null;
  }

  /**
   * Parsed attachments, keyed by socket. The attachment is the source of truth
   * (it survives hibernation), but deserializing and re-validating it on every
   * message would tax every peer's every stroke, so the parse is memoized and a
   * fresh isolate simply refills it on first read.
   */
  private peerInfo = new WeakMap<WebSocket, PeerInfo>();

  /** Read peer metadata from the socket attachment — survives DO hibernation. */
  private getPeerInfo(ws: WebSocket): PeerInfo | null {
    const cached = this.peerInfo.get(ws);
    if (cached) return cached;
    const info = readPeerInfo(ws.deserializeAttachment());
    if (info) this.peerInfo.set(ws, info);
    return info;
  }

  /** Write peer metadata, keeping the memoized copy in step with the attachment. */
  private setPeerInfo(ws: WebSocket, info: PeerInfo) {
    ws.serializeAttachment(info);
    this.peerInfo.set(ws, info);
  }

  /**
   * Count an agent's work on its own socket attachment. Only agents are counted:
   * this costs a write per op, and the per-peer breakdown is only ever read for
   * `agent_left`. Humans stay on the cheap in-memory counters above.
   */
  private countAgentWork(ws: WebSocket, field: 'ops' | 'updates') {
    const info = this.getPeerInfo(ws);
    if (!info || !isAgentPeer(info.id)) return;
    this.setPeerInfo(ws, { ...info, [field]: (info[field] ?? 0) + 1 });
  }

  /** This room's access row applied to one socket's user. The rule itself is shared. */
  private canEditFor(userId: string | undefined): boolean {
    return canEditLink({ access: this.access, ownerId: this.ownerId, userId });
  }

  /**
   * Rejects a mutation from a peer whose own attachment says it may not edit.
   * `canEdit === false` only, never `!info`: a socket with no parsed info yet
   * (or one from before this shipped) defaults to allowed, matching `'edit'`
   * being every link's default.
   */
  private rejectIfReadOnly(ws: WebSocket): boolean {
    const info = this.getPeerInfo(ws);
    if (info?.canEdit === false) {
      ws.send(JSON.stringify({ type: 'error', code: 'read_only' }));
      return true;
    }
    return false;
  }

  /**
   * Live human peers, ignoring one socket.
   *
   * `exclude` is load-bearing: workerd keeps a terminating socket in
   * `getWebSockets()` for the whole of its close handler, so a leaving peer
   * counts itself unless the caller says otherwise.
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
   * against a runtime that someday does otherwise — and unlike clearing the
   * attachment it leans on no undocumented behaviour around `close()`.
   */
  private readonly closed = new WeakSet<WebSocket>();

  /** Strips `canEdit`/`userId` before peers see each other — bookkeeping for this
   * room, not something one peer should read off another. */

  // ---------------------------------------------------------------------------
  // Remote MCP surface. Called by RPC from the Worker's `/s/:id/mcp` handler,
  // which is stateless by design: the session lives here, in the room that
  // already owns the ops, the peers and the broadcast, rather than in a second
  // Durable Object standing beside it.
  // ---------------------------------------------------------------------------

  /** Keep an HTTP-attached agent in the peer list; announce it the first time. */
  async agentHeartbeat(id: string, peer: { id: string; name: string; color: string }): Promise<void> {
    await this.getOps(id);
    const known = this.httpAgents.has(peer.id);
    this.httpAgents.set(peer.id, { peer: { id: peer.id, name: peer.name, color: peer.color }, lastSeen: Date.now() });
    if (!known) {
      this.sessionHadAgent = true;
      this.broadcast(JSON.stringify({ type: 'peer_join', peer: { id: peer.id, name: peer.name, color: peer.color } }));
    }
  }

  async agentSnapshot(id: string): Promise<AgentSnapshot> {
    const ops = await this.getOps(id);
    // The owner may have flipped the link since this isolate loaded it, and an
    // HTTP agent has no `init` message to carry a later value to it.
    await this.refreshAccess(id);
    return {
      ops,
      url: this.url,
      width: this.width,
      createdAt: this.createdAt,
      expiresAt: effectiveExpiresAt({ expiresAt: this.expiresAt, ownerExpiresAt: this.ownerExpiresAt }),
      canEdit: this.canEditFor(undefined),
    };
  }

  /** Append one op. `false` means the link is view-only — never that the write failed silently. */
  async agentPushOp(id: string, op: DrawOp): Promise<boolean> {
    const ops = await this.getOps(id);
    await this.refreshAccess(id);
    if (!this.canEditFor(undefined)) return false;
    ops.push(op);
    this.sessionOps++;
    this.sessionTools.set(op.tool, (this.sessionTools.get(op.tool) ?? 0) + 1);
    this.broadcast(JSON.stringify({ type: 'op', op }));
    this.wakeWatchers([op]);
    const notifiable = notifiableFrom(op);
    if (notifiable) this.pendingNotifications.push(notifiable);
    await this.scheduleFlush();
    return true;
  }

  /** Patch an op. `false` is view-only or no such op; the caller tells those apart from the snapshot. */
  async agentPatchOp(id: string, opId: string, patch: Record<string, unknown>): Promise<boolean> {
    const ops = await this.getOps(id);
    await this.refreshAccess(id);
    if (!this.canEditFor(undefined)) return false;
    const idx = ops.findIndex((o) => typeof o === 'object' && o !== null && 'id' in o && o.id === opId);
    if (idx === -1) return false;
    const current = ops[idx];
    if (!current) return false;
    const merged = applyOpPatch({ op: current, patch });
    if (!merged) return false;
    ops[idx] = merged;
    this.sessionUpdates++;
    this.broadcast(JSON.stringify({ type: 'update_op', opId, patch }));
    await this.scheduleFlush();
    return true;
  }

  /**
   * Park until ops arrive, or the timeout expires. A promise held here rather
   * than a poll from the handler: the request keeps this object resident for its
   * duration, so there is nothing to hibernate out from under it, and a watching
   * agent costs one call instead of one per second.
   */
  async agentWatch(id: string, { timeoutMs }: { timeoutMs: number }): Promise<unknown[]> {
    await this.getOps(id);
    return new Promise<unknown[]>((resolve) => {
      let done = false;
      const finish = (ops: unknown[]) => {
        if (done) return;
        done = true;
        this.opWaiters = this.opWaiters.filter((w) => w !== waiter);
        resolve(ops);
      };
      const waiter = (ops: unknown[]) => finish(ops);
      this.opWaiters.push(waiter);
      setTimeout(() => finish([]), timeoutMs);
    });
  }

  private wakeWatchers(ops: unknown[]): void {
    if (this.opWaiters.length === 0) return;
    const waiters = this.opWaiters;
    this.opWaiters = [];
    for (const wake of waiters) wake(ops);
  }

  private getPeerList(): Omit<PeerInfo, 'canEdit' | 'userId'>[] {
    const list: Omit<PeerInfo, 'canEdit' | 'userId'>[] = [];
    for (const ws of this.ctx.getWebSockets()) {
      const info = this.getPeerInfo(ws);
      if (info) {
        const { canEdit: _canEdit, userId: _userId, ...peer } = info;
        list.push(peer);
      }
    }
    const cutoff = Date.now() - AGENT_PRESENCE_TTL_MS;
    for (const [peerId, entry] of this.httpAgents) {
      if (entry.lastSeen < cutoff) {
        this.httpAgents.delete(peerId);
        this.broadcast(JSON.stringify({ type: 'peer_leave', peerId }));
        continue;
      }
      list.push(entry.peer);
    }
    return list;
  }

  private broadcast(msg: string, exclude?: WebSocket) {
    for (const ws of this.ctx.getWebSockets()) {
      if (ws !== exclude && ws.readyState === WebSocket.OPEN) {
        ws.send(msg);
      }
    }
  }

  private async scheduleFlush() {
    this.dirty = true;
    // Debounce: flush 3 seconds after last mutation
    await this.ctx.storage.setAlarm(Date.now() + 3000);
  }

  /**
   * The owner changed who may edit while this room may be warm. `loadOps` runs
   * once per isolate, so without this a flip to view-only would bite only after
   * the next eviction — and the owner's own tab keeps the room resident.
   */
  private async refreshAccess(id: string): Promise<void> {
    const row = await annotationStore(this.env.DB).getAccess(id);
    this.applyAccessRow(row);
    for (const ws of this.ctx.getWebSockets()) {
      const info = this.getPeerInfo(ws);
      if (!info) continue;
      const canEdit = this.canEditFor(info.userId);
      if (canEdit === (info.canEdit ?? true)) continue;
      this.setPeerInfo(ws, { ...info, canEdit });
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'access', canEdit }));
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    if (!id) return new Response('Missing id', { status: 400 });

    // Not a peer: the settings route poking a warm room. Checked before `origin`
    // is recorded, since this request's origin is not one a person can open.
    if (request.method === 'POST' && url.pathname === '/refresh-access') {
      await this.refreshAccess(id);
      return new Response(null, { status: 204 });
    }

    this.origin = url.origin;

    const peerId = url.searchParams.get('peerId') || crypto.randomUUID();
    const peerName = sanitizeName(url.searchParams.get('name'));
    const peerColor = sanitizeColor(url.searchParams.get('color'));
    const peerUid = sanitizeUid(url.searchParams.get('uid'));

    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1], [id]);

    // Run getOps, the TURN fetch and the connecting user's session lookup
    // concurrently — all three are network-bound and independent, so this
    // hides their latency behind each other instead of stacking round trips.
    // getOps is what fills in this.access/this.ownerId (via loadOps), so canEdit
    // can only be resolved once this resolves.
    const [ops, iceServers, user] = await Promise.all([
      this.getOps(id),
      getIceServers(this.env),
      userFromCookieHeader({ header: request.headers.get('Cookie'), db: this.env.DB }),
    ]);
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

    if (this.sessionStartedAt === 0) this.sessionStartedAt = Date.now();
    // The MCP bridge joins as an ordinary peer under an `mcp-` id (apps/mcp/src/room.ts),
    // so a room worked by an agent is countable without the client reporting
    // anything — and an agent must not make a solo session read as collaborative.
    this.sessionHadAgent ||= isAgentPeer(peerId);
    const sockets = this.ctx.getWebSockets();
    this.peakPeers = Math.max(this.peakPeers, sockets.length);
    const humans = this.countHumans();
    this.peakHumanPeers = Math.max(this.peakHumanPeers, humans);

    const peerList = this.getPeerList();
    pair[1].send(
      JSON.stringify({
        type: 'init',
        ops,
        peers: peerList,
        createdAt: this.createdAt,
        // The tighter of the two deadlines: the client has one `expiresAt`
        // concept and must not learn about a link's own expiry while missing
        // its owner's, or the info panel counts down to the wrong date.
        expiresAt: effectiveExpiresAt({ expiresAt: this.expiresAt, ownerExpiresAt: this.ownerExpiresAt }),
        url: this.url,
        width: this.width,
        access: this.access,
        canEdit,
        iceServers,
      }),
    );

    // Notify others of new peer joining
    this.broadcast(
      JSON.stringify({
        type: 'peer_join',
        peer: { id: peerId, uid: peerUid, name: peerName, color: peerColor },
      }),
      pair[1],
    );

    // Awaited before the 101 goes out. An accepted hibernatable socket does not
    // keep this object resident — hibernating with the socket open is the whole
    // point of the API — and an unawaited fetch neither blocks hibernation nor
    // gets any delivery guarantee. Awaiting is what makes it pending I/O.
    // https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/
    if (isAgentPeer(peerId)) {
      await captureServer(this.env, this.ctx, 'agent_joined', {
        // Whether the agent is working alongside someone or on its own — the
        // difference between a live handoff and an unattended sweep.
        humans_present: humans,
        peers_present: sockets.length,
        ops_waiting: ops.length,
      });
    }
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
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
    const rawType = (raw as { type?: unknown }).type;
    if (typeof rawType === 'string' && (RTC_MESSAGE_TYPES as readonly string[]).includes(rawType)) {
      if (rawType === 'rtc_request_ice') {
        // Sender wants fresh TURN creds (likely an ICE restart in progress).
        // Broadcast to every socket in the room — if only the requester updates,
        // its peer keeps stale creds and the restart half-completes once the
        // remote relay rejects the old auth. Clients no-op when the URL set is
        // unchanged (see iceServersEqual in useRealtimeSync).
        getIceServers(this.env)
          .then((iceServers) => {
            this.broadcast(JSON.stringify({ type: 'ice_refresh', iceServers }));
          })
          .catch(() => {});
        return;
      }
      this.relayRtc(ws, raw as { type: RtcMessageType; to?: unknown });
      return;
    }

    const parsed = clientMsgSchema.safeParse(raw);
    if (!parsed.success) return;
    const msg = parsed.data;

    const tags = this.ctx.getTags(ws);
    const id = tags[0] || this.annotationId;
    if (!id && msg.type !== 'ping') return;

    if (!READ_ONLY_SAFE_TYPES.has(msg.type) && this.rejectIfReadOnly(ws)) return;

    switch (msg.type) {
      case 'op': {
        const ops = await this.getOps(id!);
        ops.push(msg.op);
        this.sessionOps++;
        this.countAgentWork(ws, 'ops');
        this.sessionTools.set(msg.op.tool, (this.sessionTools.get(msg.op.tool) ?? 0) + 1);
        this.broadcast(JSON.stringify({ type: 'op', op: msg.op }), ws);
        this.wakeWatchers([msg.op]);
        const notifiable = notifiableFrom(msg.op);
        if (notifiable) this.pendingNotifications.push(notifiable);
        await this.scheduleFlush();
        return;
      }
      case 'update_op': {
        const ops = await this.getOps(id!);
        const idx = ops.findIndex(
          (o) => typeof o === 'object' && o !== null && 'id' in o && (o as { id: unknown }).id === msg.opId,
        );
        if (idx === -1) return;
        const current = ops[idx];
        if (!current) return;
        // Reject rather than broadcast: this is the one path that persists a patched op.
        const merged = applyOpPatch({ op: current, patch: msg.patch });
        if (!merged) return;
        ops[idx] = merged;
        this.sessionUpdates++;
        this.countAgentWork(ws, 'updates');
        this.broadcast(JSON.stringify({ type: 'update_op', opId: msg.opId, patch: msg.patch }));
        await this.scheduleFlush();
        return;
      }
      case 'undo': {
        const ops = await this.getOps(id!);
        const idx = ops.findIndex(
          (o) => typeof o === 'object' && o !== null && 'id' in o && (o as { id: unknown }).id === msg.opId,
        );
        if (idx === -1) return;
        ops.splice(idx, 1);
        this.broadcast(JSON.stringify({ type: 'undo', opId: msg.opId }), ws);
        await this.scheduleFlush();
        return;
      }
      case 'clear': {
        const ops = await this.getOps(id!);
        ops.length = 0;
        this.broadcast(JSON.stringify({ type: 'clear' }), ws);
        await this.scheduleFlush();
        return;
      }
      case 'ping': {
        ws.send('{"type":"pong"}');
        return;
      }
      case 'cursor': {
        const info = this.getPeerInfo(ws);
        if (!info) return;
        this.broadcast(
          JSON.stringify({
            type: 'cursor',
            peerId: info.id,
            name: info.name,
            color: info.color,
            x: msg.x,
            y: msg.y,
            tool: msg.tool,
          }),
          ws,
        );
        return;
      }
      case 'ripple': {
        const info = this.getPeerInfo(ws);
        if (!info) return;
        this.broadcast(
          JSON.stringify({
            type: 'ripple',
            peerId: info.id,
            color: info.color,
            x: msg.x,
            y: msg.y,
          }),
          ws,
        );
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
        this.broadcast(JSON.stringify({ type: 'profile', peerId: next.id, name: next.name, color: next.color }), ws);
        return;
      }
      case 'flock': {
        const info = this.getPeerInfo(ws);
        if (!info) return;
        // Not persisted and not replayed on join: presenting is a live gesture,
        // so someone arriving after it started is not dragged into it.
        this.broadcast(JSON.stringify({ type: 'flock', peerId: info.id, name: info.name, on: msg.on }), ws);
        return;
      }
    }
  }

  private relayRtc(ws: WebSocket, msg: { type: RtcMessageType; to?: unknown }) {
    const from = this.getPeerInfo(ws);
    if (!from || typeof msg.to !== 'string') return;
    for (const sock of this.ctx.getWebSockets()) {
      const info = this.getPeerInfo(sock);
      if (info?.id === msg.to && sock.readyState === WebSocket.OPEN) {
        sock.send(JSON.stringify({ ...msg, from: from.id }));
        return;
      }
    }
  }

  async webSocketClose(ws: WebSocket) {
    await this.teardown(ws);
  }

  /**
   * One exit path for both a clean close and an errored one.
   *
   * `webSocketError` used to only close the socket, which lost two things on
   * every abrupt disconnect — the common case, since a closed tab rarely sends
   * a close frame. Peers kept a ghost in their presence list because no
   * `peer_leave` went out, and the session was never counted at all.
   *
   * Idempotent by way of the attachment: it is cleared before the socket is
   * closed, so a second handler for the same socket finds no peer and returns.
   */
  private async teardown(ws: WebSocket) {
    if (this.closed.has(ws)) return;
    this.closed.add(ws);
    const info = this.getPeerInfo(ws);
    ws.close();
    if (!info) return;

    this.broadcast(JSON.stringify({ type: 'peer_leave', peerId: info.id }));

    // Awaited, not fire-and-forget: an agent's socket is usually the last one
    // out, and after that there is nothing keeping this object alive. Started
    // together and awaited once — two PostHog posts and a D1 flush that share
    // no state, so serializing them would only lengthen the window the object
    // has to survive.
    const pending: Promise<unknown>[] = [];
    if (isAgentPeer(info.id)) {
      pending.push(
        captureServer(this.env, this.ctx, 'agent_left', {
          ops_total: info.ops ?? 0,
          updates_total: info.updates ?? 0,
          // How long the agent held the room. `watch` idles here; `resolve` does not.
          duration_ms: info.joinedAt ? Date.now() - info.joinedAt : 0,
          // Did anyone see it happen, or did it work an empty room?
          humans_present: this.countHumans(ws),
        }),
      );
    }

    // Not `length === 0`: workerd defers dropping a terminating socket until
    // this handler's promise resolves, so the leaver is still listed here. That
    // is why the session event never once fired — the condition could not be
    // true. https://github.com/cloudflare/workerd/blob/main/src/workerd/io/legacy-hibernation-manager.c++
    if (this.ctx.getWebSockets().every((s) => s === ws)) {
      pending.push(this.captureSession());
      // Flush immediately when the last peer leaves — otherwise a recent mutation
      // (e.g. an MCP agent's status change) could be lost if the DO is evicted
      // before the 3s alarm fires.
      if (this.dirty) pending.push(this.alarm());
    }
    await Promise.all(pending);
  }

  /**
   * One aggregate event per room session, fired as the last peer disconnects.
   *
   * Answers the questions we actually act on — which tools earn their place,
   * how often a room is genuinely collaborative — without following anyone
   * around. No room ID, no annotated URL, no peer names: `tools` is a sorted
   * set of tool names and the rest are counters. See src/posthog.ts for the
   * wider contract (and the scrubber that backstops it).
   */
  private async captureSession() {
    // An agent-only session draws nothing — it resolves and replies — so ops alone
    // would drop exactly the sessions the MCP bridge exists for.
    if (this.sessionOps === 0 && this.sessionUpdates === 0 && !this.sessionHadAgent) return;
    // Heaviest first, and only the top few: `top_tool` charts with nothing to
    // parse, and the ranking has to stay well inside the scrubber's 200-char cap
    // (src/posthog.ts), which would otherwise truncate it mid-entry.
    const byUse = [...this.sessionTools].sort((a, b) => b[1] - a[1]).slice(0, 5);
    // Started before the counters are reset, awaited after — the reset is
    // synchronous, so the event carries the session it describes.
    const sent = captureServer(this.env, this.ctx, 'annotation_session_ended', {
      ops_total: this.sessionOps,
      tools: [...this.sessionTools.keys()].sort().join(','),
      tool_ops: byUse.map(([tool, n]) => `${tool}:${n}`).join(','),
      top_tool: byUse[0]?.[0] ?? null,
      tool_count: this.sessionTools.size,
      peak_peers: this.peakPeers,
      peak_human_peers: this.peakHumanPeers,
      collaborative: this.peakHumanPeers > 1,
      agent_present: this.sessionHadAgent,
      updates_total: this.sessionUpdates,
      duration_ms: this.sessionStartedAt ? Date.now() - this.sessionStartedAt : 0,
    });
    this.sessionOps = 0;
    this.sessionTools.clear();
    this.peakPeers = 0;
    this.peakHumanPeers = 0;
    this.sessionHadAgent = false;
    this.sessionUpdates = 0;
    this.sessionStartedAt = 0;
    await sent;
  }

  async webSocketError(ws: WebSocket) {
    await this.teardown(ws);
  }

  async alarm() {
    const id = this.annotationId;
    if (!id) return;
    // Independent: the ops write touches a different column from the one the
    // notification flush reads, and neither needs the other's result. Settled
    // rather than raced so a failing send cannot swallow the persist.
    const write = this.dirty && this.ops ? annotationStore(this.env.DB).putOps({ id, ops: this.ops }) : null;
    if (write) this.dirty = false;
    await Promise.allSettled([write, this.flushNotifications(id)]);
  }

  /**
   * Send the batch to every destination the room has, if it has any.
   *
   * Drains `pendingNotifications` before awaiting anything: a send that fails
   * must not replay the same annotations on the next flush, and a send that is
   * slow must not block the ops arriving while it is in flight.
   */
  private async flushNotifications(id: string) {
    if (this.pendingNotifications.length === 0) return;
    const items = this.pendingNotifications;
    this.pendingNotifications = [];
    // Drained before the breaker is consulted: a room whose hook was revoked
    // still discards each batch, rather than accumulating every comment it ever
    // sees in memory for the life of the instance.
    if (this.deliveryFailures >= 3) return;

    const row = await annotationStore(this.env.DB).getIntegrations(id);
    const integrations = parseIntegrations(row?.integrations ?? null);
    if (integrations.length === 0) return;

    const { sent } = await deliver({
      integrations,
      event: { type: 'annotations.created', items },
      roomUrl: `${this.origin ?? 'https://marklayer.app'}/s/${id}`,
      pageUrl: this.url,
    });
    // One destination succeeding is enough to say the room is still wired up.
    this.deliveryFailures = sent > 0 ? 0 : this.deliveryFailures + 1;
  }
}
