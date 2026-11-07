import type { CommentOp, DrawOp } from '@marklayer/types/ops';
import { attachmentLinks, notifiableFrom, oneLine } from './types';

/** Slack's escaping for message text: these three, and nothing else. */
const escapeMrkdwn = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

/** A human's Slack reply as plain comment text: links and mentions unwrapped, entities decoded. */
export function plainFromMrkdwn(text: string): string {
  return text
    .replace(/<(?:https?|mailto):[^|>]+\|([^>]+)>/g, '$1')
    .replace(/<((?:https?|mailto):[^>]+)>/g, '$1')
    .replace(/<@[A-Z0-9]+(?:\|([^>]+))?>/g, (_, name?: string) => `@${name ?? 'someone'}`)
    .replace(/<#[A-Z0-9]+\|([^>]*)>/g, '#$1')
    .replace(/<!(here|channel|everyone)(?:\|[^>]*)?>/g, '@$1')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')
    .trim();
}

/** A new annotation as a thread parent: who, what kind, the words, and the way back to the room. */
export function parentMessage({ op, roomUrl, origin }: { op: DrawOp; roomUrl: string; origin: string }): string | null {
  const item = notifiableFrom(op);
  if (!item) return null;
  const priority = item.priority ? ` \`${item.priority}\`` : '';
  return [
    `*${escapeMrkdwn(item.author)}* — ${item.kind}${priority}: ${escapeMrkdwn(oneLine(item.text))}`,
    ...(attachmentLinks({ item, roomUrl: origin }) ?? []),
    `<${roomUrl}|Open in MarkLayer>`,
  ].join('\n');
}

export function replyMessage({ op, origin }: { op: CommentOp; origin: string }): string | null {
  const item = notifiableFrom(op);
  if (!item) return null;
  return [
    `*${escapeMrkdwn(item.author)}*: ${escapeMrkdwn(item.text.trim())}`,
    ...(attachmentLinks({ item, roomUrl: origin }) ?? []),
  ].join('\n');
}

/** Op ids for Slack-born replies are derived from the message, so a redelivered event writes nothing new. */
export const slackOpId = ({ channel, ts }: { channel: string; ts: string }) =>
  `slack-${channel}-${ts.replace('.', '_')}`;

/** Every op this app writes into a room starts with this, which is how the room keeps it out of the outbound queue. */
export const isSlackOp = (op: DrawOp) => op.id.startsWith('slack-');
