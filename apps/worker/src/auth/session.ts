import { parse as parseCookieHeader } from 'hono/utils/cookie';
import { authStore } from './store';
import { SESSION_COOKIE, type User } from './types';

/**
 * Resolves the signed-in user from a raw `Cookie` header, or null if absent,
 * unrecognized, or expired.
 *
 * Takes the header string rather than a Hono `Context` or a `Request`: the
 * callers hold different shapes (`withUser` a `Context`, the Durable Object
 * only a raw `Request`), and the header is the one thing all can produce.
 */
export async function userFromCookieHeader({
  header,
  db,
}: {
  header: string | null;
  db: D1Database;
}): Promise<User | null> {
  if (!header) return null;
  const token = parseCookieHeader(header, SESSION_COOKIE)[SESSION_COOKIE];
  return token ? authStore(db).userForSession(token) : null;
}
