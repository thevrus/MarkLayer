import type { PageReading, RoomMeta, WatchEvent } from '@marklayer/agent-tools';
import { classifyOp, isWatchableOp as isWatchable, WATCH_DEFAULT_SECONDS } from '@marklayer/agent-tools';
import {
  type AnnotationOp,
  agentColor,
  applyOpPatch,
  type CommentOp,
  type CommentPriority,
  type CommentStatus,
  type DrawOp,
  drawOpSchema,
  normalizeSuggestion,
  opAnchor,
  opsArraySchema,
  resolveOpStatus,
  type SelectionOp,
  type SelectionRect,
  type TargetElement,
} from '@marklayer/types';
import { nanoid } from 'nanoid';
import WebSocket from 'ws';

export type { AnnotationOp, RoomMeta, WatchEvent };
export { resolveOpStatus as resolveStatus };

interface PendingNew {
  resolve: (events: WatchEvent[]) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
  flushTimer: ReturnType<typeof setTimeout> | null;
  buffer: WatchEvent[];
}

/**
 * Fixed visual identity for agent-authored content, independent of which LLM
 * is driving this bridge — `agentId` (below) is what tells humans which agent
 * it actually is; this is just the "an agent made this" color convention.
 */

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
  /** This agent's brand colour, resolved once: presence, pins and marks all use the one value. */
  private readonly color: string;
  /**
   * Whether the room accepts this peer's writes. The bridge sends no session
   * cookie, so on a link its owner set to view-only every op is discarded — and
   * `op`/`update_op` are fire-and-forget, so nothing but this flag would ever
   * tell us. Defaults true: `edit` is every link's default and a room that
   * predates the access message says nothing about it.
   */
  private canEdit = true;

  /**
   * Identity stamped on every op the agent writes itself. `authorId` is stable
   * across sessions, unlike the per-connection peer id: without it the roster
   * forgets the agent the moment it disconnects, so nobody can assign or
   * @mention it afterwards — its own annotations name it and nothing else.
   */
  private get authorship() {
    return { author: this.agentId, authorId: this.agentId, assignedAgent: this.agentId };
  }

  constructor(
    private readonly apiBase: string,
    public readonly roomId: string,
    private readonly agentId: string,
  ) {
    this.color = agentColor(agentId);
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

  /** The Worker owns the fetch — see `RoomOps.readPage` for why it is not done here. */
  async readPage(): Promise<PageReading | null> {
    const res = await fetch(`${this.apiBase}/s/${this.roomId}/page.json`).catch(() => null);
    if (!res?.ok) return null;
    const body = await res.json().catch(() => null);
    return body && typeof body === 'object' && 'entries' in body ? (body as PageReading) : null;
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
   * Wait for work: a new annotation, or one handed to this agent.
   * Returns a batch — either when the first event lands plus a small grace window,
   * or when the timeout expires (returning whatever has accumulated, possibly empty).
   */
  async watch({
    timeoutSeconds = WATCH_DEFAULT_SECONDS,
    batchMs = 750,
  }: {
    timeoutSeconds?: number;
    batchMs?: number;
  } = {}): Promise<WatchEvent[]> {
    if (this.pending) {
      throw new Error('watch is already in progress; only one watcher is supported at a time');
    }

    return new Promise<WatchEvent[]>((resolve, reject) => {
      const pending: PendingNew = {
        resolve: (events) => {
          this.pending = null;
          resolve(events);
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

  /**
   * Create a new root-level comment. `target` is optional: without it the pin
   * sits at a fixed document-px point; with it (selector/tag/markdown, the same
   * shape a human client captures) it reflows with the page instead of drifting
   * when the layout changes.
   */
  create({
    text,
    x,
    y,
    priority,
    target,
  }: {
    text: string;
    x: number;
    y: number;
    priority?: CommentPriority;
    target?: TargetElement;
  }): { id: string } | null {
    const op: CommentOp = {
      id: nanoid(),
      tool: 'comment',
      num: this.countRootComments() + 1,
      text,
      x,
      y,
      color: this.color,
      lineWidth: 2,
      ts: Date.now(),
      ...this.authorship,
      ...(priority ? { priority } : {}),
      ...(target ? { target } : {}),
    };
    return this.commit(op) ? { id: op.id } : null;
  }

  /**
   * Create a copy-edit annotation — the exact replacement for `text` at
   * `rects`, the same shape a human proposes via the selection tool. `null`
   * here means the room refused the write, matching what `null` means on
   * every other mutator — never a second, silent meaning for the same value.
   */
  suggestEdit({
    text,
    suggestion,
    rects,
    comment,
    priority,
    target,
  }: {
    text: string;
    suggestion: string;
    rects: SelectionRect[];
    comment?: string;
    priority?: CommentPriority;
    target?: TargetElement;
  }): { id: string } | null {
    const op: SelectionOp = {
      id: nanoid(),
      tool: 'selection',
      text,
      rects,
      // Re-normalized (trim) rather than trusted verbatim — the schema refine
      // already proved it differs from `text`, but not that it is trimmed.
      suggestion: normalizeSuggestion({ text, suggestion }) ?? suggestion,
      ts: Date.now(),
      color: this.color,
      lineWidth: 2,
      ...this.authorship,
      ...(comment ? { comment } : {}),
      ...(priority ? { priority } : {}),
      ...(target ? { target } : {}),
    };
    return this.commit(op) ? { id: op.id } : null;
  }

  private toWebSocketUrl(): string {
    const base = new URL(this.apiBase);
    const protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
    const params = new URLSearchParams({
      peerId: this.peerId,
      // The roster keys a live peer on `uid` and only falls back to the random
      // per-connection `peerId` without one, so an @mention of a *connected*
      // agent would carry that socket id and never match `agentId`.
      uid: this.agentId,
      name: this.agentId,
      color: this.color,
    });
    return `${protocol}//${base.host}/ws/${this.roomId}?${params}`;
  }

  /**
   * A write on a dead socket used to come back as `annotation not found`, which
   * sends the agent hunting for an id that is fine. Say what actually happened.
   */
  checkLive(): string | null {
    const why = this.disconnectedReason();
    return why ? `room ${this.roomId} is not connected (${why}) — call marklayer_connect_room to reconnect` : null;
  }

  /** True when the room has told us it refuses this peer's writes, so a failed
   *  mutation can say why instead of blaming a missing annotation. */
  get viewOnly(): boolean {
    return !this.canEdit;
  }

  /**
   * Every message this client sends is a mutation (`op`, `update_op`), so one
   * check here covers all of them. Refusing before the send is the point: the
   * callers record the change locally once `send` succeeds, and an op the room
   * discarded would make every later read lie about what the human sees.
   */
  private send(msg: unknown): boolean {
    if (!this.canEdit) return false;
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  /** Send before recording, for the reason `send` gives: an op the room discarded would make every later read lie. */
  private commit(op: DrawOp): boolean {
    if (!this.send({ type: 'op', op })) return false;
    this.ops.push(op);
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
      color: this.color,
      lineWidth: parent.lineWidth,
      ts: Date.now(),
      parentId,
      ...this.authorship,
    };
    return this.commit(op);
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
        if (typeof msg.canEdit === 'boolean') this.canEdit = msg.canEdit;
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
        const event = classifyOp({ op, ops: this.ops, agentId: this.agentId });
        if (event) this.emit(event);
        return;
      }
      case 'update_op': {
        const opId = typeof msg.opId === 'string' ? msg.opId : null;
        const patch = msg.patch;
        if (!opId || !patch || typeof patch !== 'object') return;
        const idx = this.ops.findIndex((o) => o.id === opId);
        if (idx === -1) return;
        const before = this.ops[idx];
        const merged = applyOpPatch({ op: before, patch });
        if (!merged) return;
        this.ops[idx] = merged;
        // Only on the transition: a later patch to the same thread (a status
        // change, say) carries `assignee` forward and would wake the agent again
        // for work it already has.
        const mineNow = 'assignee' in merged && merged.assignee === this.agentId;
        const mineBefore = before && 'assignee' in before && before.assignee === this.agentId;
        if (mineNow && !mineBefore && isWatchable(merged)) this.emit({ kind: 'handoff', op: merged });
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
      // The owner changed who may edit while this bridge was attached.
      case 'access':
        if (typeof msg.canEdit === 'boolean') this.canEdit = msg.canEdit;
        return;
      // A write was rejected. Latching the flag here matters even though `init`
      // already carries it: this is what catches a flip that raced our own op.
      case 'error':
        if (msg.code === 'read_only') this.canEdit = false;
        return;
    }
  }

  private emit(event: WatchEvent): void {
    const pending = this.pending;
    if (!pending) return;
    pending.buffer.push(event);
    if (pending.flushTimer) clearTimeout(pending.flushTimer);
    pending.flushTimer = setTimeout(() => {
      if (!this.pending) return;
      if (this.pending.timer) clearTimeout(this.pending.timer);
      this.pending.resolve(this.pending.buffer);
    }, this.batchMs);
  }
}
