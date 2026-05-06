import {
  type AreaOp,
  type CommentOp,
  type CommentStatus,
  type DrawOp,
  drawOpSchema,
  type InspectOp,
  opsArraySchema,
  type SelectionOp,
} from '@marklayer/types';
import { nanoid } from 'nanoid';
import WebSocket from 'ws';

export type AnnotationOp = CommentOp | SelectionOp | InspectOp | AreaOp;

function isAnnotation(op: DrawOp): op is AnnotationOp {
  return op.tool === 'comment' || op.tool === 'selection' || op.tool === 'inspect' || op.tool === 'area';
}

/** Watchable = annotation op that should fan out to MCP listeners (comment replies do not). */
function isWatchable(op: DrawOp): op is AnnotationOp {
  return isAnnotation(op) && !(op.tool === 'comment' && !!op.parentId);
}

/**
 * Collapse the legacy `resolved` boolean (comments only) and the unset `status`
 * field into the canonical `CommentStatus`. Single source of truth so room and
 * server agree on what a watcher/lister sees.
 */
export function resolveStatus(op: AnnotationOp): CommentStatus {
  if (op.tool === 'comment') return op.status || (op.resolved ? 'resolved' : 'open');
  return op.status || 'open';
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
  private initPromise: Promise<void>;
  private pending: PendingNew | null = null;
  private peerId = `mcp-${nanoid()}`;

  constructor(
    private readonly apiBase: string,
    public readonly roomId: string,
    private readonly agentId: string,
  ) {
    this.initPromise = new Promise((resolve) => {
      this.initResolve = resolve;
    });
  }

  /** Connect and resolve once the room init payload is received. */
  async connect(): Promise<void> {
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
      if (this.pending) this.pending.reject(err);
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

    await this.initPromise;
  }

  close(): void {
    if (this.pending?.timer) clearTimeout(this.pending.timer);
    if (this.pending?.flushTimer) clearTimeout(this.pending.flushTimer);
    this.pending = null;
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
      (op): op is AnnotationOp => isWatchable(op) && (status === 'all' || resolveStatus(op) === status),
    );
  }

  getAnnotation(id: string): { op: AnnotationOp; replies: CommentOp[] } | null {
    const op = this.ops.find((o): o is AnnotationOp => isWatchable(o) && o.id === id);
    if (!op) return null;
    const replies =
      op.tool === 'comment' ? this.ops.filter((o): o is CommentOp => o.tool === 'comment' && o.parentId === id) : [];
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
          const buffer = this.pending.buffer;
          this.pending.resolve(buffer);
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

  // ---------- internal ----------

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
    const merged = drawOpSchema.safeParse({ ...this.ops[idx], ...patch });
    if (!merged.success) return false;
    this.ops[idx] = merged.data;
    return this.send({ type: 'update_op', opId, patch });
  }

  private appendReply(parentId: string, text: string): boolean {
    const parent = this.ops.find((o): o is CommentOp => o.tool === 'comment' && o.id === parentId && !o.parentId);
    if (!parent) return false;
    const op: CommentOp = {
      id: nanoid(),
      tool: 'comment',
      num: this.countComments() + 1,
      text,
      x: parent.x,
      y: parent.y,
      color: AGENT_COLOR,
      lineWidth: parent.lineWidth,
      ts: Date.now(),
      parentId,
      author: AGENT_NAME,
      assignedAgent: this.agentId,
    };
    this.ops.push(op);
    return this.send({ type: 'op', op });
  }

  private countComments(): number {
    let n = 0;
    for (const o of this.ops) if (o.tool === 'comment') n += 1;
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
        const merged = drawOpSchema.safeParse({ ...this.ops[idx], ...patch });
        if (merged.success) this.ops[idx] = merged.data;
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
