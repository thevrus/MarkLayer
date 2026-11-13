import { agentColor, agentPeerId, isAgentAuthored } from '@marklayer/types/agents';
import type {
  AnnotationOp,
  CommentOp,
  CommentPriority,
  CommentStatus,
  Diagnosis,
  DrawOp,
  QuestionOp,
  SelectionOp,
  SelectionRect,
  StepOp,
  TargetElement,
} from '@marklayer/types/ops';
import {
  applyOpPatch,
  canReply,
  isRootAnnotation,
  nextCommentNum,
  opAnchor,
  parseOps,
  resolveOpStatus,
} from '@marklayer/types/ops';
import type { AgentTaskCommand, ClientMsg, RoomLayer, RoomTask, ServerMsg } from '@marklayer/types/wire';
import { ROOM_ERROR_READ_ONLY } from '@marklayer/types/wire';
import { z } from 'zod/mini';
import type { QuestionRequest, StepRequest } from './tools';
import { WATCH_BATCH_MS, WATCH_DEFAULT_SECONDS } from './tools';

export type Awaitable<T> = T | Promise<T>;

/** One text-bearing element, in the shape the write tools already take. */
const pageEntrySchema = z.object({
  selector: z.string(),
  tag: z.string(),
  text: z.string(),
  /** The same snapshot a human's Inspect comment carries — pass it straight to a write tool. */
  markdown: z.string(),
});
export type PageEntry = z.infer<typeof pageEntrySchema>;

/** What `marklayer_read_page` answers with: the Worker builds it, and stdio parses it off the network. */
export const pageReadingSchema = z.object({
  url: z.string(),
  title: z.nullable(z.string()),
  entries: z.array(pageEntrySchema),
  /** The document rendered client-side: this is the shell, not the copy. Say so rather than audit nothing. */
  clientRendered: z.boolean(),
  truncated: z.boolean(),
});
export type PageReading = z.infer<typeof pageReadingSchema>;

/** What the share API answers a preview with. `api.ts`'s OpenAPI mirror stays beside it, per CLAUDE.md. */
export const previewCreatedSchema = z.object({
  id: z.string(),
  url: z.string(),
  version: z.nullable(z.number()),
  previous: z.nullable(z.string()),
});
export type PreviewCreated = z.infer<typeof previewCreatedSchema>;

/** Room facts an agent asks for before doing anything else. */
export interface RoomMeta {
  url: string | null;
  width: number | null;
  createdAt: number | null;
  expiresAt: number | null;
  execMode?: 'solo' | 'guide' | 'pair';
  /** Stored ops this build could not read, when there are any: the agent is acting on a partial room. */
  unreadableOps?: number;
}

/**
 * Why `watch` woke up.
 *
 * `new` is someone leaving an annotation. `handoff` is someone giving one to
 * this agent — the thread was assigned to it, it was mentioned, or a person
 * replied on a thread it already owns. The last case is the one that matters
 * for how people actually work: replying "yes, do that" under the agent's own
 * comment is obviously addressed to the agent, and requiring an @mention there
 * would be ceremony for its own sake.
 */
export interface AnnotationWatchEvent {
  kind: 'new' | 'handoff';
  op: AnnotationOp;
  /** The reply that handed it over, when a reply is what did. Read it: it is the instruction. */
  reply?: CommentOp;
}
export type WatchEvent =
  | AnnotationWatchEvent
  | { kind: 'task_update'; tasks: RoomTask[] }
  | { kind: 'teach_control'; control: Extract<ServerMsg, { type: 'teach_control' }> };

export interface TeachingStep {
  state?: 'active' | 'paused';
  toolbarTarget?: 'comment' | 'selection' | 'pen' | 'rectangle' | 'area' | 'eraser' | 'inspect' | 'text' | 'guide';
  presentationId: string;
  index: number;
  caption: string;
  annotationId?: string;
  selector?: string;
  rect?: { x: number; y: number; width: number; height: number };
}

/**
 * One room, however it is reached.
 *
 * The stdio server holds a WebSocket to the room; the Worker calls the Durable
 * Object that owns it. Same tools, same answers — so the dispatch is written
 * once against this, rather than twice against two clients that would quietly
 * drift into disagreeing about what `resolve` returns.
 */
export interface RoomOps {
  readonly roomId: string;
  taskCommand?(command: AgentTaskCommand): Promise<{ ok: boolean; tasks: RoomTask[] }>;
  listLayers?(): RoomLayer[];
  /**
   * The page's own copy, so an agent can review it rather than only react to
   * annotations someone already left. Both transports ask the Worker for it:
   * the fetch belongs behind the SSRF guard and the blocked-host relay, not in
   * a CLI on someone's laptop — but that is a reason to route it there, not a
   * reason to withhold the tool from stdio.
   */
  readPage(): Promise<PageReading | null>;
  readonly viewOnly: boolean;
  getMeta(): RoomMeta;
  /** An error to return instead of acting, when the connection cannot carry a write. */
  checkLive(): string | null;
  listAnnotations(filter?: { status?: CommentStatus | 'all' }): AnnotationOp[];
  getAnnotation(id: string): { op: AnnotationOp; replies: CommentOp[] } | null;
  setDiagnosis(id: string, diagnosis: Diagnosis): Awaitable<boolean>;
  watch(opts: { timeoutSeconds?: number; batchMs?: number }): Promise<WatchEvent[]>;
  teachStart(opts: { steps?: string[] }): Awaitable<{ presentationId: string } | null>;
  teachStep(step: TeachingStep): Awaitable<boolean>;
  teachEnd(presentationId: string): Awaitable<boolean>;
  // Awaited by the dispatch: a socket send returns at once, an RPC call to the
  // Durable Object does not, and both are legitimate ways to reach a room.
  acknowledge(id: string): Awaitable<boolean>;
  resolve(id: string, summary?: string): Awaitable<boolean>;
  dismiss(id: string, reason: string): Awaitable<boolean>;
  reply(id: string, text: string): Awaitable<boolean>;
  create(a: {
    text: string;
    x: number;
    y: number;
    priority?: CommentPriority;
    target?: TargetElement;
  }): Awaitable<{ id: string } | null>;
  suggestEdit(a: {
    text: string;
    suggestion: string;
    rects: SelectionRect[];
    comment?: string;
    priority?: CommentPriority;
    target?: TargetElement;
  }): Awaitable<{ id: string } | null>;
  /** Every op the room holds, for the reads that are not about annotations: steps, polls, votes. */
  listOps(): readonly DrawOp[];
  /** Replace the checklist. Null when the room refused the write. */
  setNextSteps(steps: StepRequest[]): Awaitable<{ ids: string[] } | null>;
  setStepDone(a: { id: string; done: boolean }): Awaitable<boolean>;
  ask(question: QuestionRequest): Awaitable<{ id: string } | null>;
}

/**
 * What one arriving op means to this agent, given what the room already holds.
 *
 * Shared because both transports must agree: a reply that wakes the WebSocket
 * client has to wake the HTTP one too, or the same room behaves differently
 * depending on how the agent happened to connect.
 *
 * A reply is addressed to the agent when it names it, or when it lands on a
 * thread the agent already owns. Without the second rule the obvious gesture —
 * replying "yes, do that" under the agent's own comment — reaches nobody; with
 * it, two people talking under someone else's thread still does not.
 */
export function classifyOp({
  op,
  ops,
  agentId,
  waitingAnnotationIds,
}: {
  op: DrawOp;
  ops: readonly DrawOp[];
  agentId: string;
  waitingAnnotationIds?: ReadonlySet<string>;
}): AnnotationWatchEvent | null {
  // Taken before any narrowing: `isRootAnnotation` is a type predicate, so testing
  // it first would leave the else branch typed as everything a reply is not.
  const reply = op.tool === 'comment' && op.parentId ? op : null;
  if (!reply) return isRootAnnotation(op) ? { kind: 'new', op } : null;
  if (reply.author === agentId) return null;
  const parent = ops.find((o): o is AnnotationOp => isRootAnnotation(o) && o.id === reply.parentId);
  if (!parent) return null;
  const named = (reply.mentions ?? []).some((mention) => mention.id === agentId);
  const mine = parent.author === agentId || parent.assignedAgent === agentId || parent.assignee === agentId;
  return named || mine || waitingAnnotationIds?.has(parent.id) ? { kind: 'handoff', op: parent, reply } : null;
}

/**
 * What a message means to this agent, once `ops` already reflects it. A patch counts
 * only on the transition: a later patch to the same thread carries `assignee` forward
 * and would otherwise wake the agent again for work it already has.
 */
function classifyMessage({
  msg,
  before,
  ops,
  agentId,
  waitingAnnotationIds,
}: {
  msg: ServerMsg;
  before: DrawOp | undefined;
  ops: readonly DrawOp[];
  agentId: string;
  waitingAnnotationIds: ReadonlySet<string>;
}): AnnotationWatchEvent | null {
  if (msg.type === 'op') return classifyOp({ op: msg.op, ops, agentId, waitingAnnotationIds });
  if (msg.type !== 'update_op') return null;
  const assigned = (op: DrawOp | undefined) => !!op && 'assignee' in op && op.assignee === agentId;
  const now = ops.find((op) => op.id === msg.opId);
  return now && isRootAnnotation(now) && assigned(now) && !assigned(before) ? { kind: 'handoff', op: now } : null;
}

/**
 * What every op an agent writes carries. `authorId` is stable across sessions, unlike
 * the peer id: without it the roster forgets the agent the moment it disconnects.
 */
function agentSignature(agentId: string) {
  return {
    color: agentColor(agentId),
    lineWidth: 2,
    author: agentId,
    authorId: agentId,
    assignedAgent: agentId,
  };
}

/** Built here so the HTTP room, the stdio room and the share API mint identical ops. */
export function agentQuestionOp({
  id,
  question,
  agentId,
}: {
  id: string;
  question: QuestionRequest;
  agentId: string;
}): QuestionOp {
  return { ...agentSignature(agentId), id, tool: 'question', ts: Date.now(), ...question };
}

function agentStepOps({
  newId,
  steps,
  agentId,
}: {
  newId: () => string;
  steps: StepRequest[];
  agentId: string;
}): StepOp[] {
  const ts = Date.now();
  return steps.map((step, order) => ({
    ...agentSignature(agentId),
    id: newId(),
    tool: 'step',
    text: step.text,
    order,
    ts,
    ...(step.annotationIds?.length ? { annotationIds: step.annotationIds } : {}),
  }));
}

/** A reply op under `parent`. Slack builds through this too, so a reply typed in a thread lands where an agent's would. */
export function replyOp({
  id,
  parent,
  ops,
  text,
  signature,
}: {
  id: string;
  parent: AnnotationOp;
  ops: readonly DrawOp[];
  text: string;
  signature: { color: string; ts: number; author: string; authorId?: string; assignedAgent?: string };
}): CommentOp {
  return {
    ...signature,
    id,
    tool: 'comment',
    num: nextCommentNum(ops),
    text,
    ...opAnchor(parent),
    lineWidth: parent.lineWidth,
    parentId: parent.id,
    ...(parent.layerId ? { layerId: parent.layerId } : {}),
  };
}

/** How a room is reached. Everything else about working one lives in `RoomCore`. */
export interface RoomTransport {
  taskCommand?(command: AgentTaskCommand): Promise<{ ok: boolean; tasks: RoomTask[] }>;
  send(msg: ClientMsg): Awaitable<boolean>;
  /**
   * Resolve with what arrived, within `ms`. A transport that feeds `apply` as messages
   * land resolves with nothing on the same wake: `watch` reads events, not this list.
   */
  wait(ms: number): Promise<ServerMsg[]>;
  /** The Worker owns the fetch; see `RoomOps.readPage`. */
  readPage(url: string | null): Promise<PageReading | null>;
  /** Why the connection cannot carry a write, for a transport that can lose one. */
  checkLive?(): string | null;
}

/**
 * One agent's view of one room, with no transport in it: the state, every op the agent
 * writes, and what each arriving message means. `apply` is the single way state
 * changes, so a snapshot loaded over RPC and an `init` off a socket cannot diverge.
 */
export class RoomCore implements RoomOps {
  readonly roomId: string;
  readonly peerId: string;
  private readonly agentId: string;
  private readonly transport: RoomTransport;
  private readonly newId: () => string;
  private ops: DrawOp[] = [];
  private layers: RoomLayer[] = [];
  private waitingAnnotationIds = new Set<string>();
  private meta: RoomMeta = { url: null, width: null, createdAt: null, expiresAt: null };
  /** Defaults true: `edit` is every link's default, and a room predating the field says nothing about it. */
  private canEdit = true;
  /** Held across watches, so what lands while no watch is parked still reaches the next one. */
  private events: WatchEvent[] = [];
  private watching = false;

  constructor({
    roomId,
    agentId,
    session,
    transport,
    newId,
  }: {
    roomId: string;
    agentId: string;
    session: string;
    transport: RoomTransport;
    newId: () => string;
  }) {
    this.roomId = roomId;
    this.agentId = agentId;
    this.peerId = agentPeerId({ agentId, session });
    this.transport = transport;
    this.newId = newId;
  }

  listLayers(): RoomLayer[] {
    return this.layers;
  }

  private setWaitingTasks(tasks: readonly RoomTask[]): void {
    this.waitingAnnotationIds = new Set(
      tasks
        .filter((task) => task.agent_id === this.agentId && task.status === 'waiting')
        .map((task) => task.annotation_id),
    );
  }

  async taskCommand(command: AgentTaskCommand): Promise<{ ok: boolean; tasks: RoomTask[] }> {
    const result = this.transport.taskCommand ? await this.transport.taskCommand(command) : { ok: false, tasks: [] };
    if (result.ok) this.setWaitingTasks(result.tasks);
    return result;
  }

  apply(msg: ServerMsg): void {
    const before = msg.type === 'update_op' ? this.ops.find((op) => op.id === msg.opId) : undefined;
    switch (msg.type) {
      case 'collaboration':
        this.setWaitingTasks(msg.tasks);
        this.events.push({ kind: 'task_update', tasks: msg.tasks.filter((task) => task.agent_id === this.agentId) });
        return;
      case 'teach_control':
        if (msg.peerId !== this.peerId) this.events.push({ kind: 'teach_control', control: msg });
        return;
      case 'init':
        this.setWaitingTasks(msg.tasks ?? []);
        this.layers = msg.layers ?? [];
        this.ops = parseOps(msg.ops);
        this.meta = {
          url: msg.url ?? null,
          width: msg.width ?? null,
          createdAt: msg.createdAt ?? null,
          expiresAt: msg.expiresAt ?? null,
          execMode: msg.execMode ?? 'pair',
          ...(msg.ops.length > this.ops.length ? { unreadableOps: msg.ops.length - this.ops.length } : {}),
        };
        if (msg.canEdit !== undefined) this.canEdit = msg.canEdit;
        return;
      case 'layers':
        this.layers = msg.layers;
        return;
      case 'op':
        // The room echoes an agent's own write back to it over RPC.
        if (this.ops.some((op) => op.id === msg.op.id)) return;
        this.ops.push(msg.op);
        break;
      case 'update_op': {
        const merged = before && applyOpPatch({ op: before, patch: msg.patch });
        if (!merged) return;
        this.ops = this.ops.map((op) => (op === before ? merged : op));
        break;
      }
      case 'undo':
        this.ops = this.ops.filter((op) => op.id !== msg.opId);
        return;
      case 'clear':
        this.ops = [];
        return;
      case 'exec_mode':
        this.meta = { ...this.meta, execMode: msg.execMode };
        return;
      case 'access':
        this.canEdit = msg.canEdit;
        return;
      // Latched here even though `init` carries it: this catches a flip that raced our own op.
      case 'error':
        if (msg.code === ROOM_ERROR_READ_ONLY) this.canEdit = false;
        return;
      default:
        return;
    }
    const event = classifyMessage({
      msg,
      before,
      ops: this.ops,
      agentId: this.agentId,
      waitingAnnotationIds: this.waitingAnnotationIds,
    });
    if (event) this.events.push(event);
  }

  /**
   * Replay what landed before this core existed. Unlike a live feed this includes the
   * agent's own writes from earlier requests, which are state, not new work.
   */
  catchUp(messages: ServerMsg[]): void {
    for (const msg of messages) {
      if (msg.type === 'op' && msg.op.author === this.agentId && isAgentAuthored(msg.op)) this.ops.push(msg.op);
      else this.apply(msg);
    }
  }

  get viewOnly(): boolean {
    return !this.canEdit;
  }

  readPage(): Promise<PageReading | null> {
    return this.transport.readPage(this.meta.url);
  }

  getMeta(): RoomMeta {
    return { ...this.meta };
  }

  checkLive(): string | null {
    return this.transport.checkLive?.() ?? null;
  }

  listOps(): readonly DrawOp[] {
    return this.ops;
  }

  /** Replies are excluded: they belong to their parent thread, and `getAnnotation` returns them. */
  listAnnotations(filter?: { status?: CommentStatus | 'all' }): AnnotationOp[] {
    const status = filter?.status ?? 'all';
    return this.ops.filter(
      (op): op is AnnotationOp => isRootAnnotation(op) && (status === 'all' || resolveOpStatus(op) === status),
    );
  }

  getAnnotation(id: string): { op: AnnotationOp; replies: CommentOp[] } | null {
    const op = this.ops.find((o): o is AnnotationOp => isRootAnnotation(o) && o.id === id);
    if (!op) return null;
    return { op, replies: this.ops.filter((o): o is CommentOp => o.tool === 'comment' && o.parentId === id) };
  }

  /**
   * Wait for work: answers `batchMs` after the last event, so a burst of comments is one
   * batch, or at the timeout with whatever gathered, possibly nothing.
   */
  async watch({
    timeoutSeconds = WATCH_DEFAULT_SECONDS,
    batchMs = WATCH_BATCH_MS,
  }: {
    timeoutSeconds?: number;
    batchMs?: number;
  } = {}): Promise<WatchEvent[]> {
    if (this.watching) throw new Error('watch is already in progress; only one watcher is supported at a time');
    this.watching = true;
    try {
      const deadline = Date.now() + timeoutSeconds * 1000;
      let flushAt = this.events.length ? Date.now() + batchMs : deadline;
      for (let left = Math.min(deadline, flushAt) - Date.now(); left > 0; ) {
        const seen = this.events.length;
        for (const msg of await this.transport.wait(left)) this.apply(msg);
        if (this.events.length > seen) flushAt = Date.now() + batchMs;
        left = Math.min(deadline, flushAt) - Date.now();
      }
      return this.events.splice(0);
    } finally {
      this.watching = false;
    }
  }

  async teachStart({ steps }: { steps?: string[] }): Promise<{ presentationId: string } | null> {
    const presentationId = `${this.peerId}-${this.newId()}`;
    const sent = await this.transport.send({
      type: 'teach_state',
      presentationId,
      state: 'active',
      step: 0,
      ...(steps?.length ? { total: steps.length } : {}),
    });
    return sent ? { presentationId } : null;
  }

  async teachStep({
    presentationId,
    index,
    caption,
    annotationId,
    selector,
    rect,
    toolbarTarget,
    state,
  }: TeachingStep): Promise<boolean> {
    const highlighted = await this.transport.send({
      type: 'teach_highlight',
      presentationId,
      ...(annotationId ? { annotationId } : {}),
      ...(toolbarTarget ? { toolbarTarget } : {}),
      ...(selector ? { selector } : {}),
      ...(rect ? { rect } : {}),
    });
    if (
      !highlighted ||
      !(await this.transport.send({ type: 'teach_caption', presentationId, text: caption, step: index }))
    )
      return false;
    return state ? this.transport.send({ type: 'teach_state', presentationId, state, step: index }) : true;
  }

  async teachEnd(presentationId: string): Promise<boolean> {
    return this.transport.send({ type: 'teach_state', presentationId, state: 'ended' });
  }

  acknowledge(id: string): Promise<boolean> {
    return this.update(id, { status: 'in_progress', assignedAgent: this.agentId });
  }

  async resolve(id: string, summary?: string): Promise<boolean> {
    if (summary) await this.reply(id, summary);
    return this.update(id, { status: 'resolved' });
  }

  dismiss(id: string, reason: string): Promise<boolean> {
    return this.update(id, { status: 'dismissed', dismissReason: reason, assignedAgent: this.agentId });
  }

  async reply(id: string, text: string): Promise<boolean> {
    const parent = this.ops.find((op): op is AnnotationOp => canReply(op) && op.id === id);
    if (!parent) return false;
    return this.commit(replyOp({ id: this.newId(), parent, ops: this.ops, text, signature: this.signature() }));
  }

  setDiagnosis(id: string, diagnosis: Diagnosis): Promise<boolean> {
    return this.update(id, { diagnosis });
  }

  /** `target` is optional: without it the pin sits at a fixed document-px point; with it, it follows the element. */
  async create({
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
  }): Promise<{ id: string } | null> {
    const op: CommentOp = {
      ...this.signature(),
      id: this.newId(),
      tool: 'comment',
      num: nextCommentNum(this.ops),
      text,
      x,
      y,
      ...(priority ? { priority } : {}),
      ...(target ? { target } : {}),
    };
    return (await this.commit(op)) ? { id: op.id } : null;
  }

  /** A copy edit, the shape a human proposes through the selection tool. `SuggestInput` has already trimmed `suggestion`. */
  async suggestEdit({
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
  }): Promise<{ id: string } | null> {
    const op: SelectionOp = {
      ...this.signature(),
      id: this.newId(),
      tool: 'selection',
      text,
      rects,
      suggestion,
      ...(comment ? { comment } : {}),
      ...(priority ? { priority } : {}),
      ...(target ? { target } : {}),
    };
    return (await this.commit(op)) ? { id: op.id } : null;
  }

  /** Old steps go out as `undo`, the same message a person deleting an op sends. */
  async setNextSteps(steps: StepRequest[]): Promise<{ ids: string[] } | null> {
    for (const op of this.ops.filter((o) => o.tool === 'step')) {
      if (!(await this.send({ type: 'undo', opId: op.id }))) return null;
      this.ops = this.ops.filter((o) => o !== op);
    }
    const ops = agentStepOps({ newId: this.newId, steps, agentId: this.agentId });
    for (const op of ops) if (!(await this.commit(op))) return null;
    return { ids: ops.map((op) => op.id) };
  }

  setStepDone({ id, done }: { id: string; done: boolean }): Promise<boolean> {
    return this.update(id, { done, doneBy: done ? this.agentId : null });
  }

  async ask(question: QuestionRequest): Promise<{ id: string } | null> {
    const op = agentQuestionOp({ id: this.newId(), question, agentId: this.agentId });
    return (await this.commit(op)) ? { id: op.id } : null;
  }

  private signature() {
    return { ...agentSignature(this.agentId), ts: Date.now() };
  }

  /**
   * One check for every write. On a view-only link the room discards the op and says
   * nothing a sender could wait on, so refusing here is what keeps a later read honest.
   */
  private async send(msg: ClientMsg): Promise<boolean> {
    return this.canEdit && this.transport.send(msg);
  }

  /** Send before recording: an op the room discarded would make every later read lie about what the human sees. */
  private async commit(op: DrawOp): Promise<boolean> {
    if (!(await this.send({ type: 'op', op }))) return false;
    this.ops.push(op);
    return true;
  }

  private async update(opId: string, patch: Record<string, unknown>): Promise<boolean> {
    const op = this.ops.find((o) => o.id === opId);
    const merged = op && applyOpPatch({ op, patch });
    if (!merged) return false;
    if (!(await this.send({ type: 'update_op', opId, patch }))) return false;
    this.ops = this.ops.map((o) => (o === op ? merged : o));
    return true;
  }
}
