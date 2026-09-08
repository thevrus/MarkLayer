import { describe, expect, test } from 'bun:test';
import { fill, inviteEmail, signInEmail } from './index';

describe('fill', () => {
  test('escapes a substituted value in the html copy but leaves the text copy raw', () => {
    // A real value would never carry markup, but the escaping exists precisely
    // so a value that does (an `&` in a query string, say) can't break the
    // markup around it — assert that guard directly, not just the happy path.
    const link = 'https://marklayer.app/a?x=1&y=2&name=<b>"quote"</b>';
    const { html, text } = fill({ template: signInEmail, values: { link } });
    expect(html).toContain('https://marklayer.app/a?x=1&amp;y=2&amp;name=&lt;b&gt;&quot;quote&quot;&lt;/b&gt;');
    expect(html).not.toContain(link);
    expect(text).toContain(link);
  });

  test('replaces every occurrence of a placeholder, not just the first', () => {
    // Both templates print {{link}} twice (the button href and the plain-text
    // fallback address) — replaceAll is load-bearing, not incidental.
    const link = 'https://marklayer.app/x';
    const { html } = fill({ template: signInEmail, values: { link } });
    expect(html.split(link).length - 1).toBeGreaterThan(1);
  });

  test('throws rather than mailing a literal {{token}} when a value is missing', () => {
    // Bypassing the type system on purpose: this simulates the untyped runtime
    // input `values` guards against (a caller that skipped `EmailTemplate`'s
    // typed `render`), matching the `as`-in-tests precedent elsewhere in the
    // repo (apps/worker/src/auth/auth.test.ts, api.test.ts).
    const values = {} as unknown as Readonly<Record<'link', string>>;
    expect(() => fill({ template: signInEmail, values })).toThrow('unsubstituted placeholder');
  });

  test('renders inviteEmail too, not just signInEmail', () => {
    const { html, text, subject } = fill({ template: inviteEmail, values: { link: 'https://marklayer.app/i' } });
    expect(subject).toBe(inviteEmail.subject);
    expect(html).toContain('https://marklayer.app/i');
    expect(text).toContain('https://marklayer.app/i');
  });
});
