import type {
  AnnotationOp,
  CommentOp,
  CommentPriority,
  CommentStatus,
  DrawOp,
  SelectionRect,
  TargetElement,
} from '@marklayer/types';
import {
  COMMENT_PRIORITIES,
  commentPrioritySchema,
  isAnnotationOp,
  resolveOpStatus,
  selectionRectSchema,
  uploadPath,
} from '@marklayer/types';
import { z } from 'zod/mini';

/**
 * Everything about MarkLayer's agent tools that is not a transport.
 *
 * The schemas, the annotation projection and the validation used to live inside
 * `marklayer-mcp`, the stdio server published to npm, which put them out of reach
 * of the Worker. Lifting them here is what lets a second runtime serve the same
 * tools over Streamable HTTP; that endpoint is not built yet, so `apps/mcp` is
 * still the only consumer. No MCP SDK appears here on purpose: the two sides
 * would bind this to different libraries, so what is shared is the contract,
 * not the wiring.
 */

/** The JSON Schema a client is shown. Structurally the SDK's `Tool`, without depending on one. */
export interface ToolSpec {
  name: string;
  description: string;
  /**
   * Only the Worker can serve this one. Advertising it over stdio would offer a
   * tool that always answers with an error, which is worse than not offering it.
   */
  remoteOnly?: boolean;
  inputSchema: {
    type: 'object';
    properties?: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
}

/** An attachment's upload id, resolved to a URL an agent can fetch on its own. */
export function attachmentUrls(ids: string[] | undefined, apiBase: string): string[] {
  return (ids ?? []).map((id) => `${apiBase}${uploadPath(id)}`);
}

/**
 * Project an annotation op down to the agent-facing JSON shape. Each kind keeps
 * its own discriminator and surfaces the `target` element context (selector +
 * markup) so the agent has everything it needs to act on the change without
 * round-tripping back to the page. `apiBase` is the room's own origin, so a
 * screenshot attachment resolves to a URL the agent can fetch regardless of
 * which MarkLayer deployment this room lives on.
 */
export function projectAnnotation(op: AnnotationOp, apiBase: string) {
  const common = {
    id: op.id,
    kind: op.tool,
    status: resolveOpStatus(op),
    author: op.author ?? null,
    assignee: op.assignee ?? null,
    assignedAgent: op.assignedAgent ?? null,
    // Who the note names. An agent reading a thread has to know that "@Vadym can
    // you check this" is addressed to a person, not to it.
    mentions: op.mentions?.map((m) => m.name) ?? [],
    ts: op.ts,
  };
  if (op.tool === 'comment') {
    return {
      ...common,
      text: op.text,
      position: { x: op.x, y: op.y },
      url: op.meta?.url ?? null,
      target: op.target ?? null,
      attachments: attachmentUrls(op.attachments, apiBase),
    };
  }
  if (op.tool === 'area') {
    return {
      ...common,
      comment: op.comment ?? null,
      rect: { x: op.startX, y: op.startY, width: op.endX - op.startX, height: op.endY - op.startY },
      target: op.target ?? null,
    };
  }
  if (op.tool === 'selection') {
    return {
      ...common,
      text: op.text,
      // A proposed replacement for `text` — present when the reviewer asked for a
      // copy edit rather than leaving a note, so it can be applied as a diff.
      suggestion: op.suggestion ?? null,
      comment: op.comment ?? null,
      rects: op.rects,
      target: op.target ?? null,
    };
  }
  return {
    ...common,
    selector: op.selector,
    tag: op.tag,
    comment: op.comment ?? null,
    markdown: op.markdown,
    rect: op.rect,
  };
}

export type ToolContent = { content: { type: 'text'; text: string }[]; isError?: boolean };

export function ok(data: unknown): ToolContent {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

export function err(message: string): ToolContent {
  return { content: [{ type: 'text', text: JSON.stringify({ error: message }, null, 2) }], isError: true };
}

/**
 * Kept as one list because it is advertised and enforced separately: the Zod
 * schema validates the call, the hand-written JSON Schema below tells the client
 * what to send. Two literals would drift into a tool that offers a value it
 * rejects.
 */
export const STATUS_FILTERS = ['open', 'in_progress', 'resolved', 'approved', 'dismissed', 'all'] as const;
export const StatusFilter = z.enum(STATUS_FILTERS);

/** The annotation id every per-annotation tool takes, spread the way `targetParts` below is. */
const idPart = { id: z.string().check(z.minLength(1)) };

export const ConnectInput = z.object({ room: z.string().check(z.minLength(1)) });
export const ListInput = z.object({ status: z.optional(StatusFilter) });
export const IdInput = z.object({ ...idPart });
export const WatchInput = z.object({
  timeoutSeconds: z.optional(z.number().check(z.int(), z.gte(1), z.lte(600))),
  batchMs: z.optional(z.number().check(z.int(), z.gte(0), z.lte(10000))),
});
export const ResolveInput = z.object({ ...idPart, summary: z.optional(z.string()) });
export const DismissInput = z.object({ ...idPart, reason: z.string().check(z.minLength(1)) });
export const ReplyInput = z.object({ ...idPart, text: z.string().check(z.minLength(1)) });
/**
 * Shared by every tool that lets an agent anchor a new annotation to an
 * element: `selector`/`tag`/`markdown` must arrive all three or none, never a
 * partial triple that would fail `targetElementSchema`'s required fields at
 * the wire boundary. A schema-level refine, so it is rejected before the
 * handler ever runs — the same way every other tool's input is validated.
 */
const targetTripleCheck = z.refine<{ selector?: string; tag?: string; markdown?: string }>(
  ({ selector, tag, markdown }) => {
    const given = [selector, tag, markdown].filter((v) => v !== undefined).length;
    return given === 0 || given === 3;
  },
  'selector, tag and markdown must be given together, or not at all',
);

/** The element-anchor triple itself, spread into every schema that carries `targetTripleCheck`. */
const targetParts = {
  selector: z.optional(z.string()),
  tag: z.optional(z.string()),
  markdown: z.optional(z.string()),
};

/** Builds the `target` block once a schema carrying `targetTripleCheck` has already guaranteed all-or-none. */
export function targetFromParts({
  selector,
  tag,
  markdown,
}: {
  selector?: string;
  tag?: string;
  markdown?: string;
}): { selector: string; tag: string; markdown: string } | undefined {
  return selector && tag && markdown ? { selector, tag, markdown } : undefined;
}

export const CreateInput = z
  .object({
    text: z.string().check(z.minLength(1)),
    x: z.number(),
    y: z.number(),
    priority: z.optional(commentPrioritySchema),
    ...targetParts,
  })
  .check(targetTripleCheck);

/**
 * `rects` mirrors the human selection tool's own shape — one box per line the
 * proposed edit spans — rather than a single bounding box, so a multi-line
 * selection renders as a multi-line highlight instead of one box swallowing
 * the whole paragraph between its first and last line.
 */
export const SuggestInput = z
  .object({
    text: z.string().check(z.minLength(1)),
    suggestion: z.string().check(z.minLength(1)),
    rects: z.array(selectionRectSchema).check(z.minLength(1)),
    comment: z.optional(z.string()),
    priority: z.optional(commentPrioritySchema),
    ...targetParts,
  })
  .check(
    targetTripleCheck,
    z.refine(
      ({ text, suggestion }) => text.trim() !== suggestion.trim(),
      'suggestion must differ from text — there is nothing to propose otherwise',
    ),
  );

/**
 * A mutator returned false. It has two causes worth telling apart: the room
 * refuses this peer's writes, or the id genuinely is not there. Reporting the
 * first as "not found" sent an agent hunting for a missing annotation when the
 * real answer was that the owner made the link view-only.
 */
export function mutationErr({ room, id }: { room: { viewOnly: boolean }; id: string }): ToolContent {
  return room.viewOnly
    ? err(`this link is view-only, so nothing can be changed through it: ${id}`)
    : err(`annotation not found: ${id}`);
}

export function fail(parseError: { issues: { path: PropertyKey[]; message: string }[] }): ToolContent {
  const flat = parseError.issues
    .map((i) => `${i.path.length ? i.path.map(String).join('.') : '<root>'}: ${i.message}`)
    .join('; ');
  return err(`invalid arguments: ${flat}`);
}

export const TOOLS: ToolSpec[] = [
  {
    name: 'marklayer_read_page',
    remoteOnly: true,
    description:
      'Read the page this room annotates — its headings, paragraphs, links, buttons and labels, each with the CSS ' +
      'selector and tag that locate it. Call this FIRST when asked to review, audit or improve a page and no ' +
      'annotations exist yet: without it you can only answer feedback someone else left, never find anything ' +
      'yourself. Every entry is already in the shape marklayer_suggest_edit and marklayer_create_annotation take, ' +
      'so pass `selector`, `tag` and `markdown` straight through to anchor a mark to the element you are talking ' +
      'about. If the answer says the page renders client-side, the copy is not in the HTML and you should say so ' +
      'rather than review an empty shell.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'marklayer_connect_room',
    description: 'Connect to a MarkLayer room (annotation session) by URL or bare room id. Disconnects any prior room.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['room'],
      properties: {
        room: {
          type: 'string',
          description: 'Room URL like https://marklayer.app/s/abc123 or a bare room id like abc123.',
        },
      },
    },
  },
  {
    name: 'marklayer_room_info',
    description: 'Get metadata about the connected room: page URL, viewport width, timestamps.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'marklayer_list_annotations',
    description:
      'List every annotation in the connected room across all tools (comment, area, selection, inspect). ' +
      'Each entry carries a `kind` discriminator and, where the user marked an element, a `target` block ' +
      'with selector + markdown so you can address the change without reopening the page. ' +
      'Filter by status: open, in_progress, resolved, approved, dismissed, or all (default). `approved` means the person who asked for the change confirmed the fix, so those need nothing from you.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        status: { type: 'string', enum: [...STATUS_FILTERS] },
      },
    },
  },
  {
    name: 'marklayer_get_annotation',
    description:
      'Get full detail for a single annotation of any kind (comment, area, selection, inspect), including ' +
      'its element `target` context and — for comments — the reply thread.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['id'],
      properties: { id: { type: 'string' } },
    },
  },
  {
    name: 'marklayer_watch_annotations',
    description:
      'Block until there is work, then return a batch of whatever arrives within a short window. Each event has a ' +
      '`kind`: "new" is an annotation someone just left; "handoff" is one given to you — assigned to you, a reply ' +
      'that @mentions you, or a reply on a thread you already own. A handoff also carries `request`, the reply that ' +
      'asked: read it, it is the instruction, and act on it rather than only acknowledging. Every event carries the ' +
      'full annotation with its `target` element context. Returns an empty list if the timeout expires first. Use ' +
      'this in a loop to process feedback as it arrives.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        timeoutSeconds: {
          type: 'integer',
          minimum: 1,
          maximum: 600,
          description: 'How long to wait for new annotations before returning. Default 60.',
        },
        batchMs: {
          type: 'integer',
          minimum: 0,
          maximum: 10000,
          description: 'After the first new annotation arrives, wait this long for more before returning. Default 750.',
        },
      },
    },
  },
  {
    name: 'marklayer_acknowledge',
    description:
      'Mark an annotation as in_progress and tag it with this agent so the human sees you are working on it.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['id'],
      properties: { id: { type: 'string' } },
    },
  },
  {
    name: 'marklayer_resolve',
    description:
      'Mark an annotation as resolved. Pass a summary describing what was changed — it will be posted as a reply to the thread.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['id'],
      properties: {
        id: { type: 'string' },
        summary: { type: 'string', description: 'Short description of what changed, posted as a reply.' },
      },
    },
  },
  {
    name: 'marklayer_dismiss',
    description: 'Mark an annotation as dismissed when it cannot be acted on. The reason will be visible to the human.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'reason'],
      properties: {
        id: { type: 'string' },
        reason: { type: 'string', description: 'Why you cannot act on this annotation.' },
      },
    },
  },
  {
    name: 'marklayer_reply',
    description: 'Post a reply to an annotation thread without changing its status. Use to ask clarifying questions.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'text'],
      properties: { id: { type: 'string' }, text: { type: 'string' } },
    },
  },
  {
    name: 'marklayer_create_annotation',
    description:
      'Leave a new comment annotation yourself — proactive feedback (a bug, a UX issue, an accessibility gap, an ' +
      'idea) rather than only responding to a human’s. For an exact text replacement (a copy or grammar fix), use ' +
      'marklayer_suggest_edit instead — it renders as a diff the human can accept, rather than prose describing one. ' +
      'Use this after you have looked at the page with your own tools (a screenshot, a DOM read) and decided ' +
      'something is worth flagging; call it once per finding so each becomes its own pin the human can triage. x/y ' +
      'are document pixels (not viewport pixels — scroll offset already added in). Pass selector + tag + markdown ' +
      'together to anchor the pin to that element so it re-resolves if the page reflows; omit all three for a ' +
      'fixed-point pin.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['text', 'x', 'y'],
      properties: {
        text: { type: 'string', description: 'The feedback itself.' },
        x: { type: 'number', description: 'Document-space X in CSS pixels.' },
        y: { type: 'number', description: 'Document-space Y in CSS pixels.' },
        priority: {
          type: 'string',
          enum: [...COMMENT_PRIORITIES],
          description: 'Triage priority, if this warrants one.',
        },
        selector: { type: 'string', description: 'CSS selector of the element this is about.' },
        tag: { type: 'string', description: 'Tag name of that element, e.g. "button".' },
        markdown: { type: 'string', description: 'Short markdown snapshot of the element, for the human to see.' },
      },
    },
  },
  {
    name: 'marklayer_suggest_edit',
    description:
      'Propose an exact replacement for a piece of text on the page — a copy or grammar fix — as a diff the human ' +
      'can accept, rather than a comment describing the change in prose. `rects` are the on-page bounding boxes of ' +
      '`text`, in document pixels: one per line it spans, so a wrapped sentence highlights as several boxes rather ' +
      'than one box swallowing the whole paragraph between its first and last line. Pass selector + tag + markdown ' +
      'together to anchor it to the containing element so it re-resolves if the page reflows.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['text', 'suggestion', 'rects'],
      properties: {
        text: { type: 'string', description: 'The exact text on the page being replaced.' },
        suggestion: { type: 'string', description: 'The exact replacement text.' },
        rects: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            required: ['x', 'y', 'width', 'height'],
            properties: {
              x: { type: 'number' },
              y: { type: 'number' },
              width: { type: 'number' },
              height: { type: 'number' },
            },
          },
          description: 'Document-pixel bounding box(es) of `text` on the page — one per line it spans.',
        },
        comment: { type: 'string', description: 'Optional note explaining the fix, if it is not self-evident.' },
        priority: {
          type: 'string',
          enum: [...COMMENT_PRIORITIES],
          description: 'Triage priority, if this warrants one.',
        },
        selector: { type: 'string', description: 'CSS selector of the element containing this text.' },
        tag: { type: 'string', description: 'Tag name of that element, e.g. "p".' },
        markdown: { type: 'string', description: 'Short markdown snapshot of the element, for the human to see.' },
      },
    },
  },
];

/**
 * Advertise a tool's arguments to MCP without validating them twice.
 *
 * SDK v2 takes a Standard Schema that both validates a call and describes itself
 * for `tools/list`. The describing half is what is wanted here; the validating
 * half already happens in `callRoomTool`, against the per-tool Zod schemas that
 * own the error text an agent reads. So this accepts every value and says so,
 * rather than running a second, weaker check whose failures would report worse.
 *
 * (Zod cannot fill this slot directly: only the full `zod` package carries
 * `~standard.jsonSchema`, and this repo ships `zod/mini`, which does not.)
 */
export function describedSchema(json: ToolSpec['inputSchema']) {
  const convert = () => json as unknown as Record<string, unknown>;
  return {
    '~standard': {
      version: 1 as const,
      vendor: 'marklayer',
      validate: (value: unknown) => ({ value }),
      // A Converter, not a function: the SDK asks input and output separately,
      // and a tool's arguments are the input in both directions here.
      jsonSchema: { input: convert, output: convert },
    },
  };
}

/** The JSON Schema a tool advertises, by name. */
export const toolSchemaFor = (name: string): ToolSpec['inputSchema'] | undefined =>
  TOOLS.find((tool) => tool.name === name)?.inputSchema;

type Awaitable<T> = T | Promise<T>;

/** One text-bearing element, in the shape the write tools already take. */
export interface PageEntry {
  selector: string;
  tag: string;
  text: string;
  /** The same snapshot a human's Inspect comment carries — pass it straight to a write tool. */
  markdown: string;
}

/** What `marklayer_read_page` answers with. */
export interface PageReading {
  url: string;
  title: string | null;
  entries: PageEntry[];
  /** The document rendered client-side: this is the shell, not the copy. Say so rather than audit nothing. */
  clientRendered: boolean;
  truncated: boolean;
}

/** Room facts an agent asks for before doing anything else. */
export interface RoomMeta {
  url: string | null;
  width: number | null;
  createdAt: number | null;
  expiresAt: number | null;
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
export interface WatchEvent {
  kind: 'new' | 'handoff';
  op: AnnotationOp;
  /** The reply that handed it over, when a reply is what did. Read it: it is the instruction. */
  reply?: CommentOp;
}

/**
 * One room, however it is reached.
 *
 * The stdio server holds a WebSocket to the room; the Worker calls the Durable
 * Object that owns it. Same tools, same answers — so the dispatch below is
 * written once against this, rather than twice against two clients that would
 * quietly drift into disagreeing about what `resolve` returns.
 */
export interface RoomOps {
  readonly roomId: string;
  /**
   * The page's own copy, so an agent can review it rather than only react to
   * annotations someone already left. `null` when this transport cannot fetch —
   * the SSRF guard and the blocked-host relay live in the Worker, and neither
   * belongs in a CLI on someone's laptop.
   */
  readPage?(): Promise<PageReading | null>;
  readonly viewOnly: boolean;
  getMeta(): RoomMeta;
  /** An error to return instead of acting, when the connection cannot carry a write. */
  checkLive(): string | null;
  listAnnotations(filter?: { status?: CommentStatus | 'all' }): AnnotationOp[];
  getAnnotation(id: string): { op: AnnotationOp; replies: CommentOp[] } | null;
  watch(opts: { timeoutSeconds?: number; batchMs?: number }): Promise<WatchEvent[]>;
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
}

/**
 * Run one tool against a room. `null` means the name is not one of these — the
 * caller owns anything transport-specific (the stdio server's connect_room has
 * no meaning over HTTP, where the room is already named in the URL).
 */
export async function callRoomTool({
  name,
  args,
  room,
  apiBase,
}: {
  name: string;
  args: unknown;
  room: RoomOps;
  apiBase: string;
}): Promise<ToolContent | null> {
  const live = (): ToolContent | null => {
    const dead = room.checkLive();
    return dead ? err(dead) : null;
  };

  switch (name) {
    case 'marklayer_read_page': {
      if (!room.readPage) return err('this connection cannot read the page — use the remote MCP endpoint');
      const page = await room.readPage();
      if (!page) return err('could not read the page — it may be unreachable or not HTML');
      if (page.clientRendered) {
        return ok({
          ...page,
          note: 'This page renders client-side, so only its shell was served. The copy is not in the HTML — ask a human to annotate the parts you should review, or use a browser tool if you have one.',
        });
      }
      return ok(page);
    }

    case 'marklayer_room_info':
      return ok({ roomId: room.roomId, ...room.getMeta() });

    case 'marklayer_list_annotations': {
      const parsed = ListInput.safeParse(args);
      if (!parsed.success) return fail(parsed.error);
      const ann = room.listAnnotations({ status: parsed.data.status });
      return ok({ count: ann.length, annotations: ann.map((op) => projectAnnotation(op, apiBase)) });
    }

    case 'marklayer_get_annotation': {
      const parsed = IdInput.safeParse(args);
      if (!parsed.success) return fail(parsed.error);
      const found = room.getAnnotation(parsed.data.id);
      if (!found) return err(`annotation not found: ${parsed.data.id}`);
      return ok({
        ...projectAnnotation(found.op, apiBase),
        dismissReason: found.op.dismissReason ?? null,
        replies: found.replies.map((r) => ({
          id: r.id,
          text: r.text,
          author: r.author ?? null,
          ts: r.ts,
          attachments: attachmentUrls(r.attachments, apiBase),
        })),
      });
    }

    case 'marklayer_watch_annotations': {
      const parsed = WatchInput.safeParse(args);
      if (!parsed.success) return fail(parsed.error);
      const batch = await room.watch(parsed.data);
      return ok({
        count: batch.length,
        events: batch.map((event) => ({
          kind: event.kind,
          annotation: projectAnnotation(event.op, apiBase),
          // The reply that handed it over is the instruction — surfaced beside
          // the thread so the agent reads what was asked, not just what exists.
          ...(event.reply ? { request: { from: event.reply.author ?? null, text: event.reply.text } } : {}),
        })),
      });
    }

    case 'marklayer_acknowledge': {
      const parsed = IdInput.safeParse(args);
      if (!parsed.success) return fail(parsed.error);
      const dead = live();
      if (dead) return dead;
      if (!(await room.acknowledge(parsed.data.id))) return mutationErr({ room, id: parsed.data.id });
      return ok({ id: parsed.data.id, status: 'in_progress' });
    }

    case 'marklayer_resolve': {
      const parsed = ResolveInput.safeParse(args);
      if (!parsed.success) return fail(parsed.error);
      const dead = live();
      if (dead) return dead;
      if (!(await room.resolve(parsed.data.id, parsed.data.summary))) return mutationErr({ room, id: parsed.data.id });
      return ok({ id: parsed.data.id, status: 'resolved' });
    }

    case 'marklayer_dismiss': {
      const parsed = DismissInput.safeParse(args);
      if (!parsed.success) return fail(parsed.error);
      const dead = live();
      if (dead) return dead;
      if (!(await room.dismiss(parsed.data.id, parsed.data.reason))) return mutationErr({ room, id: parsed.data.id });
      return ok({ id: parsed.data.id, status: 'dismissed', reason: parsed.data.reason });
    }

    case 'marklayer_reply': {
      const parsed = ReplyInput.safeParse(args);
      if (!parsed.success) return fail(parsed.error);
      const dead = live();
      if (dead) return dead;
      if (!(await room.reply(parsed.data.id, parsed.data.text))) return mutationErr({ room, id: parsed.data.id });
      return ok({ id: parsed.data.id, replied: true });
    }

    case 'marklayer_create_annotation': {
      const parsed = CreateInput.safeParse(args);
      if (!parsed.success) return fail(parsed.error);
      const { text, x, y, priority, selector, tag, markdown } = parsed.data;
      const dead = live();
      if (dead) return dead;
      const created = await room.create({ text, x, y, priority, target: targetFromParts({ selector, tag, markdown }) });
      if (!created) return err(createFailure({ room, what: 'annotation' }));
      return ok({ id: created.id, status: 'open' });
    }

    case 'marklayer_suggest_edit': {
      const parsed = SuggestInput.safeParse(args);
      if (!parsed.success) return fail(parsed.error);
      const { text, suggestion, rects, comment, priority, selector, tag, markdown } = parsed.data;
      const dead = live();
      if (dead) return dead;
      const created = await room.suggestEdit({
        text,
        suggestion,
        rects,
        comment,
        priority,
        target: targetFromParts({ selector, tag, markdown }),
      });
      if (!created) return err(createFailure({ room, what: 'suggestion' }));
      return ok({ id: created.id, status: 'open' });
    }

    default:
      return null;
  }
}

/** A create returned nothing: say which of the two reasons it was. */
function createFailure({ room, what }: { room: RoomOps; what: string }): string {
  return room.viewOnly
    ? `this link is view-only, so nothing can be created through it`
    : `could not create the ${what} — the room connection may be down`;
}

/** Replies belong to their parent thread, so they are not themselves watchable. */
export const isWatchableOp = (op: DrawOp): op is AnnotationOp =>
  isAnnotationOp(op) && !(op.tool === 'comment' && !!op.parentId);

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
}: {
  op: DrawOp;
  ops: readonly DrawOp[];
  agentId: string;
}): WatchEvent | null {
  // Taken before any narrowing: `isWatchableOp` is a type predicate, so testing
  // it first would leave the else branch typed as everything a reply is not.
  const reply = op.tool === 'comment' && op.parentId ? op : null;
  if (!reply) return isWatchableOp(op) ? { kind: 'new', op } : null;
  if (reply.author === agentId) return null;
  const parent = ops.find((o): o is AnnotationOp => isWatchableOp(o) && o.id === reply.parentId);
  if (!parent) return null;
  const named = (reply.mentions ?? []).some((mention) => mention.id === agentId);
  const mine = parent.author === agentId || parent.assignedAgent === agentId || parent.assignee === agentId;
  return named || mine ? { kind: 'handoff', op: parent, reply } : null;
}

/** What a transport should advertise. stdio cannot fetch a page; the Worker can. */
export const toolsFor = ({ remote }: { remote: boolean }): ToolSpec[] =>
  remote ? TOOLS : TOOLS.filter((tool) => !tool.remoteOnly);
