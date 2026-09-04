import {
  type AnnotationOp,
  applyOpPatch,
  type CommentOp,
  type CommentStatus,
  type DrawOp,
  drawOpSchema,
  isAnnotationOp,
  opAnchor,
  opsArraySchema,
  resolveOpStatus,
} from '@marklayer/types';
import { nanoid } from 'nanoid';
import WebSocket from 'ws';

export type { AnnotationOp };
export { resolveOpStatus as resolveStatus };

/** Watchable = annotation op that should fan out to MCP listeners (comment replies do not). */
function isWatchable(op: DrawOp): op is AnnotationOp {
  return isAnnotationOp(op) && !(op.tool === 'comment' && !!op.parentId);
}

export interface RoomMeta {
  url: string | null;
  width: number | null;
  createdAt: number | null;
  expiresAt: number | null;
}

interface PendingNew {
  resolve: (ops: AnnotationOp[]) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
  flushTimer: ReturnType<typeof setTimeout> | null;
  buffer: AnnotationOp[];
}

const AGENT_NAME = 'Claude Code';
const AGENT_COLOR = '#8b5cf6';

export class RoomClient {
  private ws: WebSocket | null = null;
  private ops: DrawOp[] = [];
  private meta: RoomMeta = { url: null, width: null, createdAt: null, expiresAt: null };
  private initResolve: (() => void) | null = null;
  private initReject: ((err: Error) => void) | null = null;
  private initPromise: Promise<void>;
  private closedReason: string | null = null;
  private pending: PendingNew | null = null;
  private peerId = `mcp-${nanoid()}`;

  constructor(
    private readonly apiBase: string,
    public readonly roomId: string,
    private readonly agentId: string,
  ) {
    this.initPromise = new Promise((resolve, reject) => {
      this.initResolve = resolve;
      this.initReject = reject;
    });
    // Nothing awaits initPromise until connect(), so an early rejection would be
    // an unhandled rejection that kills the process before the tool can report it.
    this.initPromise.catch(() => {});
  }

  /**
   * Connect and resolve once the room init payload is received. Every failure
   * path has to reject rather than hang: this runs before the MCP transport is
   * wired up, so a stuck connect means the client never sees a response to
   * `initialize` and reports the server as closed.
   */
  async connect({ initTimeoutMs = 15_000 }: { initTimeoutMs?: number } = {}): Promise<void> {
    const wsUrl = this.toWebSocketUrl();
    this.ws = new WebSocket(wsUrl);

    this.ws.on('message', (data) => {
      try {
        this.handleMessage(JSON.parse(data.toString()));
      } catch {
        // ignore malformed
      }
    });

    this.ws.on('error', (err) => {
      this.markClosed(err.message);
      this.initReject?.(err);
      if (this.pending) this.pending.reject(err);
    });

    this.ws.on('close', (code) => {
      this.markClosed(`socket closed (code ${code})`);
      this.initReject?.(new Error(`room ${this.roomId}: socket closed before init (code ${code})`));
      if (this.pending) this.pending.reject(new Error(`room ${this.roomId}: socket closed (code ${code})`));
    });

    await new Promise<void>((resolve, reject) => {
      const onOpen = () => {
        this.ws?.off('error', onError);
        resolve();
      };
      const onError = (err: Error) => {
        this.ws?.off('open', onOpen);
        reject(err);
      };
      this.ws?.once('open', onOpen);
      this.ws?.once('error', onError);
    });

    const timer = setTimeout(() => {
      this.initReject?.(new Error(`room ${this.roomId}: no init payload within ${initTimeoutMs}ms`));
    }, initTimeoutMs);
    try {
      await this.initPromise;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Latch the first reason the socket died, so tool errors can say what happened. */
  private markClosed(reason: string): void {
    this.closedReason ??= reason;
  }

  /** Null while the socket is usable, otherwise why it is not. */
  disconnectedReason(): string | null {
    if (this.ws?.readyState === WebSocket.OPEN) return null;
    return this.closedReason ?? 'not connected';
  }

  close(): void {
    if (this.pending?.timer) clearTimeout(this.pending.timer);
    if (this.pending?.flushTimer) clearTimeout(this.pending.flushTimer);
    this.pending = null;
    this.markClosed('client disconnected');
    this.ws?.close();
    this.ws = null;
  }

  getMeta(): RoomMeta {
    return { ...this.meta };
  }

  /**
   * All annotation-style ops in the room (comments, selections, areas, inspects),
   * filtered by status. Comment replies are excluded — they belong to their parent
   * thread and are returned by `getAnnotation`.
   */
  listAnnotations(filter?: { status?: CommentStatus | 'all' }): AnnotationOp[] {
    const status = filter?.status ?? 'all';
    return this.ops.filter(
      (op): op is AnnotationOp => isWatchable(op) && (status === 'all' || resolveOpStatus(op) === status),
    );
  }

  getAnnotation(id: string): { op: AnnotationOp; replies: CommentOp[] } | null {
    const op = this.ops.find((o): o is AnnotationOp => isWatchable(o) && o.id === id);
    if (!op) return null;
    const replies = this.ops.filter((o): o is CommentOp => o.tool === 'comment' && o.parentId === id);
    return { op, replies };
  }

  /**
   * Wait for new top-level comment annotations to arrive.
   * Returns a batch — either when the first one lands plus a small grace window,
   * or when the timeout expires (returning whatever has accumulated, possibly empty).
   */
  async watch({
    timeoutSeconds = 60,
    batchMs = 750,
  }: {
    timeoutSeconds?: number;
    batchMs?: number;
  } = {}): Promise<AnnotationOp[]> {
    if (this.pending) {
      throw new Error('watch is already in progress; only one watcher is supported at a time');
    }

    return new Promise<AnnotationOp[]>((resolve, reject) => {
      const pending: PendingNew = {
        resolve: (ops) => {
          this.pending = null;
          resolve(ops);
        },
        reject: (err) => {
          this.pending = null;
          reject(err);
        },
        timer: setTimeout(() => {
          if (!this.pending) return;
          if (this.pending.flushTimer) clearTimeout(this.pending.flushTimer);
          this.pending.resolve(this.pending.buffer);
        }, timeoutSeconds * 1000),
        flushTimer: null,
        buffer: [],
      };
      this.pending = pending;
      // batchMs is captured by the flush timer in handleNewOp.
      this.batchMs = batchMs;
    });
  }

  private batchMs = 750;

  acknowledge(opId: string): boolean {
    return this.update(opId, { status: 'in_progress', assignedAgent: this.agentId });
  }

  resolve(opId: string, summary?: string): boolean {
    if (summary) this.appendReply(opId, summary);
    return this.update(opId, { status: 'resolved', resolved: true });
  }

  dismiss(opId: string, reason: string): boolean {
    return this.update(opId, { status: 'dismissed', dismissReason: reason, assignedAgent: this.agentId });
  }

  reply(opId: string, text: string): boolean {
    return this.appendReply(opId, text);
  }

  private toWebSocketUrl(): string {
    const base = new URL(this.apiBase);
    const protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
    const params = new URLSearchParams({
      peerId: this.peerId,
      name: AGENT_NAME,
      color: AGENT_COLOR,
    });
    return `${protocol}//${base.host}/ws/${this.roomId}?${params}`;
  }

  private send(msg: unknown): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  private update(opId: string, patch: Partial<DrawOp>): boolean {
    const idx = this.ops.findIndex((o) => o.id === opId);
    if (idx === -1) return false;
    const merged = applyOpPatch({ op: this.ops[idx], patch });
    if (!merged) return false;
    // Send first: a local mutation the peers never saw would make every later
    // read lie about what the human is looking at.
    if (!this.send({ type: 'update_op', opId, patch })) return false;
    this.ops[idx] = merged;
    return true;
  }

  /**
   * Post a reply into an annotation's thread. Every annotation kind owns a thread
   * — the app indexes replies by `parentId` regardless of what the parent is — so
   * restricting this to comments silently dropped resolve summaries on the
   * selection, area and inspect annotations that make up most rooms.
   */
  private appendReply(parentId: string, text: string): boolean {
    const parent = this.ops.find((o): o is AnnotationOp => isWatchable(o) && o.id === parentId);
    if (!parent) return false;
    const op: CommentOp = {
      id: nanoid(),
      tool: 'comment',
      num: this.countRootComments() + 1,
      text,
      ...opAnchor(parent),
      color: AGENT_COLOR,
      lineWidth: parent.lineWidth,
      ts: Date.now(),
      parentId,
      author: AGENT_NAME,
      assignedAgent: this.agentId,
    };
    if (!this.send({ type: 'op', op })) return false;
    this.ops.push(op);
    return true;
  }

  /** Replies are numbered off the root threads only; counting them too would
   *  hand a reply the same `num` a real comment already shows. */
  private countRootComments(): number {
    let n = 0;
    for (const o of this.ops) if (o.tool === 'comment' && !o.parentId) n += 1;
    return n;
  }

  private handleMessage(msg: { type?: string; [k: string]: unknown }): void {
    switch (msg.type) {
      case 'init': {
        const parsed = opsArraySchema.safeParse(msg.ops);
        this.ops = parsed.success ? parsed.data : [];
        this.meta = {
          url: typeof msg.url === 'string' ? msg.url : null,
          width: typeof msg.width === 'number' ? msg.width : null,
          createdAt: typeof msg.createdAt === 'number' ? msg.createdAt : null,
          expiresAt: typeof msg.expiresAt === 'number' ? msg.expiresAt : null,
        };
        this.initResolve?.();
        this.initResolve = null;
        this.initReject = null;
        return;
      }
      case 'op': {
        const parsed = drawOpSchema.safeParse(msg.op);
        if (!parsed.success) return;
        const op = parsed.data;
        if (this.ops.some((o) => o.id === op.id)) return;
        this.ops.push(op);
        if (isWatchable(op)) this.handleNewAnnotation(op);
        return;
      }
      case 'update_op': {
        const opId = typeof msg.opId === 'string' ? msg.opId : null;
        const patch = msg.patch;
        if (!opId || !patch || typeof patch !== 'object') return;
        const idx = this.ops.findIndex((o) => o.id === opId);
        if (idx === -1) return;
        const merged = applyOpPatch({ op: this.ops[idx], patch });
        if (merged) this.ops[idx] = merged;
        return;
      }
      case 'undo': {
        const opId = typeof msg.opId === 'string' ? msg.opId : null;
        if (opId) this.ops = this.ops.filter((o) => o.id !== opId);
        return;
      }
      case 'clear':
        this.ops = [];
        return;
    }
  }

  private handleNewAnnotation(op: AnnotationOp): void {
    const pending = this.pending;
    if (!pending) return;
    pending.buffer.push(op);
    if (pending.flushTimer) clearTimeout(pending.flushTimer);
    pending.flushTimer = setTimeout(() => {
      if (!this.pending) return;
      if (this.pending.timer) clearTimeout(this.pending.timer);
      this.pending.resolve(this.pending.buffer);
    }, this.batchMs);
  }
}
