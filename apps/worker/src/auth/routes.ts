import { signInRequestSchema } from '@marklayer/types';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import { Hono } from 'hono/tiny';
import { sendEmail, signInTemplate } from '../email';
import { type AuthVariables, withUser } from './middleware';
import { authStore, ownedStore } from './store';
import { mintToken } from './tokens';
import { type AuthEnv, normalizeEmail, SESSION_COOKIE, SESSION_TTL_SECONDS, type User } from './types';

/** Where a redeemed link lands, and where a failed one lands with a reason to show. */
const APP_PATH = '/app';

function sessionCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    secure,
    // Lax, not Strict: the magic link is a cross-site top-level GET from a mail
    // client, and Strict would withhold the cookie we just set on that redirect.
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  } as const;
}

/** `session` is set only by the guard below, so a handler that reads it has one. */
type AuthApp = { Bindings: AuthEnv; Variables: AuthVariables & { session: User } };

export const auth = new Hono<AuthApp>();

auth.use('*', withUser);

auth.get('/me', (c) => c.json({ user: c.get('user') }));

auth.post('/request', async (c) => {
  const body = signInRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: 'An email address is required.' }, 400);
  const email = normalizeEmail(body.data.email);
  if (!email) return c.json({ error: 'That does not look like an email address.' }, 400);

  const store = authStore(c.env.DB);
  const wait = await store.throttleSeconds(email);
  if (wait > 0) return c.json({ error: `A link is already on its way. Try again in ${wait}s.` }, 429);

  const token = mintToken();
  await store.createLoginToken({ email, token });

  const link = `${new URL(c.req.url).origin}/auth/verify?token=${token}`;
  try {
    await sendEmail({ env: c.env, to: email, template: signInTemplate, data: { link } });
  } catch (err) {
    // The token row is already written and will expire on its own. Surface the
    // failure rather than claiming success: a person waiting on a mail that was
    // never sent has no way to tell that from a slow inbox.
    console.error('sign-in email failed', err);
    return c.json({ error: 'Could not send the email just now. Try again shortly.' }, 502);
  }
  return c.json({ ok: true }, 200);
});

auth.get('/verify', async (c) => {
  const token = c.req.query('token');
  if (!token) return c.redirect(`${APP_PATH}?error=missing`, 302);

  const store = authStore(c.env.DB);
  const email = await store.redeemLoginToken(token);
  if (!email) return c.redirect(`${APP_PATH}?error=expired`, 302);

  const user = await store.upsertUser(email);
  if (!user) return c.redirect(`${APP_PATH}?error=expired`, 302);
  const session = mintToken();
  await store.createSession({ userId: user.id, token: session });

  setCookie(c, SESSION_COOKIE, session, sessionCookieOptions(new URL(c.req.url).protocol === 'https:'));
  return c.redirect(APP_PATH, 302);
});

/**
 * Everything under `/links` needs a session. The guard is the mount rather than
 * a check per handler, so a route added here cannot ship unguarded — and it
 * hands on a non-null `session`, so the handlers have nothing left to re-narrow.
 */
const requireSession = createMiddleware<AuthApp>(async (c, next) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Sign in first.' }, 401);
  c.set('session', user);
  await next();
});

// Two mounts because Hono's `/links/*` does not match `/links` itself.
auth.use('/links', requireSession);
auth.use('/links/*', requireSession);

auth.get('/links', async (c) => {
  const links = await ownedStore(c.env.DB).listAnnotations(c.get('session').id);
  return c.json({ links }, 200);
});

auth.post('/links/:id', async (c) => {
  const ownerId = c.get('session').id;
  const claimed = await ownedStore(c.env.DB).claimAnnotation({ id: c.req.param('id'), ownerId });
  // Not an error worth a 4xx: the common cause is claiming a link you already
  // own, and the caller only needs to know whether anything changed.
  return c.json({ claimed }, 200);
});

auth.delete('/links/:id', async (c) => {
  const ownerId = c.get('session').id;
  const released = await ownedStore(c.env.DB).releaseAnnotation({ id: c.req.param('id'), ownerId });
  return c.json({ released }, 200);
});

auth.post('/logout', async (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) await authStore(c.env.DB).deleteSession(token);
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
  return c.json({ ok: true }, 200);
});
