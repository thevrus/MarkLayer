import {
  inviteRequestSchema,
  resolveOwnerExpiresAt,
  signInRequestSchema,
  updateLinkSettingsSchema,
} from '@marklayer/types';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import { Hono } from 'hono/tiny';
import { inviteTemplate, sendEmail, signInTemplate } from '../email';
import { captureServer } from '../posthog';
import { inviteStore, nowInSeconds } from '../store';
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

/**
 * Tells a warm room to re-read its access row. A room caches `access` from its
 * first load, so without this an owner's change bites only after the next
 * eviction — and the owner's own tab keeps the room resident. Off the response
 * path: the row is already written, so a lost ping only leaves the room stale.
 */
function pingRoomRefreshAccess({
  env,
  ctx,
  id,
}: {
  env: AuthEnv;
  // Just `waitUntil`, so both Hono's `ExecutionContext<unknown>` and a test double fit.
  ctx: { waitUntil(promise: Promise<unknown>): void };
  id: string;
}): void {
  const room = env.ANNOTATION_ROOM.get(env.ANNOTATION_ROOM.idFromName(id));
  ctx.waitUntil(
    room
      .fetch(new Request(`https://room/refresh-access?id=${encodeURIComponent(id)}`, { method: 'POST' }))
      .catch(() => undefined),
  );
}

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
  captureServer(c.env, c.executionCtx, 'sign_in_requested', {});
  return c.json({ ok: true }, 200);
});

/**
 * Sends the current share link to an address, unauthenticated — inviting is
 * just "forward this link", the same thing Copy already lets anyone do, so it
 * asks for nothing an anonymous viewer wouldn't already have. `url` comes from
 * the client rather than being rebuilt here; see the origin check below for
 * why it still isn't trusted blindly.
 */
auth.post('/links/:id/invite', async (c) => {
  const body = inviteRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: 'An email address is required.' }, 400);
  const email = normalizeEmail(body.data.email);
  if (!email) return c.json({ error: 'That does not look like an email address.' }, 400);

  // `z.url()` on the schema already proved this parses; the one thing left to
  // check is what Zod cannot know statically — that it resolves to this same
  // request's origin, not somewhere a mail from our domain could be used to
  // relay a phishing link.
  const link = new URL(body.data.url);
  if (link.origin !== new URL(c.req.url).origin) return c.json({ error: 'That link looks invalid.' }, 400);

  const linkId = c.req.param('id');
  const store = inviteStore(c.env.DB);
  const wait = await store.throttleSeconds({ linkId, email });
  if (wait > 0) return c.json({ error: `An invite was just sent. Try again in ${wait}s.` }, 429);

  try {
    await sendEmail({ env: c.env, to: email, template: inviteTemplate, data: { link: link.toString() } });
  } catch (err) {
    console.error('invite email failed', err);
    return c.json({ error: 'Could not send the invite just now. Try again shortly.' }, 502);
  }
  await store.record({ linkId, email });
  captureServer(c.env, c.executionCtx, 'invite_sent', {});
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
  captureServer(c.env, c.executionCtx, 'sign_in_verified', {});
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
  // Only the state change is worth a counter — a re-claim of a link already
  // owned is a no-op, not a new save.
  if (claimed) captureServer(c.env, c.executionCtx, 'link_claimed', {});
  // Not an error worth a 4xx: the common cause is claiming a link you already
  // own, and the caller only needs to know whether anything changed.
  return c.json({ claimed }, 200);
});

auth.delete('/links/:id', async (c) => {
  const ownerId = c.get('session').id;
  const id = c.req.param('id');
  const released = await ownedStore(c.env.DB).releaseAnnotation({ id, ownerId });
  // Release reopened editing to everyone, which a warm room would not notice.
  if (released) pingRoomRefreshAccess({ env: c.env, ctx: c.executionCtx, id });
  return c.json({ released }, 200);
});

auth.patch('/links/:id', async (c) => {
  const body = updateLinkSettingsSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: 'Invalid link settings.' }, 400);

  const ownerId = c.get('session').id;
  const id = c.req.param('id');
  const store = ownedStore(c.env.DB);
  const current = await store.getSettings({ id, ownerId });
  // Same silent no-op convention as releaseAnnotation: the common cause is a
  // non-owner poking at an id they don't hold, not worth a 403.
  if (!current) return c.json({ updated: false }, 200);

  const access = body.data.access ?? current.access;
  const ownerExpiresAt = resolveOwnerExpiresAt({
    ownerExpiresIn: body.data.ownerExpiresIn,
    current: current.ownerExpiresAt,
    now: nowInSeconds(),
  });

  const updated = await store.updateSettings({ id, ownerId, access, ownerExpiresAt });
  if (updated) {
    pingRoomRefreshAccess({ env: c.env, ctx: c.executionCtx, id });
    captureServer(c.env, c.executionCtx, 'link_settings_updated', { access });
  }
  return c.json({ updated }, 200);
});

auth.post('/logout', async (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) await authStore(c.env.DB).deleteSession(token);
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
  return c.json({ ok: true }, 200);
});
