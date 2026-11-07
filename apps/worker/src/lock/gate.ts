import { isNewShareId } from '@marklayer/brand/links';
import { ROOM_PASSWORD_HEADER } from '@marklayer/types/wire';
import { parse as parseCookieHeader } from 'hono/utils/cookie';
import { effectiveExpiresAt, type SessionUser } from '../../shared/accounts';
import { userFromCookieHeader } from '../auth/session';
import { sha256Hex } from '../encoding';
import type { WaitUntil } from '../env';
import { sanitizeName } from '../peers';
import type { RoomNamespace, RoomStub } from '../room-stub';
import { removeRooms } from '../rooms-lifecycle';
import { annotationStore, projectStore, type RoomLock } from '../store';
import { isExpired, nowInSeconds } from '../time';
import { FAILURE_WINDOW_SECONDS, MAX_FAILURES, unlockFailureStore } from './failures';
import { gonePage, unlockPage } from './page';
import { signUnlock, UNLOCK_TTL_SECONDS, unlockCookieName, verifyPassword, verifyUnlock } from './password';
import { asksForPassword, type LockRefusal, REFUSALS, type RoomRefusal } from './refusals';
import { refusedSocket } from './refused-socket';

export type RoomAccess = { open: true; gen: number; guarded: boolean } | { open: false; reason: LockRefusal };

export type Attempt = 'ok' | 'wrong' | 'throttled';

/** What the room's door needs from the request and the bindings. */
export interface DoorEnv {
  DB: D1Database;
  ANNOTATION_ROOM: RoomNamespace;
  OG_BUCKET?: R2Bucket;
}

/**
 * The one door to a room. `exists` is false for an id strong enough to mint a
 * room at that has no row yet: the room comes into being on its first write, so
 * a socket, an agent or a REST save may go in. A weak id with no row is `gone`.
 */
export type OpenRoom =
  | {
      ok: true;
      id: string;
      stub: RoomStub;
      gen: number;
      /** A password was checked, by cookie, session or header: what is behind the door must not leak into caches. */
      guarded: boolean;
      exists: boolean;
    }
  | { ok: false; id: string; reason: RoomRefusal };

/** `Authorization: Bearer <password>` for MCP clients, the custom header for anything that cannot set one. */
function presentedPassword(headers: Headers): string | null {
  const auth = headers.get('Authorization');
  if (auth?.startsWith('Bearer ')) {
    const value = auth.slice('Bearer '.length).trim();
    if (value) return value;
  }
  return headers.get(ROOM_PASSWORD_HEADER) || null;
}

/** A digest, so the failure table never holds an address. */
function clientKey(headers: Headers): Promise<string> {
  return sha256Hex(headers.get('cf-connecting-ip') ?? 'unknown');
}

/**
 * One guess. The throttle is read before the derivation runs, so a client over
 * the limit learns nothing even by guessing right; only a wrong guess counts.
 */
export async function attemptPassword({
  db,
  roomId,
  record,
  password,
  headers,
}: {
  db: D1Database;
  roomId: string;
  record: string;
  password: string;
  headers: Headers;
}): Promise<Attempt> {
  const failures = unlockFailureStore(db);
  const client = await clientKey(headers);
  const now = nowInSeconds();
  const since = now - FAILURE_WINDOW_SECONDS;
  if ((await failures.count({ roomId, client, since })) >= MAX_FAILURES) return 'throttled';
  if (await verifyPassword({ password, record })) return 'ok';
  await failures.record({ roomId, client, now, since });
  return 'wrong';
}

/**
 * The rule every reader of a room's content asks, in cheapest-first order: an
 * open link, a valid unlock cookie, the owner's own session, then a presented
 * password. `user` is lazy and shared so a project gate resolves the session once.
 * `tryPassword` is off for a project's pages: each has its own, and one header
 * cannot answer several prompts.
 */
async function decide({
  db,
  id,
  lock,
  headers,
  user,
  tryPassword,
}: {
  db: D1Database;
  id: string;
  lock: RoomLock;
  headers: Headers;
  user: () => Promise<SessionUser | null>;
  tryPassword: boolean;
}): Promise<RoomAccess> {
  const record = lock.passwordHash;
  if (!record) return { open: true, gen: lock.passwordGen, guarded: false };

  const cookie = parseCookieHeader(headers.get('Cookie') ?? '', unlockCookieName(id))[unlockCookieName(id)];
  if (
    cookie &&
    (await verifyUnlock({ token: cookie, roomId: id, gen: lock.passwordGen, record, now: nowInSeconds() }))
  ) {
    return { open: true, gen: lock.passwordGen, guarded: true };
  }

  if (lock.ownerId !== null && (await user())?.id === lock.ownerId)
    return { open: true, gen: lock.passwordGen, guarded: true };

  const password = tryPassword ? presentedPassword(headers) : null;
  if (!password) return { open: false, reason: 'locked' };
  const attempt = await attemptPassword({ db, roomId: id, record, password, headers });
  return attempt === 'ok' ? { open: true, gen: lock.passwordGen, guarded: true } : { open: false, reason: attempt };
}

function lazyUser({ db, headers }: { db: D1Database; headers: Headers }): () => Promise<SessionUser | null> {
  let pending: Promise<SessionUser | null> | null = null;
  return () => {
    pending ??= userFromCookieHeader({ header: headers.get('Cookie'), db });
    return pending;
  };
}

/**
 * Existence, expiry and password, in that order, for every route that reaches a
 * room by id. An expired room is refused the moment it expires, not at the next
 * sweep, and the row goes with it (off the response path when `ctx` is given).
 */
export async function openRoom({
  env,
  id,
  headers,
  ctx,
}: {
  env: DoorEnv;
  id: string;
  headers: Headers;
  ctx?: WaitUntil;
}): Promise<OpenRoom> {
  const db = env.DB;
  const stub = () => env.ANNOTATION_ROOM.get(env.ANNOTATION_ROOM.idFromName(id));
  const door = await annotationStore(db).getDoor(id);
  if (!door) {
    return isNewShareId(id)
      ? { ok: true, id, stub: stub(), gen: 0, guarded: false, exists: false }
      : { ok: false, id, reason: 'gone' };
  }
  if (isExpired(effectiveExpiresAt(door))) {
    // Swallowed: the refusal stands whether or not the sweep ran; the cron catches what this misses.
    const sweep = removeRooms({ env, ids: [id] }).catch(() => undefined);
    if (ctx) ctx.waitUntil(sweep);
    return { ok: false, id, reason: 'expired' };
  }
  const access = await decide({ db, id, lock: door, headers, user: lazyUser({ db, headers }), tryPassword: true });
  if (!access.open) return { ok: false, id, reason: access.reason };
  return { ok: true, id, stub: stub(), gen: access.gen, guarded: access.guarded, exists: true };
}

/** The password half alone: what a route that is not reading the room (chaining a preview onto it) asks. */
export async function roomAccess({
  db,
  id,
  headers,
}: {
  db: D1Database;
  id: string;
  headers: Headers;
}): Promise<RoomAccess> {
  const lock = await annotationStore(db).getLock(id);
  if (!lock) return { open: true, gen: 0, guarded: false };
  return decide({ db, id, lock, headers, user: lazyUser({ db, headers }), tryPassword: true });
}

/** Which of a project's pages this request may not see, in page order. */
export async function lockedPages({
  db,
  pageIds,
  headers,
}: {
  db: D1Database;
  pageIds: string[];
  headers: Headers;
}): Promise<string[]> {
  const locks = await annotationStore(db).getLocks(pageIds);
  if (locks.size === 0) return [];
  const user = lazyUser({ db, headers });
  const locked: string[] = [];
  for (const id of pageIds) {
    const lock = locks.get(id);
    if (lock && !(await decide({ db, id, lock, headers, user, tryPassword: false })).open) locked.push(id);
  }
  return locked;
}

/**
 * One refusal, rendered for whoever asked: JSON for the API and agents, an
 * accepted-then-closed socket, and the unlock form or a dead-end page for a browser.
 */
export function refuse(
  result: Extract<OpenRoom, { ok: false }>,
  as: 'json' | 'socket' | 'page',
  opts: { returnTo?: string } = {},
): Response {
  const { reason, id } = result;
  const row = REFUSALS[reason];
  switch (as) {
    case 'json':
      return Response.json({ error: row.error }, { status: row.status });
    case 'socket':
      return refusedSocket({ code: row.close, reason: reason === 'locked' ? 'password required' : row.error });
    case 'page':
      return asksForPassword(reason)
        ? unlockPage({ roomId: id, returnTo: opts.returnTo ?? `/s/${id}`, reason })
        : gonePage(reason);
  }
}

/** The JSON half of a refusal, for a typed route that builds its own response. */
export function refusalBody(result: Extract<OpenRoom, { ok: false }>): {
  status: (typeof REFUSALS)[RoomRefusal]['status'];
  error: string;
} {
  const row = REFUSALS[result.reason];
  return { status: row.status, error: row.error };
}

/**
 * The page a share card for `id` may describe: the room itself or a project's first
 * page. Null for the generic card: nothing there, past its deadline, or protected, which
 * for a project is any page. Asked before the R2 cache, never after, since a card rendered
 * before the owner set a password still sits under the same key. Never reads the request:
 * a card is one image for every viewer, so an unlock cannot earn a better one.
 */
export async function ogSubject({ db, id }: { db: D1Database; id: string }): Promise<string | null> {
  const annotations = annotationStore(db);
  const door = await annotations.getDoor(id);
  if (door) return door.passwordHash === null && !isExpired(effectiveExpiresAt(door)) ? id : null;
  const project = await projectStore(db).get(id);
  const firstPageId = project?.pageIds[0];
  if (!project || !firstPageId || isExpired(project.expiresAt)) return null;
  if ((await annotations.getLocks(project.pageIds)).size > 0) return null;
  const first = await annotations.getDoor(firstPageId);
  return first && !isExpired(effectiveExpiresAt(first)) ? firstPageId : null;
}

/** The cookie a correct password earns, ready for Hono's `setCookie`. */
export async function unlockCookie({
  roomId,
  gen,
  record,
  secure,
}: {
  roomId: string;
  gen: number;
  record: string;
  secure: boolean;
}) {
  const value = await signUnlock({ roomId, gen, record, expiresAt: nowInSeconds() + UNLOCK_TTL_SECONDS });
  return {
    name: unlockCookieName(roomId),
    value,
    options: { httpOnly: true, secure, sameSite: 'Lax', path: '/', maxAge: UNLOCK_TTL_SECONDS } as const,
  };
}

/**
 * Who an agent says it is, from `?agent=` on the MCP endpoint or the `agent`
 * field of a preview request. One rule for every entry point: trimmed and
 * clamped like a socket peer's name, so what the room announces is what it stores.
 */
export function agentIdentityFrom(value: unknown): string {
  return sanitizeName(value, 'agent');
}
