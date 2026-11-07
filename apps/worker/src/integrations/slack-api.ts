import { z } from 'zod/mini';
import { SLACK_SCOPES, type SlackConfig } from './slack-config';

const SLACK_API = 'https://slack.com/api';
const TIMEOUT_MS = 5000;

const okResponse = z.object({ ok: z.boolean(), error: z.optional(z.string()) });

/** One Web API call. Never throws: a transport failure reads as `{ ok: false }`. */
async function call({
  method,
  token,
  body,
}: {
  method: string;
  token?: string;
  body: Record<string, string | boolean> | URLSearchParams;
}): Promise<unknown> {
  try {
    const res = await fetch(`${SLACK_API}/${method}`, {
      method: 'POST',
      headers: {
        'Content-Type':
          body instanceof URLSearchParams ? 'application/x-www-form-urlencoded' : 'application/json; charset=utf-8',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body instanceof URLSearchParams ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: 'manual',
    });
    return await res.json();
  } catch {
    return { ok: false, error: 'unreachable' };
  }
}

const postResult = z.object({ ok: z.literal(true), ts: z.string() });

export async function postMessage({
  token,
  channel,
  text,
  threadTs,
}: {
  token: string;
  channel: string;
  text: string;
  threadTs?: string;
}): Promise<string | null> {
  const body: Record<string, string | boolean> = { channel, text, unfurl_links: false };
  if (threadTs) body.thread_ts = threadTs;
  const parsed = postResult.safeParse(await call({ method: 'chat.postMessage', token, body }));
  return parsed.success ? parsed.data.ts : null;
}

const accessResult = z.object({
  ok: z.literal(true),
  access_token: z.string(),
  bot_user_id: z.string(),
  team: z.object({ id: z.string(), name: z.optional(z.string()) }),
  incoming_webhook: z.object({ channel_id: z.string(), channel: z.optional(z.string()) }),
});
export type SlackAccess = z.infer<typeof accessResult>;

export async function exchangeCode({
  config,
  code,
  redirectUri,
}: {
  config: SlackConfig;
  code: string;
  redirectUri: string;
}): Promise<SlackAccess | { ok: false; error: string }> {
  const raw = await call({
    method: 'oauth.v2.access',
    body: new URLSearchParams({
      code,
      redirect_uri: redirectUri,
      client_id: config.clientId,
      client_secret: config.clientSecret,
    }),
  });
  const parsed = accessResult.safeParse(raw);
  if (parsed.success) return parsed.data;
  const failure = okResponse.safeParse(raw);
  return { ok: false, error: (failure.success && failure.data.error) || 'unexpected response' };
}

/** Best effort: a public channel is joined so its replies reach us; a private one needs `/invite`. */
export async function joinChannel({ token, channel }: { token: string; channel: string }): Promise<void> {
  await call({ method: 'conversations.join', token, body: { channel } });
}

const userResult = z.object({
  ok: z.literal(true),
  user: z.object({
    name: z.optional(z.string()),
    real_name: z.optional(z.string()),
    profile: z.optional(z.object({ display_name: z.optional(z.string()), real_name: z.optional(z.string()) })),
  }),
});

/** The name a person goes by in Slack, or a stand-in when the lookup fails. */
export async function displayName({ token, user }: { token: string; user: string }): Promise<string> {
  const parsed = userResult.safeParse(await call({ method: 'users.info', token, body: new URLSearchParams({ user }) }));
  if (!parsed.success) return 'Slack user';
  const u = parsed.data.user;
  return u.profile?.display_name || u.profile?.real_name || u.real_name || u.name || 'Slack user';
}

export const authorizeUrl = ({
  config,
  redirectUri,
  state,
}: {
  config: SlackConfig;
  redirectUri: string;
  state: string;
}) =>
  `https://slack.com/oauth/v2/authorize?${new URLSearchParams({
    client_id: config.clientId,
    scope: SLACK_SCOPES.join(','),
    redirect_uri: redirectUri,
    state,
  })}`;
