import { z } from 'zod/mini';
import { plainFromMrkdwn } from './slack-format';

const messageEvent = z.object({
  type: z.literal('message'),
  channel: z.string(),
  ts: z.string(),
  text: z.optional(z.string()),
  user: z.optional(z.string()),
  thread_ts: z.optional(z.string()),
  subtype: z.optional(z.string()),
  bot_id: z.optional(z.string()),
});

const messageCallback = z.object({
  type: z.literal('event_callback'),
  team_id: z.string(),
  event: messageEvent,
});

export type InboundReply = {
  teamId: string;
  channel: string;
  threadTs: string;
  ts: string;
  user: string;
  text: string;
};

/**
 * A human reply in a thread, or null for everything else Slack sends.
 *
 * Any `bot_id` or `subtype` is dropped: our own posts carry `bot_id`, and
 * edits, deletes and joins are subtypes. That is what stops a reply we post from
 * coming back in as a new one. The bot-user check against the install happens
 * in the route, where the install is known.
 */
export function inboundReply(body: unknown): InboundReply | null {
  const envelope = messageCallback.safeParse(body);
  if (!envelope.success) return null;
  const { channel, ts, text, user, thread_ts, subtype, bot_id } = envelope.data.event;
  if (bot_id || subtype || !user || !thread_ts || thread_ts === ts) return null;
  const plain = plainFromMrkdwn(text ?? '');
  if (!plain) return null;
  return { teamId: envelope.data.team_id, channel, threadTs: thread_ts, ts, user, text: plain };
}

const workspaceGone = z.object({
  type: z.literal('event_callback'),
  team_id: z.string(),
  event: z.object({ type: z.enum(['app_uninstalled', 'tokens_revoked']) }),
});

/** The workspace whose installs should be forgotten, if this event says so. */
export function uninstalledTeam(body: unknown): string | null {
  const parsed = workspaceGone.safeParse(body);
  return parsed.success ? parsed.data.team_id : null;
}
