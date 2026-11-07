import { describe, expect, test } from 'bun:test';
import type { DrawOp } from '@marklayer/types/ops';
import { validateIntegration } from './deliver';
import { PROVIDERS, providerList } from './providers';
import { type Notifiable, notifiableFrom, type RoomEvent } from './types';

const base = { id: 'op1', color: '#fff', lineWidth: 2 };
const args = { roomUrl: 'https://marklayer.app/s/abc', pageUrl: 'https://example.com' };
const item: Notifiable = { kind: 'Comment', author: 'Ada', text: 'Contrast fails', priority: 'high' };
const config = { url: 'https://hooks.slack.com/services/T/B/x' };

describe('notifiableFrom', () => {
  test('takes the annotations that carry words somebody wrote', () => {
    const comment: DrawOp = { ...base, tool: 'comment', num: 1, text: 'Contrast fails', x: 0, y: 0, ts: 0 };
    expect(notifiableFrom(comment)).toMatchObject({ kind: 'Comment', text: 'Contrast fails' });
    expect(notifiableFrom({ ...comment, id: 'op2', parentId: 'op1' })).toMatchObject({ kind: 'Reply' });
  });

  // A channel that says "someone drew a line" is a channel people mute.
  test('ignores marks that say nothing on their own', () => {
    const pen: DrawOp = { ...base, tool: 'pen', points: [{ x: 1, y: 1 }], compositeOperation: 'source-over' };
    expect(notifiableFrom(pen)).toBeNull();
    const guide: DrawOp = { ...base, tool: 'guide', orientation: 'vertical', position: 10 };
    expect(notifiableFrom(guide)).toBeNull();
    const blank: DrawOp = { ...base, tool: 'comment', num: 1, text: '   ', x: 0, y: 0, ts: 0 };
    expect(notifiableFrom(blank)).toBeNull();
  });

  test('renders a suggested edit as the before and after', () => {
    const edit: DrawOp = {
      ...base,
      tool: 'selection',
      text: 'Sign up free',
      suggestion: 'Start free',
      rects: [],
      ts: 0,
    };
    expect(notifiableFrom(edit)).toMatchObject({ kind: 'Suggested edit', text: '“Sign up free” → “Start free”' });
  });
});

/** A config each provider will actually accept, so the shared tests can render. */
const configs: Record<string, Record<string, string>> = {
  slack: config,
  teams: config,
  discord: config,
  webhook: config,
  linear: { apiKey: 'lin_api_x', teamId: 'ENG' },
  github: { token: 'ghp_x', repo: 'acme/site' },
  jira: { site: 'acme', email: 'ada@acme.com', apiToken: 'tok', projectKey: 'PROJ', issueType: 'Task' },
  trello: { apiKey: 'key', token: 'tok', listId: 'list1' },
  zapier: { url: 'https://hooks.zapier.com/hooks/catch/1/abc/' },
  notion: { token: 'ntn_x', pageId: 'https://www.notion.so/acme/Feedback-0123456789abcdef0123456789abcdef' },
  clickup: { token: 'pk_x', listId: '901234567' },
};

/** The event a destination is for: chat posts every batch, a tracker is asked. */
const eventFor = (provider: { trigger: string }): RoomEvent =>
  provider.trigger === 'manual'
    ? { type: 'annotation.pushed', items: [item] }
    : { type: 'annotations.created', items: [item] };

describe('every provider', () => {
  test('declines rather than throwing when the config is not its shape', () => {
    for (const provider of providerList) {
      const event = eventFor(provider);
      expect(provider.render({ event, config: {}, ...args })).toBeNull();
      expect(provider.render({ event, config: null, ...args })).toBeNull();
      expect(provider.render({ event, config: { url: 42 }, ...args })).toBeNull();
    }
  });

  test('carries the author, the text and a way back to the room', () => {
    for (const provider of providerList) {
      const rendered = provider.render({
        event: eventFor(provider),
        config: configs[provider.id],
        ...args,
      });
      expect(rendered).not.toBeNull();
      expect(rendered?.body).toContain('Ada');
      expect(rendered?.body).toContain('Contrast fails');
      expect(rendered?.body).toContain('marklayer.app/s/abc');
    }
  });

  // `fields` is all the settings form can ask for, so a shape field missing from it can never be filled in.
  test('can be configured from nothing but the fields it declares', () => {
    for (const provider of providerList) {
      const asked = provider.fields.map((field) => [field.name, configs[provider.id]?.[field.name]]);
      const rendered = provider.render({ event: eventFor(provider), config: Object.fromEntries(asked), ...args });
      expect(rendered).not.toBeNull();
    }
  });
});

describe('issue trackers', () => {
  const trackers = providerList.filter((p) => p.trigger === 'manual');

  test('there are six of them, and they are the manual ones', () => {
    expect(trackers.map((p) => p.id).sort()).toEqual(['clickup', 'github', 'jira', 'linear', 'notion', 'trello']);
  });

  // The whole reason `trigger` exists. An issue per comment, filed unasked off
  // every batch, is what makes a team switch the integration off.
  test('refuse to file automatically off a batch', () => {
    for (const provider of trackers) {
      const rendered = provider.render({
        event: { type: 'annotations.created', items: [item] },
        config: configs[provider.id],
        ...args,
      });
      expect(rendered).toBeNull();
    }
  });

  test('decline an empty batch rather than filing a blank issue', () => {
    for (const provider of trackers) {
      const rendered = provider.render({
        event: { type: 'annotation.pushed', items: [] },
        config: configs[provider.id],
        ...args,
      });
      expect(rendered).toBeNull();
    }
  });

  test('every one of them carries its credential in a header, never the URL', () => {
    for (const provider of trackers) {
      const rendered = provider.render({ event: eventFor(provider), config: configs[provider.id], ...args });
      expect(rendered?.headers.Authorization).toBeTruthy();
      for (const secret of ['lin_api_x', 'ghp_x', 'tok']) expect(rendered?.url).not.toContain(secret);
    }
  });
});

describe('linear', () => {
  const render = (config: unknown) => PROVIDERS.linear.render({ event: eventFor(PROVIDERS.linear), config, ...args });

  // A personal API key goes in raw. Prefixing it is the documented 401.
  test('sends the key with no Bearer prefix', () => {
    expect(render(configs.linear)?.headers.Authorization).toBe('lin_api_x');
  });

  test('reads the issue url out of a successful mutation', () => {
    const body = { data: { issueCreate: { success: true, issue: { url: 'https://linear.app/acme/issue/ENG-1' } } } };
    expect(PROVIDERS.linear.parseResult?.(body)).toBe('https://linear.app/acme/issue/ENG-1');
  });

  // GraphQL answers 200 for a refused mutation, so the body is the verdict.
  test('treats a refused mutation as a failure even though it answered 200', () => {
    expect(PROVIDERS.linear.parseResult?.({ data: { issueCreate: { success: false, issue: null } } })).toBeNull();
    expect(PROVIDERS.linear.parseResult?.({ errors: [{ message: 'nope' }] })).toBeNull();
    expect(PROVIDERS.linear.parseResult?.(null)).toBeNull();
  });
});

describe('github', () => {
  const render = (config: unknown) => PROVIDERS.github.render({ event: eventFor(PROVIDERS.github), config, ...args });

  test('builds the issues path for the configured repository', () => {
    expect(render(configs.github)?.url).toBe('https://api.github.com/repos/acme/site/issues');
  });

  // The repo is user input interpolated into a path, so its shape is a guard,
  // not a nicety: anything with a slash or a dot segment could walk out of it.
  test('refuses a repository that is not exactly owner/name', () => {
    for (const repo of ['acme', 'acme/site/extra', '../../orgs', 'acme/', '/site', 'acme/si te', '']) {
      expect(render({ token: 'ghp_x', repo })).toBeNull();
    }
  });

  test('pins the API version and identifies itself', () => {
    const headers = render(configs.github)?.headers;
    expect(headers?.['X-GitHub-Api-Version']).toBe('2022-11-28');
    expect(headers?.['User-Agent']).toBe('MarkLayer');
  });

  test('reads html_url, the one a person can open, not the API url', () => {
    const body = {
      url: 'https://api.github.com/repos/acme/site/issues/7',
      html_url: 'https://github.com/acme/site/issues/7',
    };
    expect(PROVIDERS.github.parseResult?.(body)).toBe('https://github.com/acme/site/issues/7');
  });
});

describe('jira', () => {
  const render = (config: unknown) => PROVIDERS.jira.render({ event: eventFor(PROVIDERS.jira), config, ...args });

  test('posts to the tenant the site names', () => {
    expect(render(configs.jira)?.url).toBe('https://acme.atlassian.net/rest/api/3/issue');
  });

  test('refuses a site that is not a bare tenant name', () => {
    for (const site of ['acme.atlassian.net', 'evil.test/acme', 'acme/../other', '-acme', '']) {
      expect(render({ ...configs.jira, site })).toBeNull();
    }
  });

  test('sends basic auth over email:token', () => {
    expect(render(configs.jira)?.headers.Authorization).toBe(`Basic ${btoa('ada@acme.com:tok')}`);
  });

  // btoa throws over code point 255, and an accented name should not take the
  // integration down.
  test('survives a non-ASCII account name', () => {
    const rendered = render({ ...configs.jira, email: 'ada@açme.com' });
    expect(rendered?.headers.Authorization).toStartWith('Basic ');
  });

  // v3 takes rich text as a document; a plain string is rejected outright.
  test('sends the description as an Atlassian document, with no empty text nodes', () => {
    const body = JSON.parse(render(configs.jira)?.body ?? '{}');
    expect(body.fields.description.type).toBe('doc');
    expect(body.fields.description.version).toBe(1);
    for (const block of body.fields.description.content) {
      expect(block.type).toBe('paragraph');
      for (const node of block.content ?? []) expect(node.text).not.toBe('');
    }
  });

  // Jira returns `self`, a REST resource, and no browsable link at all.
  test('builds a browse url, because the response has none', () => {
    const body = { id: '10000', key: 'PROJ-24', self: 'https://acme.atlassian.net/rest/api/2/issue/10000' };
    expect(PROVIDERS.jira.parseResult?.(body)).toBe('https://acme.atlassian.net/browse/PROJ-24');
  });
});

describe('discord', () => {
  // Discord refuses a message over 2000 characters, so a busy room must not
  // produce one: the batch is trimmed rather than sent and bounced.
  test('keeps content within the 2000-character limit', () => {
    const long: Notifiable = { kind: 'Comment', author: 'Ada', text: 'x'.repeat(300) };
    const rendered = PROVIDERS.discord.render({
      event: { type: 'annotations.created', items: Array.from({ length: 20 }, () => long) },
      config,
      ...args,
    });
    const content = JSON.parse(rendered?.body ?? '{}').content as string;
    expect(content.length).toBeLessThanOrEqual(2000);
    // Trimmed, but still says how much was left out and where to see it.
    expect(content).toContain('more');
    expect(content).toContain('marklayer.app/s/abc');
  });
});

describe('webhook', () => {
  test('sends structured JSON, because a program is reading it', () => {
    const rendered = PROVIDERS.webhook.render({
      event: { type: 'annotations.created', items: [item] },
      config: { url: 'https://example.com/hook' },
      ...args,
    });
    const body = JSON.parse(rendered?.body ?? '{}');
    expect(body).toMatchObject({
      type: 'annotations.created',
      room: 'https://marklayer.app/s/abc',
      page: 'https://example.com',
    });
    expect(body.items[0]).toMatchObject({ author: 'Ada', kind: 'Comment' });
  });
});

// The pin's screenshot rides `attachments`; dropped anywhere on the way, a destination just gets text.
describe('screenshots', () => {
  const comment: DrawOp = {
    ...base,
    tool: 'comment',
    num: 1,
    text: 'Contrast fails',
    x: 0,
    y: 0,
    ts: 0,
    attachments: ['shot1234567'],
  };
  const shotUrl = 'https://marklayer.app/f/shot1234567';

  test('reach a webhook as URLs on the room origin', () => {
    const shot = notifiableFrom(comment);
    if (!shot) throw new Error('comment was not notifiable');
    const rendered = PROVIDERS.webhook.render({
      event: { type: 'annotations.created', items: [shot] },
      config: { url: 'https://example.com/hook' },
      ...args,
    });
    expect(JSON.parse(rendered?.body ?? '{}').items[0].attachments).toEqual([shotUrl]);
  });

  test('are linked from a filed issue', () => {
    const shot = notifiableFrom(comment);
    if (!shot) throw new Error('comment was not notifiable');
    const rendered = PROVIDERS.github.render({
      event: { type: 'annotation.pushed', items: [shot] },
      config: configs.github,
      ...args,
    });
    expect(rendered?.body).toContain(shotUrl);
  });
});

describe('trello', () => {
  const body = (b: unknown) => PROVIDERS.trello.parseResult?.(b);

  // The response may omit either link; a card is still created if one is there.
  test('reads shortUrl, falling back to url, and nothing from a body with neither', () => {
    expect(body({ shortUrl: 'https://trello.com/c/abc', url: 'https://trello.com/c/abc/1-x' })).toBe(
      'https://trello.com/c/abc',
    );
    expect(body({ url: 'https://trello.com/c/abc/1-x' })).toBe('https://trello.com/c/abc/1-x');
    expect(body({ id: 'x' })).toBeNull();
    expect(body(null)).toBeNull();
  });
});

describe('zapier', () => {
  // The allowlist is the only thing separating this row from the open webhook.
  test('accepts a Zapier catch hook and refuses any other host', () => {
    expect(validateIntegration({ provider: 'zapier', config: configs.zapier }).ok).toBe(true);
    expect(validateIntegration({ provider: 'zapier', config: { url: 'https://example.com/hook' } }).ok).toBe(false);
  });
});

describe('notion', () => {
  const render = (pageId: string) =>
    PROVIDERS.notion.render({
      event: { type: 'annotation.pushed', items: [item] },
      config: { token: 'ntn_x', pageId },
      ...args,
    });
  const parent = (pageId: string) => JSON.parse(render(pageId)?.body ?? '{}').parent?.page_id;

  // People paste the page link, not the id; every spelling has to land on the same page.
  test('takes the page id out of a link, a dashed id or a bare one', () => {
    const id = '0123456789abcdef0123456789abcdef';
    expect(parent(`https://www.notion.so/acme/Feedback-${id}`)).toBe(id);
    expect(parent(`https://www.notion.so/${id}?pvs=4`)).toBe(id);
    expect(parent('01234567-89ab-cdef-0123-456789abcdef')).toBe(id);
    expect(render('https://www.notion.so/acme/Feedback')).toBeNull();
  });
});

describe('clickup', () => {
  test('refuses a list id that is not a number, so the path cannot leave /list', () => {
    const config = { token: 'pk_x', listId: '1/../../team' };
    expect(validateIntegration({ provider: 'clickup', config }).ok).toBe(false);
  });
});
