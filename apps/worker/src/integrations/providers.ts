import { z } from 'zod/mini';
import { type ConfigField, type Notifiable, oneLine, type Provider, type RenderArgs, summarize } from './types';

const json = { 'Content-Type': 'application/json' };

/** Discord's documented ceiling on `content`. Over it, the message is refused. */
const DISCORD_MAX_CONTENT = 2000;

/** The stored config every URL-shaped destination has: one hook to post to. */
const hookConfig = z.object({ url: z.string() });

/** Read the hook out of a stored config, or null if it is not the shape we saved. */
function hookUrl(config: unknown): string | null {
  const parsed = hookConfig.safeParse(config);
  return parsed.success ? parsed.data.url : null;
}

/** `Ada — Comment `high`: the text`, in whichever emphasis the destination speaks. */
function line(i: Notifiable, bold: (s: string) => string, code: (s: string) => string): string {
  const priority = i.priority ? ` ${code(i.priority)}` : '';
  return `${bold(i.author)} — ${i.kind}${priority}: ${oneLine(i.text)}`;
}

/**
 * The three chat destinations differ only in how they spell emphasis, links and
 * bullets, and in the JSON key that carries the message. Everything that decides
 * *what* a batch says — the heading, the per-annotation line, the overflow note,
 * the room link — is shared, so a change to the format lands on all of them at
 * once rather than drifting between three near-identical copies.
 */
interface ChatDialect {
  id: Provider['id'];
  label: string;
  blurb: string;
  fields: ConfigField[];
  allowedHosts: readonly string[];
  bullet: string;
  bold: (s: string) => string;
  code: (s: string) => string;
  link: ({ text, url }: { text: string; url: string }) => string;
  /** Teams renders a single newline as a space, so it needs the blank line. */
  join: string;
  bodyKey: 'text' | 'content';
  /** A hard ceiling on the assembled message, where the destination has one. */
  maxLength?: number;
}

function chatProvider(dialect: ChatDialect): Provider {
  const { bullet, bold, code, link, join, bodyKey, maxLength } = dialect;
  return {
    id: dialect.id,
    label: dialect.label,
    blurb: dialect.blurb,
    fields: dialect.fields,
    allowedHosts: dialect.allowedHosts,
    render({ event, config, roomUrl, pageUrl }: RenderArgs) {
      const url = hookUrl(config);
      if (!url) return null;
      const { shown, overflow, heading } = summarize(event.items);
      const lines = shown.map((i) => `${bullet} ${line(i, bold, code)}`);
      if (overflow > 0) lines.push(`${bullet} …and ${overflow} more`);

      const where = pageUrl ? link({ text: 'the page', url: pageUrl }) : 'a page';
      const head = `${bold(heading)} on ${where}`;
      const tail = link({ text: 'Open the room', url: roomUrl });

      // Over the ceiling the message is refused outright, so the batch is trimmed
      // to fit rather than sent and bounced. The room link is what makes a
      // truncated message still useful, so it is the part that survives.
      const kept = maxLength ? fit({ lines, budget: maxLength - head.length - tail.length - 2 * join.length }) : lines;
      return { url, headers: json, body: JSON.stringify({ [bodyKey]: [head, ...kept, tail].join(join) }) };
    },
  };
}

/** As many whole lines as fit the budget, with a note standing in for the rest. */
function fit({ lines, budget }: { lines: string[]; budget: number }): string[] {
  let used = 0;
  const kept: string[] = [];
  for (const l of lines) {
    if (used + l.length + 1 > budget) break;
    kept.push(l);
    used += l.length + 1;
  }
  if (kept.length < lines.length) kept.push(`• …and ${lines.length - kept.length} more`);
  return kept;
}

/**
 * Slack incoming webhook.
 *
 * Plain `text` rather than Block Kit on purpose: it renders identically in the
 * channel, in a push notification and in a digest email, and it cannot be broken
 * by a block-schema change we would not notice until a message stopped arriving.
 */
const slack = chatProvider({
  id: 'slack',
  label: 'Slack',
  blurb: 'Post new annotations to a Slack channel.',
  fields: [
    {
      name: 'url',
      label: 'Incoming webhook',
      type: 'url',
      placeholder: 'https://hooks.slack.com/services/…',
      help: 'Create one in your Slack workspace settings.',
      helpUrl: 'https://api.slack.com/messaging/webhooks',
    },
  ],
  allowedHosts: ['hooks.slack.com'],
  bullet: '•',
  bold: (s) => `*${s}*`,
  code: (s) => `\`${s}\``,
  link: ({ text, url }) => `<${url}|${text}>`,
  join: '\n',
  bodyKey: 'text',
});

/**
 * Microsoft Teams incoming webhook.
 *
 * Teams renders a restricted Markdown, and its own docs are explicit that a
 * bare URL is not linkified — hence the explicit `[label](url)`.
 */
const teams = chatProvider({
  id: 'teams',
  label: 'Microsoft Teams',
  blurb: 'Post new annotations to a Teams channel.',
  fields: [
    {
      name: 'url',
      label: 'Incoming webhook',
      type: 'url',
      placeholder: 'https://….azure.com/… or https://….powerautomate.com/…',
      help: 'Teams → Workflows → "Post to a channel when a webhook request is received".',
      helpUrl:
        'https://support.microsoft.com/office/send-messages-in-teams-using-incoming-webhooks-323660ec-12ca-40b1-a1d3-a3df47e808c4',
    },
  ],
  /**
   * Advisory only, and deliberately broad: Microsoft has moved this URL twice.
   * Office 365 connectors (`*.webhook.office.com`) were retired in May 2026, the
   * Workflows replacement issued `prod-NN.<region>.logic.azure.com` URLs, and
   * those moved again in late 2025 to Power Automate hosts. A list this volatile
   * cannot be a security control, which is why `isAllowedUrl` runs the shared
   * private-address guard for every provider regardless of what is listed here.
   * If a valid Teams URL is refused, the fix is to add its host to this line.
   */
  allowedHosts: [
    '.logic.azure.com',
    '.powerautomate.com',
    '.powerplatform.com',
    '.webhook.office.com',
    'flow.microsoft.com',
  ],
  bullet: '-',
  bold: (s) => `**${s}**`,
  code: (s) => `\`${s}\``,
  link: ({ text, url }) => `[${text}](${url})`,
  join: '\n\n',
  bodyKey: 'text',
});

/** Discord webhook. Same shape as Slack's, different field name and host. */
const discord = chatProvider({
  id: 'discord',
  label: 'Discord',
  blurb: 'Post new annotations to a Discord channel.',
  fields: [
    {
      name: 'url',
      label: 'Webhook URL',
      type: 'url',
      placeholder: 'https://discord.com/api/webhooks/…',
      help: 'Channel settings → Integrations → Webhooks.',
      helpUrl: 'https://support.discord.com/hc/articles/228383668',
    },
  ],
  allowedHosts: ['discord.com', 'discordapp.com'],
  bullet: '•',
  bold: (s) => `**${s}**`,
  code: (s) => `\`${s}\``,
  // Discord linkifies a bare URL and shows no preview inside angle brackets, so
  // the label is dropped rather than rendered as literal text beside it.
  link: ({ url }) => `<${url}>`,
  join: '\n',
  bodyKey: 'content',
  maxLength: DISCORD_MAX_CONTENT,
});

/**
 * A raw JSON POST to any public URL — the escape hatch for everything we do not
 * build a provider for.
 *
 * The only destination with no host allowlist, so it is the one place the shared
 * private-address guard does the work instead. Its payload is structured rather
 * than prose: whatever receives it is a program, not a person.
 */
const webhook: Provider = {
  id: 'webhook',
  label: 'Webhook',
  blurb: 'POST new annotations as JSON to any URL.',
  fields: [
    {
      name: 'url',
      label: 'Endpoint',
      type: 'url',
      placeholder: 'https://example.com/hooks/marklayer',
      help: 'Receives a JSON body. Private and loopback addresses are refused.',
    },
  ],
  allowedHosts: [],
  render({ event, config, roomUrl, pageUrl }: RenderArgs) {
    const url = hookUrl(config);
    if (!url) return null;
    return {
      url,
      headers: json,
      body: JSON.stringify({
        type: event.type,
        room: roomUrl,
        page: pageUrl,
        items: event.items.map((i) => ({ ...i, text: oneLine(i.text) })),
      }),
    };
  },
};

/** Every destination a room can post to, by id. */
export const PROVIDERS = { slack, teams, discord, webhook } as const;

export const providerList: readonly Provider[] = Object.values(PROVIDERS);

export const providerById = (id: string): Provider | null =>
  Object.hasOwn(PROVIDERS, id) ? PROVIDERS[id as keyof typeof PROVIDERS] : null;
