import type { PageReading } from '@marklayer/agent-tools';
import {
  callRoomTool,
  classifyOp,
  describedSchema,
  isWatchableOp as isWatchable,
  type RoomMeta,
  type RoomOps,
  type ToolContent,
  toolsFor,
  type WatchEvent,
} from '@marklayer/agent-tools';
import {
  type AnnotationOp,
  agentColor,
  type CommentOp,
  type CommentPriority,
  type CommentStatus,
  type DrawOp,
  normalizeSuggestion,
  opAnchor,
  opsArraySchema,
  resolveOpStatus,
  type SelectionOp,
  type SelectionRect,
  type TargetElement,
} from '@marklayer/types';
import { McpServer, WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/server';
import { nanoid } from 'nanoid';
import type { AnnotationRoom } from './annotation-room';
import { outlinePage } from './page-outline';
import { fetchPage } from './proxy';

/**
 * A room reached by RPC instead of a socket.
 *
 * Same contract the stdio client implements, so the tools are dispatched once
 * and answer identically on both. The difference is where the state lives:
 * nothing is held between calls here, because the Durable Object already holds
 * it — a Worker request loads a snapshot, acts, and goes away.
 */
export class WorkerRoom implements RoomOps {
  private ops: DrawOp[] = [];
  private meta: RoomMeta = { url: null, width: null, createdAt: null, expiresAt: null };
  private canEdit = true;

  constructor(
    private readonly stub: DurableObjectStub<AnnotationRoom>,
    readonly roomId: string,
    private readonly agentId: string,
    private readonly env: Parameters<typeof fetchPage>[0]['env'],
  ) {}

  /** One round trip for everything a tool call might read. Also marks the agent present. */
  async load(): Promise<void> {
    await this.stub.agentHeartbeat(this.roomId, {
      id: `mcp-${this.agentId}`,
      name: this.agentId,
      color: agentColor(this.agentId),
    });
    const snapshot = await this.stub.agentSnapshot(this.roomId);
    const parsed = opsArraySchema.safeParse(snapshot.ops);
    this.ops = parsed.success ? parsed.data : [];
    this.meta = {
      url: snapshot.url,
      width: snapshot.width,
      createdAt: snapshot.createdAt,
      expiresAt: snapshot.expiresAt,
    };
    this.canEdit = snapshot.canEdit;
  }

  get viewOnly(): boolean {
    return !this.canEdit;
  }

  /** Nothing to be disconnected from: the room is a call away, not a socket held open. */
  checkLive(): string | null {
    return null;
  }

  /**
   * Fetched through the proxy's own path, so this inherits the SSRF guard and
   * the fixed-IP relay that a WAF-blocked host needs — the two reasons this
   * cannot simply be a fetch from wherever the agent happens to run.
   */
  async readPage(): Promise<PageReading | null> {
    const url = this.meta.url;
    if (!url) return null;
    const page = await fetchPage({ url, env: this.env });
    if (!page.stream || page.status >= 400 || !page.contentType.includes('html')) return null;
    return outlinePage({ html: await new Response(page.stream).text(), url: page.finalUrl });
  }

  getMeta(): RoomMeta {
    return { ...this.meta };
  }

  listAnnotations(filter?: { status?: CommentStatus | 'all' }): AnnotationOp[] {
    const status = filter?.status ?? 'all';
    return this.ops.filter(
      (op): op is AnnotationOp => isWatchable(op) && (status === 'all' || resolveOpStatus(op) === status),
    );
  }

  getAnnotation(id: string): { op: AnnotationOp; replies: CommentOp[] } | null {
    const op = this.ops.find((o): o is AnnotationOp => isWatchable(o) && o.id === id);
    if (!op) return null;
    return { op, replies: this.ops.filter((o): o is CommentOp => o.tool === 'comment' && o.parentId === id) };
  }

  /**
   * The Durable Object parks the wait, so this is one call rather than a poll.
   * Classification runs here against the snapshot already loaded, which is what
   * makes a handoff mean the same thing on both transports.
   */
  async watch({ timeoutSeconds = 60 }: { timeoutSeconds?: number; batchMs?: number }): Promise<WatchEvent[]> {
    const arrived = await this.stub.agentWatch(this.roomId, { timeoutMs: timeoutSeconds * 1000 });
    const events: WatchEvent[] = [];
    for (const op of arrived) {
      const event = classifyOp({ op, ops: this.ops, agentId: this.agentId });
      if (event) events.push(event);
    }
    return events;
  }

  private patch(id: string, patch: Record<string, unknown>): Promise<boolean> {
    return this.stub.agentPatchOp(this.roomId, id, patch);
  }

  acknowledge(id: string): Promise<boolean> {
    return this.patch(id, { status: 'in_progress', assignedAgent: this.agentId });
  }

  async resolve(id: string, summary?: string): Promise<boolean> {
    if (summary) await this.reply(id, summary);
    return this.patch(id, { status: 'resolved', resolved: true });
  }

  dismiss(id: string, reason: string): Promise<boolean> {
    return this.patch(id, { status: 'dismissed', dismissReason: reason, assignedAgent: this.agentId });
  }

  async reply(id: string, text: string): Promise<boolean> {
    const parent = this.ops.find((o): o is AnnotationOp => isWatchable(o) && o.id === id);
    if (!parent) return false;
    return this.push({
      ...this.signature(),
      id: nanoid(),
      tool: 'comment',
      num: this.nextNum(),
      text,
      ...opAnchor(parent),
      lineWidth: parent.lineWidth,
      parentId: id,
    });
  }

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
      id: nanoid(),
      tool: 'comment',
      num: this.nextNum(),
      text,
      x,
      y,
      lineWidth: 2,
      ...(priority ? { priority } : {}),
      ...(target ? { target } : {}),
    };
    return (await this.push(op)) ? { id: op.id } : null;
  }

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
      id: nanoid(),
      tool: 'selection',
      text,
      rects,
      // Re-normalized rather than trusted verbatim: the schema refine proved it
      // differs from `text`, not that it is trimmed.
      suggestion: normalizeSuggestion({ text, suggestion }) ?? suggestion,
      lineWidth: 2,
      ...(comment ? { comment } : {}),
      ...(priority ? { priority } : {}),
      ...(target ? { target } : {}),
    };
    return (await this.push(op)) ? { id: op.id } : null;
  }

  /** Every op this agent writes is signed and coloured the same way. */
  private signature() {
    return {
      color: agentColor(this.agentId),
      ts: Date.now(),
      author: this.agentId,
      // Stable across sessions: without it the roster forgets the agent as soon
      // as it stops calling, and nobody can assign or @mention it afterwards.
      authorId: this.agentId,
      assignedAgent: this.agentId,
    };
  }

  /** Replies are numbered off root threads only, or one would take a real comment's number. */
  private nextNum(): number {
    return this.ops.filter((o) => o.tool === 'comment' && !o.parentId).length + 1;
  }

  private async push(op: DrawOp): Promise<boolean> {
    const written = await this.stub.agentPushOp(this.roomId, op);
    if (written) this.ops.push(op);
    return written;
  }
}

/**
 * Build the MCP server for one request. Stateless on purpose: the SDK object is
 * cheap, and the session it would otherwise hold lives in the Durable Object.
 */
function buildServer({ room, apiBase }: { room: WorkerRoom; apiBase: string }): McpServer {
  const server = new McpServer({ name: 'marklayer', version: '1.0.0' });
  for (const tool of toolsFor({ remote: true })) {
    // connect_room has no meaning here: the room is named in the URL.
    if (tool.name === 'marklayer_connect_room') continue;
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: describedSchema(tool.inputSchema),
      },
      async (args: unknown): Promise<ToolContent> => {
        const answered = await callRoomTool({ name: tool.name, args, room, apiBase });
        return answered ?? { content: [{ type: 'text', text: `unknown tool: ${tool.name}` }], isError: true };
      },
    );
  }
  return server;
}

export async function handleMcpRequest({
  request,
  stub,
  roomId,
  apiBase,
  agentId,
  env,
}: {
  request: Request;
  stub: DurableObjectStub<AnnotationRoom>;
  roomId: string;
  apiBase: string;
  agentId: string;
  env: Parameters<typeof fetchPage>[0]['env'];
}): Promise<Response> {
  const room = new WorkerRoom(stub, roomId, agentId, env);
  await room.load();
  const server = buildServer({ room, apiBase });
  // No session id: each request is self-contained, which is what lets this run
  // on a Worker with nothing held between calls.
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  return transport.handleRequest(request);
}
