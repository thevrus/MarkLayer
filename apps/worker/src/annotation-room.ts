import { DurableObject } from 'cloudflare:workers';

interface Env {
  DB: D1Database;
}

export class AnnotationRoom extends DurableObject<Env> {
  private ops: unknown[] | null = null;
  private dirty = false;
  private annotationId: string | null = null;
  private createdAt: number | null = null;
  private expiresAt: number | null = null;
  private url: string | null = null;
  private width: number | null = null;
  /** Map WebSocket → { peerId, name, color } for presence */
  private peerInfo = new Map<WebSocket, { id: string; name: string; color: string }>();

  private async getOps(id: string): Promise<unknown[]> {
    if (this.ops !== null) return this.ops;
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
    const peerName = url.searchParams.get('name') || 'Anonymous';
    const peerColor = url.searchParams.get('color') || '#8b5cf6';

    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1], [id]);

    this.peerInfo.set(pair[1], {
      id: peerId,
      name: peerName,
      color: peerColor,
    });

    const ops = await this.getOps(id);
    // Send init + current peer list
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

  private getPeerList(): { id: string; name: string; color: string }[] {
    const list: { id: string; name: string; color: string }[] = [];
    for (const info of this.peerInfo.values()) {
      list.push(info);
    }
    return list;
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (typeof message !== 'string') return;

    try {
      const msg = JSON.parse(message);
      const tags = this.ctx.getTags(ws);
      const id = tags[0] || this.annotationId;
      if (!id) return;

      switch (msg.type) {
        case 'op': {
          const ops = await this.getOps(id);
          ops.push(msg.op);
          this.broadcast(JSON.stringify({ type: 'op', op: msg.op }), ws);
          await this.scheduleFlush();
          break;
        }
        case 'undo': {
          const ops = await this.getOps(id);
          if (msg.opId) {
            const idx = ops.findIndex((o) => (o as Record<string, unknown>).id === msg.opId);
            if (idx !== -1) {
              ops.splice(idx, 1);
              this.broadcast(JSON.stringify({ type: 'undo', opId: msg.opId }), ws);
              await this.scheduleFlush();
            }
          }
          break;
        }
        case 'clear': {
          const ops = await this.getOps(id);
          ops.length = 0;
          this.broadcast(JSON.stringify({ type: 'clear' }), ws);
          await this.scheduleFlush();
          break;
        }
        case 'ping': {
          ws.send('{"type":"pong"}');
          break;
        }
        case 'cursor': {
          const info = this.peerInfo.get(ws);
          if (info) {
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
          }
          break;
        }
        case 'profile': {
          const info = this.peerInfo.get(ws);
          if (info) {
            if (msg.name) info.name = msg.name;
            if (msg.color) info.color = msg.color;
            this.broadcast(
              JSON.stringify({ type: 'profile', peerId: info.id, name: info.name, color: info.color }),
              ws,
            );
          }
          break;
        }
        // WebRTC signaling relay — forward to target peer
        case 'rtc_offer':
        case 'rtc_answer':
        case 'rtc_ice': {
          const from = this.peerInfo.get(ws);
          if (!from || !msg.to) break;
          for (const [sock, info] of this.peerInfo) {
            if (info.id === msg.to && sock.readyState === WebSocket.OPEN) {
              sock.send(JSON.stringify({ ...msg, from: from.id }));
              break;
            }
          }
          break;
        }
      }
    } catch {
      // Ignore malformed messages
    }
  }

  async webSocketClose(ws: WebSocket) {
    const info = this.peerInfo.get(ws);
    this.peerInfo.delete(ws);
    ws.close();
    if (info) {
      this.broadcast(JSON.stringify({ type: 'peer_leave', peerId: info.id }));
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
