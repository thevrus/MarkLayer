import {
  callTool,
  flagOn,
  instructionsFor,
  MCP_SERVER_VERSION,
  type PageReading,
  RoomCore,
  type RoomTransport,
  readOnlyReason,
  type ToolContent,
  type ToolSpec,
  toolsFor,
} from '@marklayer/agent-tools';
import { agentPresence } from '@marklayer/types/agents';
import { McpServer, WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/server';
import { nanoid } from 'nanoid';
import { z } from 'zod/mini';
import type { Env, WaitUntil } from './env';
import { outlinePage } from './page-outline';
import { captureServer } from './posthog';
import { createPreviewRoom } from './preview';
import { fetchPage, type RelaySettings } from './proxy';
import type { RoomStub } from './room-stub';

/**
 * Read a page through the proxy's own path, so it inherits the SSRF guard and the
 * fixed-IP relay a WAF-blocked host needs: why this is not a fetch from wherever an agent runs.
 */
async function readPage({ url, env }: { url: string; env: RelaySettings }): Promise<PageReading | null> {
  const page = await fetchPage({ url, env });
  if (!page.stream || page.status >= 400 || !page.contentType.includes('html')) return null;
  return outlinePage({ html: await new Response(page.stream).text(), url: page.finalUrl });
}

/** The page a room annotates, for a caller that has not loaded the room. */
export async function readRoomPage({ stub, env }: { stub: RoomStub; env: RelaySettings }): Promise<PageReading | null> {
  const { url } = await stub.snapshot();
  return url ? readPage({ url, env }) : null;
}

/**
 * A room reached by RPC instead of a socket. Nothing is held between calls: the Durable
 * Object keeps the state, so a request loads it into a core, acts, and goes away.
 */
async function loadRoom({
  stub,
  roomId,
  agentId,
  session,
  env,
  readOnly,
}: {
  stub: RoomStub;
  roomId: string;
  agentId: string;
  session: string;
  env: RelaySettings;
  readOnly: boolean;
}): Promise<RoomCore> {
  const peer = agentPresence({ agentId, session });
  const { missed, ...snapshot } = await stub.join(peer);
  let cursor = snapshot.cursor;
  const transport: RoomTransport = {
    send: (msg) => stub.send(msg),
    // The room parks the wait, so each pass of the core's watch loop is one call rather than a poll.
    wait: async (ms) => {
      const result = await stub.watch({ timeoutMs: ms, since: cursor, peerId: peer.id });
      cursor = result.cursor;
      return result.messages;
    },
    readPage: async (url) => (url ? readPage({ url, env }) : null),
  };
  const room = new RoomCore({ roomId, agentId, session, transport, newId: nanoid, readOnlyByChoice: readOnly });
  room.apply({ type: 'init', ...snapshot });
  room.catchUp(missed);
  return room;
}

/**
 * Advertise a tool's arguments to MCP without validating them twice.
 *
 * SDK v2 takes a Standard Schema that both validates a call and describes itself for
 * `tools/list`. Only the describing half is wanted: `callTool` already validates, against
 * the Zod inputs that own the error text an agent reads. (Zod cannot fill this slot:
 * only the full package carries `~standard.jsonSchema`, and this repo ships `zod/mini`.)
 */
function describedSchema(json: ToolSpec['inputSchema']) {
  const convert = () => json;
  return {
    '~standard': {
      version: 1 as const,
      vendor: 'marklayer',
      validate: (value: unknown) => ({ value }),
      // A Converter, not a function: the SDK asks input and output separately.
      jsonSchema: { input: convert, output: convert },
    },
  };
}

/**
 * Build the MCP server for one request. Stateless on purpose: the SDK object is
 * cheap, and the session it would otherwise hold lives in the Durable Object.
 */
function buildServer({
  room,
  apiBase,
  createPreview,
  onToolCall,
}: {
  room: RoomCore;
  apiBase: string;
  createPreview: Parameters<typeof callTool>[0]['createPreview'];
  onToolCall: (call: { tool: string; ok: boolean; duration_ms: number }) => void;
}): McpServer {
  const server = new McpServer(
    { name: 'marklayer', version: MCP_SERVER_VERSION },
    // Built per request after the room loads, so the read-only line reflects the link as it is now.
    { instructions: instructionsFor({ transport: 'http', readOnly: readOnlyReason(room) }) },
  );
  for (const tool of toolsFor('http')) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: describedSchema(tool.inputSchema), annotations: tool.annotations },
      async (args: unknown): Promise<ToolContent> => {
        const started = Date.now();
        let answered: ToolContent | null = null;
        try {
          answered = await callTool({ name: tool.name, args, room, apiBase, createPreview });
        } finally {
          onToolCall({
            tool: tool.name,
            ok: answered !== null && !answered.isError,
            duration_ms: Date.now() - started,
          });
        }
        return answered ?? { content: [{ type: 'text', text: `unknown tool: ${tool.name}` }], isError: true };
      },
    );
  }
  return server;
}

/** What a client that never initialized shares: one presence entry, not a new peer on every call. */
const NO_SESSION = 'http';
/** Echoed into a peer id everyone in the room receives, so only the shape minted below is taken back. */
const SESSION_ID = /^[\w-]{1,64}$/;
const initializeRequest = z.object({ method: z.literal('initialize') });

/**
 * The SDK stays stateless (a transport per request cannot validate a session), so a session
 * here is only a name: minted on `initialize`, as the spec lets a server do, and sent back
 * by the client on every later request. Without this no HTTP client would ever have one.
 */
async function mcpSession(request: Request): Promise<{ session: string; minted: boolean }> {
  const sent = request.headers.get('mcp-session-id');
  if (sent && SESSION_ID.test(sent)) return { session: sent, minted: false };
  const body: unknown =
    request.method === 'POST'
      ? await request
          .clone()
          .json()
          .catch(() => null)
      : null;
  return initializeRequest.safeParse(body).success
    ? { session: nanoid(), minted: true }
    : { session: NO_SESSION, minted: false };
}

export async function handleMcpRequest({
  request,
  stub,
  roomId,
  apiBase,
  agentId,
  env,
  ctx,
}: {
  request: Request;
  stub: RoomStub;
  roomId: string;
  apiBase: string;
  agentId: string;
  env: RelaySettings & Pick<Env['Bindings'], 'DB' | 'POSTHOG_KEY' | 'POSTHOG_HOST'>;
  ctx: WaitUntil;
}): Promise<Response> {
  const { session, minted } = await mcpSession(request);
  // `?readonly=1` narrows an editable link for one agent; the room's own view-only check runs regardless.
  const readOnly = flagOn(new URL(request.url).searchParams.get('readonly'));
  const room = await loadRoom({ stub, roomId, agentId, session, env, readOnly });
  const server = buildServer({
    room,
    apiBase,
    // The endpoint stays bound to this room, so a new preview is opened beside it
    // and chained to it when repo and branch match.
    createPreview: (req) =>
      createPreviewRoom({
        db: env.DB,
        request: req,
        agentId,
        origin: apiBase,
        headers: request.headers,
        fallbackPrevious: roomId,
      }),
    // Name, outcome and time only: arguments and results carry room ids, page URLs and comment text.
    onToolCall: (call) => captureServer(env, ctx, 'mcp_tool_called', call),
  });
  // Each request is self-contained, which is what lets this run on a Worker with nothing held between calls.
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  const response = await transport.handleRequest(request);
  if (!minted) return response;
  const named = new Response(response.body, response);
  named.headers.set('Mcp-Session-Id', session);
  return named;
}
