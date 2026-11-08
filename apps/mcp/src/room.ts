import type { PageReading, RoomTransport } from '@marklayer/agent-tools';
import { pageReadingSchema, RoomCore } from '@marklayer/agent-tools';
import { agentPresence } from '@marklayer/types/agents';
import type { ClientMsg, ServerMsg } from '@marklayer/types/wire';
import { ROOM_EXPIRED_CLOSE_CODE, ROOM_LOCKED_CLOSE_CODE, serverMsgSchema } from '@marklayer/types/wire';
import { nanoid } from 'nanoid';
import WebSocket from 'ws';
import { z } from 'zod/mini';

/** A published CLI outlives the Worker it first met: a field it cannot read must not strand it at connect. */
const lenient = <T extends z.ZodMiniType>(field: T) => z.catch(z.optional(z.nullable(field)), undefined);
const initSchema = z.object({
  type: z.literal('init'),
  ops: z.array(z.unknown()),
  url: lenient(z.string()),
  width: lenient(z.number()),
  createdAt: lenient(z.number()),
  expiresAt: lenient(z.number()),
  canEdit: z.catch(z.optional(z.boolean()), undefined),
});

function readMessage(data: string): ServerMsg | null {
  let raw: unknown;
  try {
    raw = JSON.parse(data);
  } catch {
    return null;
  }
  const init = initSchema.safeParse(raw);
  if (init.success) return init.data;
  const msg = serverMsgSchema.safeParse(raw);
  return msg.success ? msg.data : null;
}

/** What `watch` is parked on. Messages reach `RoomCore.apply` as they land, so waking carries nothing. */
interface Parked {
  wake(): void;
  fail(err: Error): void;
}

/** One room over a socket. Every failure rejects: this runs before MCP is wired up, so a hang reads as a dead server. */
class SocketTransport implements RoomTransport {
  private closedReason: string | null = null;
  private parked: Parked | null = null;
  private failJoin: ((err: Error) => void) | null = null;
  private readonly ws: WebSocket;
  private readonly roomId: string;
  private readonly apiBase: string;
  private readonly password: string | null;

  constructor({
    apiBase,
    roomId,
    agentId,
    session,
    password,
  }: {
    apiBase: string;
    roomId: string;
    agentId: string;
    session: string;
    password: string | null;
  }) {
    this.apiBase = apiBase;
    this.roomId = roomId;
    this.password = password;
    const { protocol, host } = new URL(apiBase);
    const { id, uid, name, color } = agentPresence({ agentId, session });
    const params = new URLSearchParams({ peerId: id, uid, name, color });
    const url = `${protocol === 'https:' ? 'wss:' : 'ws:'}//${host}/ws/${roomId}?${params}`;
    this.ws = new WebSocket(url, { headers: this.authHeaders() });
  }

  /** Feed `room` from the socket; resolves once its `init` has been applied. */
  join({ room, initTimeoutMs }: { room: RoomCore; initTimeoutMs: number }): Promise<void> {
    return new Promise((resolve, reject) => {
      this.failJoin = reject;
      const timer = setTimeout(() => {
        this.die(`no init payload within ${initTimeoutMs}ms`);
        this.ws.close();
      }, initTimeoutMs);
      this.ws.on('message', (data) => {
        const msg = readMessage(data.toString());
        if (!msg) return;
        room.apply(msg);
        if (msg.type === 'init') {
          clearTimeout(timer);
          this.failJoin = null;
          resolve();
        }
        this.parked?.wake();
      });
      this.ws.on('error', (err) => {
        clearTimeout(timer);
        this.die(err.message);
      });
      this.ws.on('close', (code) => {
        clearTimeout(timer);
        this.die(this.closeReason(code));
      });
    });
  }

  send(msg: ClientMsg): boolean {
    if (this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  wait(ms: number): Promise<ServerMsg[]> {
    return new Promise((resolve, reject) => {
      if (this.closedReason) return reject(this.roomError());
      const settle = () => {
        clearTimeout(timer);
        this.parked = null;
      };
      const timer = setTimeout(() => this.parked?.wake(), ms);
      this.parked = {
        wake: () => {
          settle();
          resolve([]);
        },
        fail: (err) => {
          settle();
          reject(err);
        },
      };
    });
  }

  /** The Worker owns the fetch, so the url it would be handed is already known there. */
  async readPage(): Promise<PageReading | null> {
    const res = await fetch(`${this.apiBase}/s/${this.roomId}/page.json`, { headers: this.authHeaders() }).catch(
      () => null,
    );
    if (!res?.ok) return null;
    const page = pageReadingSchema.safeParse(await res.json().catch(() => null));
    return page.success ? page.data : null;
  }

  /** Null while the socket is usable, otherwise why it is not. */
  disconnectedReason(): string | null {
    if (this.ws.readyState === WebSocket.OPEN) return null;
    return this.closedReason ?? 'not connected';
  }

  /** A write on a dead socket used to read as `annotation not found`, which sends an agent hunting for a good id. */
  checkLive(): string | null {
    const why = this.disconnectedReason();
    return why ? `room ${this.roomId} is not connected (${why}) — call marklayer_connect_room to reconnect` : null;
  }

  close(): void {
    this.die('client disconnected');
    this.ws.close();
  }

  private authHeaders(): Record<string, string> {
    return this.password ? { Authorization: `Bearer ${this.password}` } : {};
  }

  private closeReason(code: number): string {
    if (code === ROOM_EXPIRED_CLOSE_CODE) return 'this room has expired';
    if (code !== ROOM_LOCKED_CLOSE_CODE) return `socket closed (code ${code})`;
    return this.password
      ? 'the room refused the password (wrong, or changed since): set MARKLAYER_PASSWORD or pass `password` to marklayer_connect_room'
      : 'this room is password protected: set MARKLAYER_PASSWORD or pass `password` to marklayer_connect_room';
  }

  /** Latches the first reason, so a tool error says what happened rather than what followed from it. */
  private die(reason: string): void {
    this.closedReason ??= reason;
    const err = this.roomError();
    this.failJoin?.(err);
    this.failJoin = null;
    this.parked?.fail(err);
  }

  private roomError(): Error {
    return new Error(`room ${this.roomId}: ${this.closedReason}`);
  }
}

export interface ConnectedRoom {
  room: RoomCore;
  close(): void;
  disconnectedReason(): string | null;
}

/** Resolves once the room's `init` has landed, and rejects on every way that can fail to happen. */
export async function connectRoom({
  apiBase,
  roomId,
  agentId,
  password = null,
  readOnly = false,
  initTimeoutMs = 15_000,
}: {
  apiBase: string;
  roomId: string;
  agentId: string;
  /** For a password-protected link. Sent as a header, never in a URL a log could keep. */
  password?: string | null;
  /** Refuse every write tool, whatever the room allows. */
  readOnly?: boolean;
  initTimeoutMs?: number;
}): Promise<ConnectedRoom> {
  const session = nanoid();
  const transport = new SocketTransport({ apiBase, roomId, agentId, session, password });
  const room = new RoomCore({ roomId, agentId, session, transport, newId: nanoid, readOnlyByChoice: readOnly });
  await transport.join({ room, initTimeoutMs });
  return { room, close: () => transport.close(), disconnectedReason: () => transport.disconnectedReason() };
}
