/**
 * The two-way Slack app: everything here is pure or a single Slack Web API call.
 * Routes live in slack-routes.ts, D1 in slack-store.ts, and the room's outbound
 * flush goes through `postBatchToSlack` in slack-sync.ts.
 */

/** The bindings the app reads. Any one unset turns the whole feature off. */
export interface SlackEnv {
  SLACK_CLIENT_ID?: string;
  SLACK_CLIENT_SECRET?: string;
  SLACK_SIGNING_SECRET?: string;
  /** Base64 of 32 random bytes: the AES-GCM key bot tokens are stored under. */
  SLACK_TOKEN_KEY?: string;
}

export interface SlackConfig {
  clientId: string;
  clientSecret: string;
  signingSecret: string;
  tokenKey: string;
}

export function slackConfig(env: SlackEnv): SlackConfig | null {
  const { SLACK_CLIENT_ID, SLACK_CLIENT_SECRET, SLACK_SIGNING_SECRET, SLACK_TOKEN_KEY } = env;
  if (!SLACK_CLIENT_ID || !SLACK_CLIENT_SECRET || !SLACK_SIGNING_SECRET || !SLACK_TOKEN_KEY) return null;
  return {
    clientId: SLACK_CLIENT_ID,
    clientSecret: SLACK_CLIENT_SECRET,
    signingSecret: SLACK_SIGNING_SECRET,
    tokenKey: SLACK_TOKEN_KEY,
  };
}

/** Kept in step with the manifest in apps/worker/docs/slack-app.md. */
export const SLACK_SCOPES = [
  'chat:write',
  'channels:history',
  'groups:history',
  'channels:join',
  'users:read',
  'incoming-webhook',
] as const;
