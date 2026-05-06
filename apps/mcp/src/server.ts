import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, type Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod/mini';
import { type AnnotationOp, RoomClient, resolveStatus } from './room.js';

/**
 * Project an annotation op down to the agent-facing JSON shape. Each kind keeps
 * its own discriminator and surfaces the `target` element context (selector +
 * markup) so the agent has everything it needs to act on the change without
 * round-tripping back to the page.
 */
function projectAnnotation(op: AnnotationOp) {
  const common = {
    id: op.id,
    kind: op.tool,
    status: resolveStatus(op),
    author: op.author ?? null,
    assignedAgent: op.assignedAgent ?? null,
    ts: op.ts,
  };
  if (op.tool === 'comment') {
    return {
      ...common,
      text: op.text,
      position: { x: op.x, y: op.y },
      url: op.meta?.url ?? null,
      target: op.target ?? null,
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
function parseRoomRef(input: string): string {
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

const StatusFilter = z.enum(['open', 'in_progress', 'resolved', 'dismissed', 'all']);

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
      'Filter by status: open, in_progress, resolved, dismissed, or all (default).',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        status: { type: 'string', enum: ['open', 'in_progress', 'resolved', 'dismissed', 'all'] },
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
      'Block until a new annotation is created, then return a batch of any that arrive within a short window. ' +
      'Returns annotations of every kind (comment, area, selection, inspect) with their `target` element context. ' +
      'Returns an empty list if the timeout expires first. Use this in a loop to process feedback as it arrives.',
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
];

export async function startServer(opts: ServerOptions): Promise<void> {
  const server = new Server(
    { name: 'marklayer-mcp', version: '0.1.2' },
    {
      capabilities: { tools: {} },
      instructions:
        'Bridge between MarkLayer annotations on a webpage and an AI coding agent. ' +
        'Call marklayer_connect_room first if no MARKLAYER_ROOM was provided at startup. ' +
        'Each annotation carries a `kind` (comment | area | selection | inspect) and, where available, ' +
        'a `target` block with the element selector + markdown — that is your handle for code changes; ' +
        'do not ask the user to repeat what was clicked. ' +
        'Typical loop: marklayer_list_annotations to backfill anything pending, then marklayer_watch_annotations ' +
        'in a loop. For each one: acknowledge, make the requested code changes, resolve with a summary. ' +
        'Use dismiss when an annotation cannot be acted on, with a reason the human can read.',
    },
  );

  let room: RoomClient | null = null;

  const ensureRoom = (): RoomClient => {
    if (!room) {
      throw new Error('no room connected — call marklayer_connect_room first or set MARKLAYER_ROOM in the environment');
    }
    return room;
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
            annotations: ann.map(projectAnnotation),
          });
        }

        case 'marklayer_get_annotation': {
          const parsed = IdInput.safeParse(rawArgs);
          if (!parsed.success) return fail(parsed.error);
          const r = ensureRoom();
          const found = r.getAnnotation(parsed.data.id);
          if (!found) return err(`annotation not found: ${parsed.data.id}`);
          return ok({
            ...projectAnnotation(found.op),
            dismissReason: found.op.dismissReason ?? null,
            replies: found.replies.map((reply) => ({
              id: reply.id,
              text: reply.text,
              author: reply.author ?? null,
              ts: reply.ts,
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
            annotations: batch.map(projectAnnotation),
          });
        }

        case 'marklayer_acknowledge': {
          const parsed = IdInput.safeParse(rawArgs);
          if (!parsed.success) return fail(parsed.error);
          const r = ensureRoom();
          if (!r.acknowledge(parsed.data.id)) return err(`annotation not found: ${parsed.data.id}`);
          return ok({ id: parsed.data.id, status: 'in_progress', assignedAgent: opts.agentId });
        }

        case 'marklayer_resolve': {
          const parsed = ResolveInput.safeParse(rawArgs);
          if (!parsed.success) return fail(parsed.error);
          const r = ensureRoom();
          if (!r.resolve(parsed.data.id, parsed.data.summary)) return err(`annotation not found: ${parsed.data.id}`);
          return ok({ id: parsed.data.id, status: 'resolved' });
        }

        case 'marklayer_dismiss': {
          const parsed = DismissInput.safeParse(rawArgs);
          if (!parsed.success) return fail(parsed.error);
          const r = ensureRoom();
          if (!r.dismiss(parsed.data.id, parsed.data.reason)) return err(`annotation not found: ${parsed.data.id}`);
          return ok({ id: parsed.data.id, status: 'dismissed', reason: parsed.data.reason });
        }

        case 'marklayer_reply': {
          const parsed = ReplyInput.safeParse(rawArgs);
          if (!parsed.success) return fail(parsed.error);
          const r = ensureRoom();
          if (!r.reply(parsed.data.id, parsed.data.text)) return err(`annotation not found: ${parsed.data.id}`);
          return ok({ id: parsed.data.id, replied: true });
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
