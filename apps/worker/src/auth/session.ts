import { parse as parseCookieHeader } from 'hono/utils/cookie';
import { authStore } from './store';
import { SESSION_COOKIE, type User } from './types';

/**
 * Resolves the signed-in user from a raw `Cookie` header, or null if absent,
 * unrecognized, or expired.
 *
 * Takes the header string rather than a Hono `Context` or a `Request`: the
 * three callers each hold a different shape (`withUser` has a `Context`,
 * the Durable Object only a raw `Request`, and the share API's inline
 * view-only check used to just reimplement this against its own `Context`),
 * and the header string is the one thing all three can produce.
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
