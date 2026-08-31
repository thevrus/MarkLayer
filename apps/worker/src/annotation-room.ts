import { DurableObject } from 'cloudflare:workers';
import { applyOpPatch, clientMsgSchema, RTC_MESSAGE_TYPES, type RtcMessageType } from '@marklayer/types';
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
    store.touch(id);
    return this.ops;
  }

  /** Read peer metadata from the socket attachment — survives DO hibernation. */
  private getPeerInfo(ws: WebSocket): PeerInfo | null {
    return readPeerInfo(ws.deserializeAttachment());
  }

  private getPeerList(): PeerInfo[] {
    const list: PeerInfo[] = [];
    for (const ws of this.ctx.getWebSockets()) {
      const info = this.getPeerInfo(ws);
      if (info) list.push(info);
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

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    if (!id) return new Response('Missing id', { status: 400 });

    this.origin = url.origin;

    const peerId = url.searchParams.get('peerId') || crypto.randomUUID();
    const peerName = sanitizeName(url.searchParams.get('name'));
    const peerColor = sanitizeColor(url.searchParams.get('color'));
    const peerUid = sanitizeUid(url.searchParams.get('uid'));

    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1], [id]);
    pair[1].serializeAttachment({ id: peerId, uid: peerUid, name: peerName, color: peerColor });

    if (this.sessionStartedAt === 0) this.sessionStartedAt = Date.now();
    // The MCP bridge joins as an ordinary peer under an `mcp-` id (apps/mcp/src/room.ts),
    // so a room worked by an agent is countable without the client reporting
    // anything — and an agent must not make a solo session read as collaborative.
    this.sessionHadAgent ||= isAgentPeer(peerId);
    const sockets = this.ctx.getWebSockets();
    this.peakPeers = Math.max(this.peakPeers, sockets.length);
    const humans = sockets.filter((s) => !isAgentPeer(this.getPeerInfo(s)?.id ?? '')).length;
    this.peakHumanPeers = Math.max(this.peakHumanPeers, humans);

    // Run getOps and the TURN fetch concurrently — both are network-bound and
    // independent, so this hides the TURN latency behind D1's read RTT.
    const [ops, iceServers] = await Promise.all([this.getOps(id), getIceServers(this.env)]);
    const peerList = this.getPeerList();
    pair[1].send(
      JSON.stringify({
        type: 'init',
        ops,
        peers: peerList,
        createdAt: this.createdAt,
        expiresAt: this.expiresAt,
        url: this.url,
        width: this.width,
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

    switch (msg.type) {
      case 'op': {
        const ops = await this.getOps(id!);
        ops.push(msg.op);
        this.sessionOps++;
        this.sessionTools.set(msg.op.tool, (this.sessionTools.get(msg.op.tool) ?? 0) + 1);
        this.broadcast(JSON.stringify({ type: 'op', op: msg.op }), ws);
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
        ws.serializeAttachment(next);
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
    const info = this.getPeerInfo(ws);
    ws.close();
    if (info) {
      this.broadcast(JSON.stringify({ type: 'peer_leave', peerId: info.id }));
    }
    if (this.ctx.getWebSockets().length === 0) {
      this.captureSession();
      if (this.dirty) {
        // Flush immediately when the last peer leaves — otherwise a recent mutation
        // (e.g. an MCP agent's status change) could be lost if the DO is evicted
        // before the 3s alarm fires.
        await this.alarm();
      }
    }
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
  private captureSession() {
    // An agent-only session draws nothing — it resolves and replies — so ops alone
    // would drop exactly the sessions the MCP bridge exists for.
    if (this.sessionOps === 0 && this.sessionUpdates === 0 && !this.sessionHadAgent) return;
    // Heaviest first, and only the top few: `top_tool` charts with nothing to
    // parse, and the ranking has to stay well inside the scrubber's 200-char cap
    // (src/posthog.ts), which would otherwise truncate it mid-entry.
    const byUse = [...this.sessionTools].sort((a, b) => b[1] - a[1]).slice(0, 5);
    captureServer(this.env, this.ctx, 'annotation_session_ended', {
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
  }

  async webSocketError(ws: WebSocket) {
    ws.close();
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
