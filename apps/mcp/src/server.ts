// Read, not restated: the literal here silently fell three releases behind package.json before.
import { ConnectInput, callRoomTool, err, fail, ok, TOOLS, type ToolContent } from '@marklayer/agent-tools';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { version } from '../package.json' with { type: 'json' };
import { RoomClient } from './room.js';

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
      // connect_room is the one tool that is not about a room's contents, so it
      // stays here: over HTTP the room is already named in the URL and there is
      // nothing to connect.
      if (name === 'marklayer_connect_room') {
        const parsed = ConnectInput.safeParse(rawArgs);
        if (!parsed.success) return fail(parsed.error);
        const id = parseRoomRef(parsed.data.room);
        if (room) room.close();
        room = new RoomClient(opts.apiBase, id, opts.agentId);
        await room.connect();
        return ok({ roomId: id, ...room.getMeta() });
      }

      const r = ensureRoom();
      const handled = await callRoomTool({ name, args: rawArgs, room: r, apiBase: opts.apiBase });
      return handled ?? err(`unknown tool: ${name}`);
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
