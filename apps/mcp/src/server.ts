import {
  ConnectInput,
  callTool,
  err,
  fail,
  instructionsFor,
  MCP_SERVER_VERSION,
  ok,
  type PreviewCreated,
  type PreviewRequest,
  parseRoomRef,
  previewCreatedSchema,
  type ToolContent,
  toolsFor,
} from '@marklayer/agent-tools';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { nanoid } from 'nanoid';
import { z } from 'zod/mini';
import { type ConnectedRoom, connectRoom } from './room.js';

interface ServerOptions {
  apiBase: string;
  initialRoom: string | null;
  agentId: string;
  /** For a password-protected room. */
  password: string | null;
}

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function startServer(opts: ServerOptions): Promise<void> {
  const server = new Server(
    { name: 'marklayer-mcp', version: MCP_SERVER_VERSION },
    { capabilities: { tools: {} }, instructions: instructionsFor('stdio') },
  );

  let connected: ConnectedRoom | null = null;

  // The connected room's password; a new version of a protected room inherits it.
  let roomPassword = opts.password;

  const open = (roomId: string) =>
    connectRoom({ apiBase: opts.apiBase, roomId, agentId: opts.agentId, password: roomPassword });

  /** Open a preview room through the share API, then connect to it so the next tool works the new room. */
  const createPreview = async (request: PreviewRequest): Promise<PreviewCreated | { error: string }> => {
    let previous: string | undefined;
    try {
      previous = request.previous ? parseRoomRef(request.previous) : connected?.room.roomId;
    } catch (e) {
      return { error: messageOf(e) };
    }
    const created = await postPreview({
      apiBase: opts.apiBase,
      request: { ...request, previous },
      agentId: opts.agentId,
      password: roomPassword,
    });
    if ('error' in created) return created;
    const next = await open(created.id);
    connected?.close();
    connected = next;
    return created;
  };

  if (opts.initialRoom) {
    try {
      connected = await open(parseRoomRef(opts.initialRoom));
    } catch (e) {
      console.error(`marklayer-mcp: failed to connect to initial room: ${messageOf(e)}`);
    }
  }

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: toolsFor('stdio') }));

  server.setRequestHandler(CallToolRequestSchema, async (req): Promise<ToolContent> => {
    const name = req.params.name;
    const rawArgs = req.params.arguments ?? {};
    try {
      // The one tool that exists only here: over HTTP the URL names the room.
      if (name === 'marklayer_connect_room') {
        const parsed = ConnectInput.safeParse(rawArgs);
        if (!parsed.success) return fail(parsed.error);
        const id = parseRoomRef(parsed.data.room);
        connected?.close();
        connected = null;
        // An explicit password wins; otherwise the startup one, which another room simply refuses.
        roomPassword = parsed.data.password ?? opts.password;
        connected = await open(id);
        return ok({ roomId: id, ...connected.room.getMeta() });
      }

      const room = connected?.room ?? null;
      const handled = await callTool({ name, args: rawArgs, room, apiBase: opts.apiBase, createPreview });
      return handled ?? err(`unknown tool: ${name}`);
    } catch (e) {
      return err(messageOf(e));
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  const cleanup = () => {
    connected?.close();
    connected = null;
    process.exit(0);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

/** `POST /api/:id/preview` with a fresh id. The Worker validates the request again and owns the version chain. */
async function postPreview({
  apiBase,
  request,
  agentId,
  password,
}: {
  apiBase: string;
  request: PreviewRequest;
  agentId: string;
  /** Proves access to a protected `previous` room. */
  password: string | null;
}): Promise<PreviewCreated | { error: string }> {
  const id = nanoid();
  const res = await fetch(`${apiBase}/api/${id}/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(password ? { Authorization: `Bearer ${password}` } : {}) },
    body: JSON.stringify({ ...request, agent: agentId }),
  }).catch((e: unknown) => (e instanceof Error ? e : new Error(String(e))));
  if (res instanceof Error) return { error: `could not reach ${apiBase}: ${res.message}` };
  const body: unknown = await res.json().catch(() => null);
  const parsed = previewCreatedSchema.safeParse(body);
  if (res.ok && parsed.success) return parsed.data;
  const reason = ErrorBody.safeParse(body);
  return { error: reason.success ? reason.data.error : `share API answered ${res.status}` };
}

const ErrorBody = z.object({ error: z.string() });
