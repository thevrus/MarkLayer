import { COMMENT_PRIORITIES, commentPrioritySchema, selectionRectSchema, uploadPath } from '@marklayer/types';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, type Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod/mini';
// Read, not restated: the literal here silently fell three releases behind package.json before.
import { version } from '../package.json' with { type: 'json' };
import { type AnnotationOp, RoomClient, resolveStatus } from './room.js';

/** An attachment's upload id, resolved to a URL an agent can fetch on its own. */
function attachmentUrls(ids: string[] | undefined, apiBase: string): string[] {
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
    status: resolveStatus(op),
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

interface ServerOptions {
  apiBase: string;
  initialRoom: string | null;
  agentId: string;
}

/**
 * Resolve a user-supplied room reference (URL or bare id) to the room id
 * used by the MarkLayer worker. Accepts:
 *   - "abc123"
 *   - "https://marklayer.app/s/abc123"
 *   - "https://marklayer.app/s/abc123?something"
 */
export function parseRoomRef(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new Error('empty room reference');
  if (!trimmed.includes('/')) return trimmed;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`invalid room reference: ${input}`);
  }
  const match = parsed.pathname.match(/\/s\/([^/]+)/);
  if (match?.[1]) return match[1];
  throw new Error(`could not extract room id from URL: ${input}`);
}

type ToolContent = { content: { type: 'text'; text: string }[]; isError?: boolean };

function ok(data: unknown): ToolContent {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function err(message: string): ToolContent {
  return { content: [{ type: 'text', text: JSON.stringify({ error: message }, null, 2) }], isError: true };
}

/**
 * Kept as one list because it is advertised and enforced separately: the Zod
 * schema validates the call, the hand-written JSON Schema below tells the client
 * what to send. Two literals would drift into a tool that offers a value it
 * rejects.
 */
const STATUS_FILTERS = ['open', 'in_progress', 'resolved', 'approved', 'dismissed', 'all'] as const;
const StatusFilter = z.enum(STATUS_FILTERS);

const ConnectInput = z.object({ room: z.string().check(z.minLength(1)) });
const ListInput = z.object({ status: z.optional(StatusFilter) });
const IdInput = z.object({ id: z.string().check(z.minLength(1)) });
const WatchInput = z.object({
  timeoutSeconds: z.optional(z.number().check(z.int(), z.gte(1), z.lte(600))),
  batchMs: z.optional(z.number().check(z.int(), z.gte(0), z.lte(10000))),
});
const ResolveInput = z.object({
  id: z.string().check(z.minLength(1)),
  summary: z.optional(z.string()),
});
const DismissInput = z.object({
  id: z.string().check(z.minLength(1)),
  reason: z.string().check(z.minLength(1)),
});
const ReplyInput = z.object({
  id: z.string().check(z.minLength(1)),
  text: z.string().check(z.minLength(1)),
});
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

const CreateInput = z
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
const SuggestInput = z
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

function fail(parseError: { issues: { path: PropertyKey[]; message: string }[] }): ToolContent {
  const flat = parseError.issues
    .map((i) => `${i.path.length ? i.path.map(String).join('.') : '<root>'}: ${i.message}`)
    .join('; ');
  return err(`invalid arguments: ${flat}`);
}

const TOOLS: Tool[] = [
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

export async function startServer(opts: ServerOptions): Promise<void> {
  const server = new Server(
    { name: 'marklayer-mcp', version },
    {
      capabilities: { tools: {} },
      instructions:
        'Bridge between MarkLayer annotations on a webpage and an AI coding agent. ' +
        'Call marklayer_connect_room first if no MARKLAYER_ROOM was provided at startup. ' +
        'Each annotation carries a `kind` (comment | area | selection | inspect) and, where available, ' +
        'a `target` block with the element selector + markdown — that is your handle for code changes; ' +
        'do not ask the user to repeat what was clicked. ' +
        'A selection annotation may also carry a `suggestion`: the exact text the reviewer wants in place of its ' +
        '`text`. Apply it verbatim rather than paraphrasing it. ' +
        'A comment (or a reply, from marklayer_get_annotation) may carry `attachments`: fetchable image URLs the ' +
        'reviewer attached — fetch and look at one before acting on a comment that has any, they often show the ' +
        'bug or the intended layout better than the text does. ' +
        'Typical loop: marklayer_list_annotations to backfill anything pending, then marklayer_watch_annotations ' +
        'in a loop. For each one: acknowledge, make the requested code changes, resolve with a summary. ' +
        'Use dismiss when an annotation cannot be acted on, with a reason the human can read. ' +
        'You can also work the other direction: if asked to review, audit, or give feedback on the page (bugs, UX ' +
        'or accessibility issues, ideas), inspect it with your own tools and call marklayer_create_annotation once ' +
        'per finding — do not bundle several into one comment. For an exact copy or grammar fix, use ' +
        'marklayer_suggest_edit instead of a comment, so the human gets a diff to accept rather than prose ' +
        'describing one.',
    },
  );

  let room: RoomClient | null = null;

  const ensureRoom = (): RoomClient => {
    if (!room) {
      throw new Error('no room connected — call marklayer_connect_room first or set MARKLAYER_ROOM in the environment');
    }
    return room;
  };

  /**
   * A write on a dead socket used to come back as `annotation not found`, which
   * sends the agent hunting for an id that is fine. Say what actually happened.
   */
  const ensureLive = (r: RoomClient): ToolContent | null => {
    const why = r.disconnectedReason();
    if (!why) return null;
    return err(`room ${r.roomId} is not connected (${why}) — call marklayer_connect_room to reconnect`);
  };

  if (opts.initialRoom) {
    try {
      room = new RoomClient(opts.apiBase, parseRoomRef(opts.initialRoom), opts.agentId);
      await room.connect();
    } catch (e) {
      console.error(`marklayer-mcp: failed to connect to initial room: ${(e as Error).message}`);
      room = null;
    }
  }

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (req): Promise<ToolContent> => {
    const name = req.params.name;
    const rawArgs = req.params.arguments ?? {};
    try {
      switch (name) {
        case 'marklayer_connect_room': {
          const parsed = ConnectInput.safeParse(rawArgs);
          if (!parsed.success) return fail(parsed.error);
          const id = parseRoomRef(parsed.data.room);
          if (room) room.close();
          room = new RoomClient(opts.apiBase, id, opts.agentId);
          await room.connect();
          return ok({ roomId: id, ...room.getMeta() });
        }

        case 'marklayer_room_info': {
          const r = ensureRoom();
          return ok({ roomId: r.roomId, ...r.getMeta() });
        }

        case 'marklayer_list_annotations': {
          const parsed = ListInput.safeParse(rawArgs);
          if (!parsed.success) return fail(parsed.error);
          const r = ensureRoom();
          const ann = r.listAnnotations({ status: parsed.data.status });
          return ok({
            count: ann.length,
            annotations: ann.map((op) => projectAnnotation(op, opts.apiBase)),
          });
        }

        case 'marklayer_get_annotation': {
          const parsed = IdInput.safeParse(rawArgs);
          if (!parsed.success) return fail(parsed.error);
          const r = ensureRoom();
          const found = r.getAnnotation(parsed.data.id);
          if (!found) return err(`annotation not found: ${parsed.data.id}`);
          return ok({
            ...projectAnnotation(found.op, opts.apiBase),
            dismissReason: found.op.dismissReason ?? null,
            replies: found.replies.map((reply) => ({
              id: reply.id,
              text: reply.text,
              author: reply.author ?? null,
              ts: reply.ts,
              attachments: attachmentUrls(reply.attachments, opts.apiBase),
            })),
          });
        }

        case 'marklayer_watch_annotations': {
          const parsed = WatchInput.safeParse(rawArgs);
          if (!parsed.success) return fail(parsed.error);
          const r = ensureRoom();
          const batch = await r.watch(parsed.data);
          return ok({
            count: batch.length,
            events: batch.map((event) => ({
              kind: event.kind,
              annotation: projectAnnotation(event.op, opts.apiBase),
              // The reply that handed it over is the instruction — surfaced beside
              // the thread so the agent reads what was asked, not just what exists.
              ...(event.reply ? { request: { from: event.reply.author ?? null, text: event.reply.text } } : {}),
            })),
          });
        }

        case 'marklayer_acknowledge': {
          const parsed = IdInput.safeParse(rawArgs);
          if (!parsed.success) return fail(parsed.error);
          const r = ensureRoom();
          const dead = ensureLive(r);
          if (dead) return dead;
          if (!r.acknowledge(parsed.data.id)) return mutationErr({ room: r, id: parsed.data.id });
          return ok({ id: parsed.data.id, status: 'in_progress', assignedAgent: opts.agentId });
        }

        case 'marklayer_resolve': {
          const parsed = ResolveInput.safeParse(rawArgs);
          if (!parsed.success) return fail(parsed.error);
          const r = ensureRoom();
          const dead = ensureLive(r);
          if (dead) return dead;
          if (!r.resolve(parsed.data.id, parsed.data.summary)) return mutationErr({ room: r, id: parsed.data.id });
          return ok({ id: parsed.data.id, status: 'resolved' });
        }

        case 'marklayer_dismiss': {
          const parsed = DismissInput.safeParse(rawArgs);
          if (!parsed.success) return fail(parsed.error);
          const r = ensureRoom();
          const dead = ensureLive(r);
          if (dead) return dead;
          if (!r.dismiss(parsed.data.id, parsed.data.reason)) return mutationErr({ room: r, id: parsed.data.id });
          return ok({ id: parsed.data.id, status: 'dismissed', reason: parsed.data.reason });
        }

        case 'marklayer_reply': {
          const parsed = ReplyInput.safeParse(rawArgs);
          if (!parsed.success) return fail(parsed.error);
          const r = ensureRoom();
          const dead = ensureLive(r);
          if (dead) return dead;
          if (!r.reply(parsed.data.id, parsed.data.text)) return mutationErr({ room: r, id: parsed.data.id });
          return ok({ id: parsed.data.id, replied: true });
        }

        case 'marklayer_create_annotation': {
          const parsed = CreateInput.safeParse(rawArgs);
          if (!parsed.success) return fail(parsed.error);
          const { text, x, y, priority, selector, tag, markdown } = parsed.data;
          const r = ensureRoom();
          const dead = ensureLive(r);
          if (dead) return dead;
          const created = r.create({ text, x, y, priority, target: targetFromParts({ selector, tag, markdown }) });
          if (!created) {
            return r.viewOnly
              ? err('this link is view-only, so nothing can be created through it')
              : err('could not create the annotation — the room socket may be disconnected');
          }
          return ok({ id: created.id, status: 'open' });
        }

        case 'marklayer_suggest_edit': {
          const parsed = SuggestInput.safeParse(rawArgs);
          if (!parsed.success) return fail(parsed.error);
          const { text, suggestion, rects, comment, priority, selector, tag, markdown } = parsed.data;
          const r = ensureRoom();
          const dead = ensureLive(r);
          if (dead) return dead;
          const created = r.suggestEdit({
            text,
            suggestion,
            rects,
            comment,
            priority,
            target: targetFromParts({ selector, tag, markdown }),
          });
          if (!created) {
            return r.viewOnly
              ? err('this link is view-only, so nothing can be created through it')
              : err('could not create the suggestion — the room socket may be disconnected');
          }
          return ok({ id: created.id, status: 'open' });
        }

        default:
          return err(`unknown tool: ${name}`);
      }
    } catch (e) {
      return err((e as Error).message);
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  const cleanup = () => {
    if (room) {
      room.close();
      room = null;
    }
    process.exit(0);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}
