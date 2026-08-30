import { describe, expect, test } from 'bun:test';
import { blockedDomain } from './posthog';

describe('blockedDomain', () => {
  test('reduces a subdomain to the site someone can be written to about', () => {
    // The subdomain is the part that leaks — an unlisted staging environment is
    // named by it — and the registrable domain is the part with a support inbox.
    expect(blockedDomain('https://staging-x9f2.acme.com/internal/board?token=abc')).toBe('acme.com');
    expect(blockedDomain('https://www.example.com/')).toBe('example.com');
    expect(blockedDomain('https://example.com')).toBe('example.com');
  });

  test('keeps three labels where the second level is a registry suffix', () => {
    expect(blockedDomain('https://www.bbc.co.uk/news')).toBe('bbc.co.uk');
    expect(blockedDomain('https://shop.myer.com.au')).toBe('myer.com.au');
  });

  test('does not mistake a two-label ccTLD name for a registry suffix', () => {
    expect(blockedDomain('https://co.uk')).toBe('co.uk');
    expect(blockedDomain('https://news.ycombinator.com')).toBe('ycombinator.com');
  });

  test('reports nothing for a target that is private, internal, or not a site', () => {
    expect(blockedDomain('http://localhost:3000/app')).toBeNull();
    expect(blockedDomain('http://192.168.1.10/')).toBeNull();
    expect(blockedDomain('https://build.internal/ci')).toBeNull();
    // A public IP still names one machine, so there is nobody to reach out to.
    expect(blockedDomain('https://93.184.216.34/')).toBeNull();
    expect(blockedDomain('file:///etc/passwd')).toBeNull();
    expect(blockedDomain('not a url')).toBeNull();
  });
});
