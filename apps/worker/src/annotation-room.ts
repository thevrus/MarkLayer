import { DurableObject } from 'cloudflare:workers';
import { clientMsgSchema, RTC_MESSAGE_TYPES, type RtcMessageType } from '@marklayer/types';

interface Env {
  DB: D1Database;
  TURN_KEY_ID?: string;
  TURN_KEY_TOKEN?: string;
}

interface PeerInfo {
  id: string;
  name: string;
  color: string;
}

const DEFAULT_COLOR = '#8b5cf6';
const COLOR_RE = /^#[0-9a-f]{6}$/i;
const MAX_NAME_LEN = 64;

function sanitizeName(n: unknown, fallback = 'Anonymous'): string {
  if (typeof n !== 'string') return fallback;
  const trimmed = n.trim().slice(0, MAX_NAME_LEN);
  return trimmed || fallback;
}

function sanitizeColor(c: unknown, fallback = DEFAULT_COLOR): string {
  return typeof c === 'string' && COLOR_RE.test(c) ? c : fallback;
}

// TURN creds are tied to the worker's key (not per-room), so a module-level
// cache works for all DO instances on this isolate. `turnPromise` coalesces
// concurrent first-time fetches.
const STUN_ONLY: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }];
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
    // Refresh well before expiry.
    return { iceServers: data.iceServers, ttlMs: (TURN_TTL_SECONDS * 1000) / 2 };
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

function isPeerInfo(v: unknown): v is PeerInfo {
  return (
    !!v &&
    typeof v === 'object' &&
    'id' in v &&
    typeof (v as { id: unknown }).id === 'string' &&
    'name' in v &&
    typeof (v as { name: unknown }).name === 'string' &&
    'color' in v &&
    typeof (v as { color: unknown }).color === 'string'
  );
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
    const row = await this.env.DB.prepare(
      'SELECT ops, url, width, created_at, expires_at FROM annotations WHERE id = ?',
    )
      .bind(id)
      .first<{
        ops: string;
        url: string | null;
        width: number | null;
        created_at: number | null;
        expires_at: number | null;
      }>();
    this.ops = row ? JSON.parse(row.ops) : [];
    this.createdAt = row?.created_at ?? null;
    this.expiresAt = row?.expires_at ?? null;
    this.url = row?.url ?? null;
    this.width = row?.width ?? null;
    // Touch last_accessed_at
    this.env.DB.prepare('UPDATE annotations SET last_accessed_at = unixepoch() WHERE id = ?').bind(id).run();
    return this.ops!;
  }

  /** Read peer metadata from the socket attachment — survives DO hibernation. */
  private getPeerInfo(ws: WebSocket): PeerInfo | null {
    const att = ws.deserializeAttachment();
    return isPeerInfo(att) ? att : null;
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

    const peerId = url.searchParams.get('peerId') || crypto.randomUUID();
    const peerName = sanitizeName(url.searchParams.get('name'));
    const peerColor = sanitizeColor(url.searchParams.get('color'));

    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1], [id]);
    pair[1].serializeAttachment({ id: peerId, name: peerName, color: peerColor });

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
        peer: { id: peerId, name: peerName, color: peerColor },
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
        this.broadcast(JSON.stringify({ type: 'op', op: msg.op }), ws);
        await this.scheduleFlush();
        return;
      }
      case 'update_op': {
        const ops = await this.getOps(id!);
        const idx = ops.findIndex(
          (o) => typeof o === 'object' && o !== null && 'id' in o && (o as { id: unknown }).id === msg.opId,
        );
        if (idx === -1) return;
        ops[idx] = { ...(ops[idx] as object), ...msg.patch };
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
      case 'profile': {
        const info = this.getPeerInfo(ws);
        if (!info) return;
        const next: PeerInfo = {
          id: info.id,
          name: sanitizeName(msg.name, info.name),
          color: sanitizeColor(msg.color, info.color),
        };
        ws.serializeAttachment(next);
        this.broadcast(JSON.stringify({ type: 'profile', peerId: next.id, name: next.name, color: next.color }), ws);
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
    if (this.dirty && this.ctx.getWebSockets().length === 0) {
      // Flush immediately when the last peer leaves — otherwise a recent mutation
      // (e.g. an MCP agent's status change) could be lost if the DO is evicted
      // before the 3s alarm fires.
      await this.alarm();
    }
  }

  async webSocketError(ws: WebSocket) {
    ws.close();
  }

  async alarm() {
    if (!this.dirty || !this.ops || !this.annotationId) return;
    this.dirty = false;
    await this.env.DB.prepare(
      `INSERT INTO annotations (id, ops, last_accessed_at) VALUES (?, ?, unixepoch())
       ON CONFLICT(id) DO UPDATE SET ops = excluded.ops, last_accessed_at = unixepoch()`,
    )
      .bind(this.annotationId, JSON.stringify(this.ops))
      .run();
  }
}
