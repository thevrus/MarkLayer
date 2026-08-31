import { z } from 'zod/mini';
import { base64Utf8 } from '../http';
import { type ConfigField, type Notifiable, oneLine, type Provider, type RenderArgs, summarize } from './types';

const json = { 'Content-Type': 'application/json' };

/** A tracker's title field is one line. Past this the sentence belongs in the body. */
const ISSUE_TITLE_MAX = 120;

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
    trigger: 'auto',
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
      // Both hint strings are read inside a ~270px panel field. The pair of full
      // example hosts this replaces was clipped by the input with no ellipsis, and
      // the help was a three-line breadcrumb next to three one-line siblings —
      // `helpUrl` carries the click-by-click version.
      placeholder: 'https://….powerautomate.com/…',
      help: 'Add a Workflows webhook to the channel.',
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
  trigger: 'auto',
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

/**
 * A pushed annotation as the two things every tracker wants: a one-line title
 * and a body that stands on its own.
 *
 * Self-contained on purpose. There is no deep link to a single annotation yet,
 * so an issue saying "see the room" would drop a reader into a page of twelve
 * comments with no idea which one. Carrying the text means the issue is
 * readable without opening anything.
 */
function issueContent({ event, roomUrl, pageUrl }: RenderArgs): { title: string; body: string } | null {
  // Only ever a person filing one annotation. An issue per comment, raised
  // automatically off every batch, is the behaviour teams switch off.
  if (event.type !== 'annotation.pushed') return null;
  const item = event.items[0];
  if (!item) return null;

  const text = oneLine(item.text);
  const title = text.length > ISSUE_TITLE_MAX ? `${text.slice(0, ISSUE_TITLE_MAX - 1)}…` : text;
  const attribution = item.priority
    ? `${item.kind} by ${item.author} · priority ${item.priority}`
    : `${item.kind} by ${item.author}`;

  const body = [text, '', attribution, pageUrl ? `Page: ${pageUrl}` : null, `Annotations: ${roomUrl}`]
    .filter((l) => l !== null)
    .join('\n');

  return { title: title || 'Annotation', body };
}

/** The stored config for Linear: a personal key, and the team to file into. */
const linearConfig = z.object({ apiKey: z.string(), teamId: z.string() });

/**
 * Linear files through a GraphQL mutation rather than a REST path, so the team
 * travels in the body and the endpoint is fixed.
 *
 * The key goes in `Authorization` raw, with no `Bearer` — that is a personal API
 * key, and prefixing it is the documented way to get a 401 from this API.
 */
const linear: Provider = {
  id: 'linear',
  label: 'Linear',
  blurb: 'File a thread as a Linear issue.',
  fields: [
    {
      name: 'apiKey',
      label: 'API key',
      type: 'secret',
      placeholder: 'lin_api_…',
      help: 'Linear → Settings → Security & access → Personal API keys.',
      helpUrl: 'https://linear.app/settings/account/security',
    },
    {
      name: 'teamId',
      label: 'Team ID',
      type: 'text',
      placeholder: 'ENG',
      help: "The team key from your issue ids, or the team's UUID.",
    },
  ],
  allowedHosts: ['api.linear.app'],
  trigger: 'manual',
  render(args: RenderArgs) {
    const parsed = linearConfig.safeParse(args.config);
    if (!parsed.success) return null;
    const content = issueContent(args);
    if (!content) return null;

    return {
      url: 'https://api.linear.app/graphql',
      headers: { ...json, Authorization: parsed.data.apiKey },
      body: JSON.stringify({
        query:
          'mutation($teamId: String!, $title: String!, $description: String) {' +
          ' issueCreate(input: { teamId: $teamId, title: $title, description: $description })' +
          ' { success issue { url } } }',
        variables: { teamId: parsed.data.teamId, title: content.title, description: content.body },
      }),
    };
  },
  /**
   * GraphQL answers 200 for a refused mutation, so success is whatever the body
   * says it is. No issue url means it did not create one, whatever the status.
   */
  parseResult(body: unknown): string | null {
    const parsed = linearResult.safeParse(body);
    if (!parsed.success || !parsed.data.data.issueCreate.success) return null;
    return parsed.data.data.issueCreate.issue?.url ?? null;
  },
};

const linearResult = z.object({
  data: z.object({
    issueCreate: z.object({
      success: z.boolean(),
      issue: z.nullable(z.optional(z.object({ url: z.string() }))),
    }),
  }),
});

/** The stored config for GitHub: a token, and one `owner/name` repository. */
const githubConfig = z.object({ token: z.string(), repo: z.string() });

/** `owner/name`, and nothing else — a path segment each, neither one empty. */
const REPO_SHAPE = /^[\w.-]+\/[\w.-]+$/;

const github: Provider = {
  id: 'github',
  label: 'GitHub',
  blurb: 'File a thread as a GitHub issue.',
  fields: [
    {
      name: 'token',
      label: 'Access token',
      type: 'secret',
      placeholder: 'github_pat_…',
      help: 'A fine-grained token with Issues write on the repository.',
      helpUrl: 'https://github.com/settings/tokens',
    },
    {
      name: 'repo',
      label: 'Repository',
      type: 'text',
      placeholder: 'owner/repository',
    },
  ],
  allowedHosts: ['api.github.com'],
  trigger: 'manual',
  render(args: RenderArgs) {
    const parsed = githubConfig.safeParse(args.config);
    if (!parsed.success || !REPO_SHAPE.test(parsed.data.repo)) return null;
    const content = issueContent(args);
    if (!content) return null;

    return {
      // The shape is checked above, so nothing here can walk out of /repos.
      url: `https://api.github.com/repos/${parsed.data.repo}/issues`,
      headers: {
        ...json,
        Authorization: `Bearer ${parsed.data.token}`,
        Accept: 'application/vnd.github+json',
        // Pinned rather than omitted: the default version is whatever GitHub
        // decides it is next, and a create call should not change under us.
        'X-GitHub-Api-Version': '2022-11-28',
        // GitHub refuses a request with no User-Agent.
        'User-Agent': 'MarkLayer',
      },
      body: JSON.stringify({ title: content.title, body: content.body }),
    };
  },
  /** `html_url` is the page a person can open; `url` is the API resource. */
  parseResult(body: unknown): string | null {
    const parsed = githubResult.safeParse(body);
    return parsed.success ? parsed.data.html_url : null;
  },
};

const githubResult = z.object({ html_url: z.string() });

/**
 * The stored config for Jira. Five fields because Jira genuinely needs them:
 * the site, who the token belongs to, the token, and where to file.
 *
 * `issueType` is a name rather than an id — "Task" is something a person can
 * type, and the numeric id it maps to is buried in an admin screen.
 */
const jiraConfig = z.object({
  site: z.string(),
  email: z.string(),
  apiToken: z.string(),
  projectKey: z.string(),
  issueType: z.string(),
});

/** A bare Atlassian tenant name: what goes in front of `.atlassian.net`. */
const JIRA_SITE_SHAPE = /^[a-z0-9][a-z0-9-]*$/i;

/** Base64 of `email:token`. UTF-8 safe, so an accented display name cannot take the integration down. */
function basicAuth({ email, token }: { email: string; token: string }): string {
  return base64Utf8(`${email}:${token}`);
}

/** Jira v3 takes rich text as a document, not a string. */
function adf(body: string) {
  return {
    type: 'doc',
    version: 1,
    content: body.split('\n').map((line) => ({
      type: 'paragraph',
      // An empty paragraph carries no content array at all — a text node with
      // an empty string is rejected by the document schema.
      content: line ? [{ type: 'text', text: line }] : [],
    })),
  };
}

const jira: Provider = {
  id: 'jira',
  label: 'Jira',
  blurb: 'File a thread as a Jira issue.',
  fields: [
    {
      name: 'site',
      label: 'Site',
      type: 'text',
      placeholder: 'your-company',
      help: 'The part before .atlassian.net.',
    },
    { name: 'email', label: 'Account email', type: 'text', placeholder: 'you@company.com' },
    {
      name: 'apiToken',
      label: 'API token',
      type: 'secret',
      placeholder: 'ATATT…',
      help: 'Atlassian account → Security → API tokens.',
      helpUrl: 'https://id.atlassian.com/manage-profile/security/api-tokens',
    },
    { name: 'projectKey', label: 'Project key', type: 'text', placeholder: 'PROJ' },
    { name: 'issueType', label: 'Issue type', type: 'text', placeholder: 'Task' },
  ],
  allowedHosts: ['.atlassian.net'],
  trigger: 'manual',
  render(args: RenderArgs) {
    const parsed = jiraConfig.safeParse(args.config);
    if (!parsed.success || !JIRA_SITE_SHAPE.test(parsed.data.site)) return null;
    const content = issueContent(args);
    if (!content) return null;

    return {
      url: `https://${parsed.data.site}.atlassian.net/rest/api/3/issue`,
      headers: {
        ...json,
        Authorization: `Basic ${basicAuth({ email: parsed.data.email, token: parsed.data.apiToken })}`,
      },
      body: JSON.stringify({
        fields: {
          project: { key: parsed.data.projectKey },
          issuetype: { name: parsed.data.issueType },
          summary: content.title,
          description: adf(content.body),
        },
      }),
    };
  },
  /**
   * Jira returns `self`, which is the REST resource, and no browsable link at
   * all — so the one a person can open is built from the key it does return.
   */
  parseResult(body: unknown): string | null {
    const parsed = jiraResult.safeParse(body);
    if (!parsed.success) return null;
    const site = new URL(parsed.data.self).origin;
    return `${site}/browse/${parsed.data.key}`;
  },
};

const jiraResult = z.object({ key: z.string(), self: z.string() });

/** Every destination a room can post to, by id. */
export const PROVIDERS = { slack, teams, discord, webhook, linear, github, jira } as const;

export const providerList: readonly Provider[] = Object.values(PROVIDERS);

export const providerById = (id: string): Provider | null =>
  Object.hasOwn(PROVIDERS, id) ? PROVIDERS[id as keyof typeof PROVIDERS] : null;
