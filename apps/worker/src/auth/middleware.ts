import { createMiddleware } from 'hono/factory';
import { userFromCookieHeader } from './session';
import type { AuthEnv, User } from './types';

export interface AuthVariables {
  user: User | null;
}

/**
 * Resolves the session cookie once per request. It sets `null` rather than
 * refusing the request, because most routes here are anonymous by design —
 * gating is each route's decision, not the middleware's.
 */
export const withUser = createMiddleware<{ Bindings: AuthEnv; Variables: AuthVariables }>(async (c, next) => {
  c.set('user', await userFromCookieHeader({ header: c.req.header('cookie') ?? null, db: c.env.DB }));
  await next();
});
