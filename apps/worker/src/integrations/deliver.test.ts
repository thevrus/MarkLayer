import { describe, expect, test } from 'bun:test';
import {
  deliverOne,
  hasAllSecrets,
  isAllowedUrl,
  parseIntegrations,
  publicConfig,
  validateIntegration,
  withSecrets,
} from './deliver';
import { PROVIDERS, providerById } from './providers';

const SLACK_HOSTS = PROVIDERS.slack.allowedHosts;

/** Stand in for the destination, and restore the real fetch afterwards. */
async function withFetch(
  reply: (url: string | URL | Request, init?: RequestInit) => Response | Promise<Response>,
  run: () => Promise<void>,
) {
  const real = globalThis.fetch;
  // Assembled rather than cast: `fetch` carries a `preconnect` the bare
  // function does not, and the project does not assert its way past that.
  globalThis.fetch = Object.assign(async (url: string | URL | Request, init?: RequestInit) => await reply(url, init), {
    preconnect: real.preconnect,
  });
  try {
    await run();
  } finally {
    globalThis.fetch = real;
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** The one destination the send tests file at: GitHub, configured and complete. */
const githubArgs = {
  integration: { provider: 'github' as const, config: { token: 'ghp_x', repo: 'acme/site' } },
  event: {
    type: 'annotation.pushed' as const,
    items: [{ kind: 'Comment', author: 'Ada', text: 'Contrast fails' }],
  },
  roomUrl: 'https://marklayer.app/s/abc',
  pageUrl: 'https://example.com',
};

/**
 * This is the security boundary of the whole integrations layer. Providers are
 * pure and never fetch, so an SSRF hole could only ever come from here.
 */
describe('isAllowedUrl', () => {
  test('accepts a hook on an allowed host', () => {
    expect(isAllowedUrl({ url: 'https://hooks.slack.com/services/T/B/x', allowedHosts: SLACK_HOSTS })).toBe(true);
  });

  test('matches the host exactly, so a lookalike domain cannot pass', () => {
    expect(isAllowedUrl({ url: 'https://hooks.slack.com.evil.test/services/T/B/x', allowedHosts: SLACK_HOSTS })).toBe(
      false,
    );
    expect(isAllowedUrl({ url: 'https://evilhooks.slack.com/x', allowedHosts: SLACK_HOSTS })).toBe(false);
  });

  test('refuses plaintext, because these URLs carry a credential in the path', () => {
    expect(isAllowedUrl({ url: 'http://hooks.slack.com/services/T/B/x', allowedHosts: SLACK_HOSTS })).toBe(false);
  });

  test('refuses a host outside the provider list', () => {
    expect(isAllowedUrl({ url: 'https://example.com/services/T/B/x', allowedHosts: SLACK_HOSTS })).toBe(false);
  });

  // The generic webhook provider has no allowlist, so this is the only thing
  // standing between it and the internal network.
  test('refuses private and loopback addresses even with no allowlist', () => {
    for (const url of [
      'https://169.254.169.254/latest/meta-data/',
      'https://127.0.0.1/admin',
      'https://localhost/admin',
      'https://10.0.0.5/internal',
      'https://192.168.1.1/router',
      'https://[::1]/admin',
      'https://db.internal/dump',
    ]) {
      expect(isAllowedUrl({ url, allowedHosts: [] })).toBe(false);
    }
  });

  test('accepts an ordinary public host with no allowlist', () => {
    expect(isAllowedUrl({ url: 'https://example.com/hooks/marklayer', allowedHosts: [] })).toBe(true);
  });

  // An allowlist is a list somebody maintains and Microsoft has moved these
  // twice; the private-address guard must not depend on it being current.
  test('applies the private-address guard even to an allowlisted provider', () => {
    expect(isAllowedUrl({ url: 'https://localhost/services/T/B/x', allowedHosts: ['localhost'] })).toBe(false);
  });

  test('a leading dot is a suffix match, for tenant subdomains', () => {
    const hosts = PROVIDERS.teams.allowedHosts;
    expect(isAllowedUrl({ url: 'https://prod-12.westus.logic.azure.com/workflows/x', allowedHosts: hosts })).toBe(true);
    expect(isAllowedUrl({ url: 'https://notlogic.azure.com.evil.test/x', allowedHosts: hosts })).toBe(false);
  });

  test('refuses a string that is not a URL', () => {
    expect(isAllowedUrl({ url: 'not a url', allowedHosts: [] })).toBe(false);
    expect(isAllowedUrl({ url: '', allowedHosts: [] })).toBe(false);
    expect(isAllowedUrl({ url: 'file:///etc/passwd', allowedHosts: [] })).toBe(false);
  });
});

describe('validateIntegration', () => {
  test('accepts a well-formed destination', () => {
    const verdict = validateIntegration({
      provider: 'slack',
      config: { url: 'https://hooks.slack.com/services/T/B/x' },
    });
    expect(verdict.ok).toBe(true);
  });

  test('names why it refused, so the UI can say which mistake was made', () => {
    const wrongHost = validateIntegration({ provider: 'slack', config: { url: 'https://example.com/x' } });
    expect(wrongHost).toEqual({ ok: false, reason: 'not a URL Slack accepts' });

    const noUrl = validateIntegration({ provider: 'slack', config: {} });
    expect(noUrl).toEqual({ ok: false, reason: 'missing or malformed configuration' });
  });
});

describe('parseIntegrations', () => {
  test('reads a stored array', () => {
    const raw = JSON.stringify([{ provider: 'slack', config: { url: 'https://hooks.slack.com/services/T/B/x' } }]);
    expect(parseIntegrations(raw)).toHaveLength(1);
  });

  // A column that cannot be parsed must degrade to "no destinations", never
  // throw: a room has to keep working when its integrations do not.
  test('treats anything unreadable as no destinations', () => {
    expect(parseIntegrations(null)).toEqual([]);
    expect(parseIntegrations('not json')).toEqual([]);
    expect(parseIntegrations('{"not":"an array"}')).toEqual([]);
    expect(parseIntegrations('[{"provider":"nope","config":{}}]')).toEqual([]);
  });
});

describe('providerById', () => {
  test('finds a real provider and refuses anything else', () => {
    expect(providerById('slack')?.label).toBe('Slack');
    expect(providerById('asana')).toBeNull();
    // Object.hasOwn, not `in`, so a prototype key cannot resolve to a provider.
    expect(providerById('toString')).toBeNull();
    expect(providerById('__proto__')).toBeNull();
  });
});

describe('deliverOne', () => {
  const { integration } = githubArgs;
  const args = githubArgs;

  test('returns the created issue url', async () => {
    await withFetch(
      () => json({ html_url: 'https://github.com/acme/site/issues/7' }, 201),
      async () => {
        expect(await deliverOne(args)).toEqual({ ok: true, url: 'https://github.com/acme/site/issues/7' });
      },
    );
  });

  // The difference between "fix your token" and "nothing happened".
  test('names the reason, so the room owner knows which thing to fix', async () => {
    const cases: [number, string][] = [
      [401, 'GitHub rejected the token'],
      [403, 'GitHub rejected the token'],
      [404, 'GitHub could not find that project'],
      [429, 'GitHub is rate limiting. Try again shortly'],
      [500, 'GitHub returned 500'],
    ];
    for (const [status, reason] of cases) {
      await withFetch(
        () => json({ message: 'Bad credentials' }, status),
        async () => {
          expect(await deliverOne(args)).toEqual({ ok: false, reason });
        },
      );
    }
  });

  // A destination that answers 200 without creating anything has still failed,
  // and reporting success would send someone looking for an issue that is not there.
  test('treats a success status with no created thing as a failure', async () => {
    await withFetch(
      () => json({ nothing: true }),
      async () => {
        expect(await deliverOne(args)).toEqual({ ok: false, reason: 'GitHub declined to create it' });
      },
    );
  });

  test('reports an unreachable destination rather than throwing', async () => {
    await withFetch(
      () => {
        throw new TypeError('network');
      },
      async () => {
        expect(await deliverOne(args)).toEqual({ ok: false, reason: 'Could not reach GitHub' });
      },
    );
  });

  test('refuses a destination that cannot render this event, without a request', async () => {
    let called = false;
    await withFetch(
      () => {
        called = true;
        return json({});
      },
      async () => {
        const result = await deliverOne({ ...args, integration: { ...integration, config: { repo: 'acme/site' } } });
        expect(result).toEqual({ ok: false, reason: 'GitHub cannot file this annotation' });
        expect(called).toBe(false);
      },
    );
  });

  test('never sends a chat destination an event it was not asked for', async () => {
    const slack = { provider: 'slack' as const, config: { url: 'https://hooks.slack.com/services/T/B/x' } };
    let called = false;
    await withFetch(
      () => {
        called = true;
        return json({});
      },
      async () => {
        // Slack would render it happily, so the refusal has to come from the
        // manifest: `trigger: 'auto'` means this path may not reach it at all.
        // The API route checks the same thing, but it is not the only guard.
        expect(await deliverOne({ ...args, integration: slack })).toEqual({
          ok: false,
          reason: 'Slack posts automatically and cannot be filed to',
        });
        expect(called).toBe(false);
      },
    );
  });
});

describe('validateIntegration', () => {
  // An issue tracker declines `annotations.created` by design, so validating
  // against that one event alone would make every tracker unsaveable.
  test('accepts a provider that only renders the event it is triggered by', () => {
    expect(validateIntegration({ provider: 'github', config: { token: 'ghp_x', repo: 'acme/site' } })).toMatchObject({
      ok: true,
      provider: { id: 'github' },
    });
    expect(validateIntegration({ provider: 'linear', config: { apiKey: 'k', teamId: 'ENG' } })).toMatchObject({
      ok: true,
      provider: { id: 'linear' },
    });
  });

  test('still refuses a config the provider cannot use', () => {
    expect(validateIntegration({ provider: 'github', config: { token: 'ghp_x', repo: 'not-a-repo' } })).toMatchObject({
      ok: false,
    });
    expect(validateIntegration({ provider: 'asana', config: {} })).toEqual({ ok: false, reason: 'unknown provider' });
  });
});

/**
 * The point of ADR 0004: a room stores where to file, never what authorises it,
 * because the share link is the room's only access control and that link is
 * given to clients on purpose.
 */
describe('credential splitting', () => {
  const github = PROVIDERS.github;
  const full = { token: 'ghp_secret', repo: 'acme/site' };

  test('strips every secret field from what gets stored', () => {
    expect(publicConfig({ provider: github, config: full })).toEqual({ repo: 'acme/site' });
  });

  test('leaves a chat hook alone, because its URL is the whole config', () => {
    const config = { url: 'https://hooks.slack.com/services/T/B/x' };
    expect(publicConfig({ provider: PROVIDERS.slack, config })).toEqual(config);
  });

  test('puts the supplied token back for the one request that uses it', () => {
    const merged = withSecrets({ provider: github, config: { repo: 'acme/site' }, secrets: { token: 'ghp_x' } });
    expect(merged).toEqual({ repo: 'acme/site', token: 'ghp_x' });
  });

  // Otherwise this route would be a way to rewrite the room's destination while
  // only being allowed to supply a credential for it.
  test('takes only the fields the provider itself calls secret', () => {
    const merged = withSecrets({
      provider: github,
      config: { repo: 'acme/site' },
      secrets: { token: 'ghp_x', repo: 'attacker/evil' },
    });
    expect(merged.repo).toBe('acme/site');
  });

  test('ignores an empty credential rather than filing with one', () => {
    const merged = withSecrets({ provider: github, config: { repo: 'acme/site' }, secrets: { token: '' } });
    expect(hasAllSecrets({ provider: github, config: merged })).toBe(false);
    expect(hasAllSecrets({ provider: github, config: full })).toBe(true);
  });

  // A config saved without its token still has to be checkable, or a tracker
  // could never be connected in the first place.
  test('validates a stored config that deliberately has no credential in it', () => {
    expect(validateIntegration({ provider: 'github', config: { repo: 'acme/site' } })).toMatchObject({ ok: true });
    const jira = { site: 'acme', email: 'ada@acme.com', projectKey: 'P', issueType: 'Task' };
    expect(validateIntegration({ provider: 'jira', config: jira })).toMatchObject({ ok: true });
  });

  test('still refuses a stored config whose own fields are wrong', () => {
    expect(validateIntegration({ provider: 'github', config: { repo: 'nope' } })).toMatchObject({ ok: false });
    expect(validateIntegration({ provider: 'jira', config: { site: 'a.atlassian.net' } })).toMatchObject({ ok: false });
  });
});

/**
 * The runtime rejects `redirect: 'error'` outright, so every send threw and was
 * swallowed. Nothing surfaced it: `deliver` catches by contract, and there is no
 * logging by design. This pins the two properties that would have caught it.
 */
describe('outbound redirect handling', () => {
  test('asks for a redirect mode the runtime actually implements', async () => {
    let seen: RequestInit | undefined;
    await withFetch(
      (_url, init) => {
        seen = init;
        return new Response('{}', { status: 200 });
      },
      async () => {
        await deliverOne(githubArgs);
        // workerd: 'error' throws, and 'follow' would carry the credential to a
        // host the allowlist never approved.
        expect(seen?.redirect).toBe('manual');
      },
    );
  });

  test('counts a redirect as a failure rather than chasing it', async () => {
    await withFetch(
      () => new Response(null, { status: 302, headers: { Location: 'https://evil.test/' } }),
      async () => {
        expect(await deliverOne(githubArgs)).toEqual({ ok: false, reason: 'GitHub redirected the request' });
      },
    );
  });
});
