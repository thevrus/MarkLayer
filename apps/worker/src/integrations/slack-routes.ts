import type { Context } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { Hono } from 'hono/tiny';
import { nanoid } from 'nanoid';
import { canEditLink } from '../../shared/accounts';
import { userFromCookieHeader } from '../auth';
import type { Env } from '../env';
import { roomAccess } from '../lock/gate';
import { annotationStore } from '../store';
import { authorizeUrl, exchangeCode, joinChannel } from './slack-api';
import { slackConfig } from './slack-config';
import { encryptToken, signInstallState, verifyInstallState, verifySlackSignature } from './slack-crypto';
import { inboundReply, uninstalledTeam } from './slack-events';
import { slackStore } from './slack-store';
import { applyInboundReply } from './slack-sync';

/**
 * The Slack app's HTTP surface, mounted at `/integrations/slack`. Every route
 * answers 404 while any of its four secrets is unset, so a deploy without them
 * looks exactly like one without the feature.
 */
export const slackRoutes = new Hono<Env>();

const NONCE_COOKIE = 'ml_slack_nonce';
const COOKIE_PATH = '/integrations/slack';

const redirectUri = (c: Context<Env>) => `${new URL(c.req.url).origin}${COOKIE_PATH}/callback`;

/**
 * Who may connect or disconnect a room's Slack: anyone who may edit it, which
 * on a view-only link means its owner. The same rule the room's own gate uses.
 */
async function editor({ c, roomId }: { c: Context<Env>; roomId: string }) {
  const access = await annotationStore(c.env.DB).getMeta(roomId);
  if (!access) return { ok: false, status: 404 } as const;
  if (!(await roomAccess({ db: c.env.DB, id: roomId, headers: c.req.raw.headers })).open) {
    return { ok: false, status: 401 } as const;
  }
  const user = await userFromCookieHeader({ header: c.req.header('cookie') ?? null, db: c.env.DB });
  if (!canEditLink({ ...access, userId: user?.id })) return { ok: false, status: 403 } as const;
  return { ok: true, userId: user?.id ?? null } as const;
}

/** What the settings panel shows. Never the token, and nothing at all about a locked room's workspace. */
slackRoutes.get('/status', async (c) => {
  const roomId = c.req.query('room');
  if (!slackConfig(c.env) || !roomId) return c.json({ enabled: false, connection: null });
  if (!(await roomAccess({ db: c.env.DB, id: roomId, headers: c.req.raw.headers })).open) {
    return c.json({ enabled: true, connection: null });
  }
  const install = await slackStore(c.env.DB).install(roomId);
  return c.json({
    enabled: true,
    connection: install ? { team: install.teamName, channel: install.channelName } : null,
  });
});

slackRoutes.get('/install', async (c) => {
  const config = slackConfig(c.env);
  const roomId = c.req.query('room');
  if (!config) return c.notFound();
  if (!roomId) return c.text('Missing room', 400);
  const who = await editor({ c, roomId });
  if (!who.ok) return c.text(who.status === 404 ? 'No such room' : 'Only the owner can connect Slack here', who.status);

  const nonce = nanoid();
  const state = await signInstallState({ secret: config.clientSecret, state: { roomId, userId: who.userId, nonce } });
  setCookie(c, NONCE_COOKIE, nonce, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === 'https:',
    // Lax: the callback is a top-level navigation back from slack.com.
    sameSite: 'Lax',
    path: COOKIE_PATH,
    maxAge: 10 * 60,
  });
  return c.redirect(authorizeUrl({ config, redirectUri: redirectUri(c), state }));
});

/** A failure the installer can read, on the page they landed on. */
const failed = (c: Context<Env>, reason: string) =>
  c.text(`Slack was not connected: ${reason}. Close this tab and try again from the room's settings.`, 400);

slackRoutes.get('/callback', async (c) => {
  const config = slackConfig(c.env);
  if (!config) return c.notFound();
  const state = await verifyInstallState({ secret: config.clientSecret, value: c.req.query('state') ?? null });
  // Bound to this browser and to whoever started it: a state replayed elsewhere, or after a sign-out, stops here.
  if (!state || getCookie(c, NONCE_COOKIE) !== state.nonce)
    return failed(c, 'the request expired or was not started here');
  const who = await editor({ c, roomId: state.roomId });
  if (!who.ok || who.userId !== state.userId) return failed(c, 'you no longer have access to this room');
  if (c.req.query('error')) return failed(c, 'the install was cancelled');
  const code = c.req.query('code');
  if (!code) return failed(c, 'Slack sent no authorization code');

  const access = await exchangeCode({ config, code, redirectUri: redirectUri(c) });
  if (!access.ok) return failed(c, `Slack refused the install (${access.error})`);

  await slackStore(c.env.DB).saveInstall({
    install: {
      roomId: state.roomId,
      teamId: access.team.id,
      teamName: access.team.name ?? null,
      channelId: access.incoming_webhook.channel_id,
      channelName: access.incoming_webhook.channel ?? null,
      botUserId: access.bot_user_id,
      sealedToken: await encryptToken({ secret: config.tokenKey, token: access.access_token, roomId: state.roomId }),
    },
    installedBy: who.userId,
  });
  c.executionCtx.waitUntil(joinChannel({ token: access.access_token, channel: access.incoming_webhook.channel_id }));
  setCookie(c, NONCE_COOKIE, '', { path: COOKIE_PATH, maxAge: 0 });
  return c.redirect(`/s/${encodeURIComponent(state.roomId)}`);
});

slackRoutes.delete('/', async (c) => {
  if (!slackConfig(c.env)) return c.notFound();
  const roomId = c.req.query('room');
  if (!roomId) return c.text('Missing room', 400);
  const who = await editor({ c, roomId });
  if (!who.ok) return c.json({ error: 'not allowed' }, who.status);
  await slackStore(c.env.DB).removeRoom(roomId);
  return c.json({ enabled: true, connection: null });
});

/**
 * The Events API endpoint. Signature first, before the body is even parsed;
 * then a 200 straight away with the work in `waitUntil`, because Slack retries
 * anything slower than three seconds and a retry would be a second delivery.
 */
slackRoutes.post('/events', async (c) => {
  const config = slackConfig(c.env);
  if (!config) return c.notFound();
  const raw = await c.req.text();
  const verified = await verifySlackSignature({
    signingSecret: config.signingSecret,
    timestamp: c.req.header('x-slack-request-timestamp') ?? null,
    signature: c.req.header('x-slack-signature') ?? null,
    body: raw,
  });
  if (!verified) return c.text('Bad signature', 401);

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return c.text('Bad body', 400);
  }

  const challenge = urlVerification(body);
  if (challenge !== null) return c.text(challenge);

  const gone = uninstalledTeam(body);
  if (gone) {
    c.executionCtx.waitUntil(slackStore(c.env.DB).removeTeam(gone));
    return c.body(null, 200);
  }

  const reply = inboundReply(body);
  if (reply) {
    const rooms = c.env.ANNOTATION_ROOM;
    c.executionCtx.waitUntil(
      applyInboundReply({
        db: c.env.DB,
        tokenKey: config.tokenKey,
        reply,
        roomStub: (roomId) => rooms.get(rooms.idFromName(roomId)),
      }).catch(() => false),
    );
  }
  return c.body(null, 200);
});

function urlVerification(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const type = Reflect.get(body, 'type');
  const challenge = Reflect.get(body, 'challenge');
  return type === 'url_verification' && typeof challenge === 'string' ? challenge : null;
}
