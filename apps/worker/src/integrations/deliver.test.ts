import { describe, expect, test } from 'bun:test';
import { isAllowedUrl, parseIntegrations, validateIntegration } from './deliver';
import { PROVIDERS, providerById } from './providers';

const SLACK_HOSTS = PROVIDERS.slack.allowedHosts;

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
    expect(providerById('jira')).toBeNull();
    // Object.hasOwn, not `in`, so a prototype key cannot resolve to a provider.
    expect(providerById('toString')).toBeNull();
    expect(providerById('__proto__')).toBeNull();
  });
});
