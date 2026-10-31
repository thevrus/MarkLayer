import { isNewShareId } from '@marklayer/types';
import { setCookie } from 'hono/cookie';
import { csrf } from 'hono/csrf';
import { Hono } from 'hono/tiny';
import { overRateLimit } from './http';
import type { Env } from './index';
import { attemptPassword, lockedJson, lockedSocket, ROOM_GEN_HEADER, roomAccess, unlockCookie } from './lock/gate';
import { safeReturnPath, unlockPage } from './lock/page';
import { handleMcpRequest, readRoomPage } from './mcp';
import { annotationStore, projectStore } from './store';

/**
 * Every route that reaches a room's content by id other than the share API and
 * the page shell: the agent surfaces, the realtime socket and the unlock form.
 * Kept out of index.ts so the gates run under test, which that module's
 * build-time imports do not allow.
 */
export const rooms = new Hono<Env>();

/** The one door to a room: the store refuses to *persist* a guessable id, but
 *  the DO would still let strangers meet live on one. `&&` spares a real id the query. */
async function getRoomStub({ id, env }: { id: string; env: Env['Bindings'] }) {
  if (!isNewShareId(id) && !(await annotationStore(env.DB).exists(id))) return null;
  return env.ANNOTATION_ROOM.get(env.ANNOTATION_ROOM.idFromName(id));
}

/**
 * Whether the OG card may describe room or project `id`. Read before the R2
 * cache, never after: a card rendered before the owner set a password is still
 * sitting there under the same key.
 */
export async function ogLocked({ db, id }: { db: D1Database; id: string }): Promise<boolean> {
  const lock = await annotationStore(db).getLock(id);
  if (lock) return lock.passwordHash !== null;
  const firstPageId = (await projectStore(db).get(id))?.pageIds[0];
  if (!firstPageId) return false;
  return (await annotationStore(db).getLock(firstPageId))?.passwordHash != null;
}

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
  const id = c.req.param('id');
  const stub = await getRoomStub({ id, env: c.env });
  if (!stub) return c.text('Share id too short', 400);
  const access = await roomAccess({ db: c.env.DB, id, headers: c.req.raw.headers });
  if (!access.open) return lockedJson(access);
  const reading = await readRoomPage({ stub, roomId: id, env: c.env });
  return reading ? c.json(reading) : c.json({ error: 'could not read the page' }, 502);
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
  const id = c.req.param('id');
  const stub = await getRoomStub({ id, env: c.env });
  if (!stub) return c.text('Share id too short', 400);
  const access = await roomAccess({ db: c.env.DB, id, headers: c.req.raw.headers });
  if (!access.open) return lockedJson(access);
  return handleMcpRequest({
    request: c.req.raw,
    stub,
    roomId: id,
    apiBase: new URL(c.req.url).origin,
    agentId: c.req.query('agent') ?? 'agent',
    env: c.env,
    ctx: c.executionCtx,
  });
});

// WebSocket endpoint for realtime collaboration
rooms.get('/ws/:id', async (c) => {
  const id = c.req.param('id');
  if (c.req.header('Upgrade') !== 'websocket') return c.text('Expected WebSocket', 426);
  // Each open buys a fresh per-socket message budget in the room, so opens are the thing to cap.
  if (await overRateLimit({ limiter: c.env.ROOM_LIMITER, req: c.req })) return c.text('Too many requests', 429);
  const room = await getRoomStub({ id, env: c.env });
  if (!room) return c.text('Share id too short', 400);
  const access = await roomAccess({ db: c.env.DB, id, headers: c.req.raw.headers });
  if (!access.open) return lockedSocket();
  const url = new URL(c.req.url);
  url.searchParams.set('id', id);
  const headers = new Headers(c.req.raw.headers);
  // `set`, so a client that sends its own value is overwritten rather than believed.
  headers.set(ROOM_GEN_HEADER, String(access.gen));
  return room.fetch(new Request(url.toString(), { method: 'GET', headers }));
});
