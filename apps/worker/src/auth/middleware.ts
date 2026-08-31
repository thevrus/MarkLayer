import { getCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import { authStore } from './store';
import { type AuthEnv, SESSION_COOKIE, type User } from './types';

export interface AuthVariables {
  user: User | null;
}

/**
 * Resolves the session cookie once per request. It sets `null` rather than
 * refusing the request, because most routes here are anonymous by design —
 * gating is each route's decision, not the middleware's.
 */
export const withUser = createMiddleware<{ Bindings: AuthEnv; Variables: AuthVariables }>(async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE);
  c.set('user', token ? await authStore(c.env.DB).userForSession(token) : null);
  await next();
});
