import { agentPresence } from '@marklayer/types/agents';
import { agentTaskCommandSchema, ROOM_GEN_HEADER } from '@marklayer/types/wire';
import { setCookie } from 'hono/cookie';
import { csrf } from 'hono/csrf';
import { Hono } from 'hono/tiny';
import type { Env } from './env';
import { agentIdentityFrom, attemptPassword, openRoom, refuse, unlockCookie } from './lock/gate';
import { safeReturnPath, unlockPage } from './lock/page';
import { handleMcpRequest, readRoomPage } from './mcp';
import { overRateLimit } from './rate-limit';
import { annotationStore } from './store';

/**
 * Every route that reaches a room's content by id other than the share API and
 * the page shell: the agent surfaces, the realtime socket and the unlock form.
 * Each reader goes through `openRoom`, the one door, so none can forget the password,
 * the expiry or the existence check; the form is what answers that door's prompt.
 */
export const rooms = new Hono<Env>();

// csrf(): the form is ours, so a POST from elsewhere is someone planting their own unlock in the reader's browser.
rooms.post('/s/:id/unlock', csrf(), async (c) => {
  const id = c.req.param('id');
  const form = await c.req.parseBody().catch(() => null);
  const returnTo = safeReturnPath({ value: form?.return, roomId: id });
  const lock = await annotationStore(c.env.DB).getLock(id);
  if (!lock?.passwordHash) return c.redirect(returnTo, 303);

  const password = form?.password;
  if (typeof password !== 'string' || !password) return unlockPage({ roomId: id, returnTo, reason: 'locked' });

  const attempt = await attemptPassword({
    db: c.env.DB,
    roomId: id,
    record: lock.passwordHash,
    password,
    headers: c.req.raw.headers,
  });
  if (attempt !== 'ok') return unlockPage({ roomId: id, returnTo, reason: attempt });

  const cookie = await unlockCookie({
    roomId: id,
    gen: lock.passwordGen,
    record: lock.passwordHash,
    secure: new URL(c.req.url).protocol === 'https:',
  });
  setCookie(c, cookie.name, cookie.value, cookie.options);
  // 303 so a refresh does not resubmit the password.
  return c.redirect(returnTo, 303);
});

/**
 * The page an annotation room points at, read into an outline.
 *
 * Exists as its own route because the stdio server needs it too: fetching the
 * page has to happen here, behind the SSRF guard and the fixed-IP relay a
 * WAF-blocked host needs, not from wherever someone happens to run a CLI.
 */
rooms.get('/s/:id/page.json', async (c) => {
  if (await overRateLimit({ limiter: c.env.FETCH_LIMITER, req: c.req })) return c.text('Too many requests', 429);
  const room = await openRoom({ env: c.env, id: c.req.param('id'), headers: c.req.raw.headers, ctx: c.executionCtx });
  if (!room.ok) return refuse(room, 'json');
  const reading = await readRoomPage({ stub: room.stub, env: c.env });
  return reading ? c.json(reading) : c.json({ error: 'could not read the page' }, 502);
});

// Registry data is read-only over HTTP and uses the same room door as MCP.
rooms.get('/s/:id/semantics', async (c) => {
  if (await overRateLimit({ limiter: c.env.ROOM_LIMITER, req: c.req })) return c.text('Too many requests', 429);
  const room = await openRoom({ env: c.env, id: c.req.param('id'), headers: c.req.raw.headers, ctx: c.executionCtx });
  if (!room.ok) return refuse(room, 'json');
  const entries = await room.stub.queryUiSemantics();
  const id = c.req.query('id');
  return c.json({ semantics: id === undefined ? entries : entries.filter((entry) => entry.id === id) });
});

/**
 * Remote MCP endpoint for a room — the share link is the address, so connecting
 * an agent is one line and needs no package installed:
 *
 *   claude mcp add --transport http marklayer https://marklayer.app/s/<id>/mcp
 *
 * A protected room also takes `--header "Authorization: Bearer <password>"`.
 * Checked on every request: the transport is stateless, so a changed password
 * shuts an agent out on its next call. The 401 carries no `WWW-Authenticate`,
 * which would send MCP clients hunting for an OAuth server that does not exist.
 *
 * `?agent=` names the tool for the people watching the room. It defaults to
 * something generic rather than a brand, because guessing wrong would put
 * someone else's logo on Cursor's annotations.
 */
rooms.all('/s/:id/mcp', async (c) => {
  if (await overRateLimit({ limiter: c.env.ROOM_LIMITER, req: c.req })) return c.text('Too many requests', 429);
  const room = await openRoom({ env: c.env, id: c.req.param('id'), headers: c.req.raw.headers, ctx: c.executionCtx });
  if (!room.ok) return refuse(room, 'json');
  return handleMcpRequest({
    request: c.req.raw,
    stub: room.stub,
    roomId: room.id,
    apiBase: new URL(c.req.url).origin,
    agentId: agentIdentityFrom(c.req.query('agent')),
    env: c.env,
    ctx: c.executionCtx,
  });
});

rooms.post('/s/:id/agent-task', async (c) => {
  if (await overRateLimit({ limiter: c.env.ROOM_LIMITER, req: c.req })) return c.text('Too many requests', 429);
  const room = await openRoom({ env: c.env, id: c.req.param('id'), headers: c.req.raw.headers, ctx: c.executionCtx });
  if (!room.ok) return refuse(room, 'json');
  const command = agentTaskCommandSchema.safeParse(await c.req.json().catch(() => null));
  const session = c.req.query('session');
  if (!command.success || !session || session.length > 128) return c.json({ error: 'invalid task command' }, 400);
  const peer = agentPresence({ agentId: agentIdentityFrom(c.req.query('agent')), session });
  await room.stub.join(peer);
  return c.json(await room.stub.agentTaskCommand(peer.id, command.data));
});

rooms.get('/ws/:id', async (c) => {
  const id = c.req.param('id');
  if (c.req.header('Upgrade') !== 'websocket') return c.text('Expected WebSocket', 426);
  // Each open buys a fresh per-socket message budget in the room, so opens are the thing to cap.
  if (await overRateLimit({ limiter: c.env.ROOM_LIMITER, req: c.req })) return c.text('Too many requests', 429);
  const room = await openRoom({ env: c.env, id, headers: c.req.raw.headers, ctx: c.executionCtx });
  if (!room.ok) return refuse(room, 'socket');
  const url = new URL(c.req.url);
  url.searchParams.set('id', id);
  const headers = new Headers(c.req.raw.headers);
  // `set`, so a client that sends its own value is overwritten rather than believed.
  headers.set(ROOM_GEN_HEADER, String(room.gen));
  return room.stub.fetch(new Request(url.toString(), { method: 'GET', headers }));
});
