import { describe, expect, test } from 'bun:test';
import { buildMimeMessage } from './mime';
import { signInTemplate } from './templates';

describe('buildMimeMessage', () => {
  const message = { to: 'someone@example.com', subject: 'Sign in', text: 'plain', html: '<p>rich</p>' };

  test('uses CRLF line endings, which SMTP requires', () => {
    const raw = buildMimeMessage({ from: 'login@marklayer.app', message });
    expect(raw).toContain('\r\n');
    expect(raw.split('\r\n').some((line) => line.endsWith('\n'))).toBe(false);
  });

  test('carries both alternatives, so HTML-only spam scoring cannot bury a login link', () => {
    const raw = buildMimeMessage({ from: 'login@marklayer.app', message });
    expect(raw).toContain('multipart/alternative');
    expect(raw).toContain('text/plain; charset=utf-8');
    expect(raw).toContain('text/html; charset=utf-8');
  });

  test('closes the multipart with the terminating boundary', () => {
    const raw = buildMimeMessage({ from: 'login@marklayer.app', message });
    const boundary = raw.match(/boundary="([^"]+)"/)?.[1];
    expect(boundary).toBeDefined();
    expect(raw).toContain(`--${boundary}--`);
  });

  test('wraps base64 inside SMTP line limits and encodes a non-ASCII subject', () => {
    const raw = buildMimeMessage({
      from: 'login@marklayer.app',
      message: { ...message, subject: 'Zaloguj się', text: 'x'.repeat(500) },
    });
    expect(raw).toContain('=?utf-8?B?');
    expect(raw.split('\r\n').every((line) => line.length <= 998)).toBe(true);
  });
});

describe('signInTemplate', () => {
  const rendered = signInTemplate.render({ link: 'https://marklayer.app/auth/verify?token=abc' });

  test('renders the email doctype and table layout that clients need', () => {
    // XHTML 1.0 Transitional plus presentation tables is what React Email emits
    // and what Outlook needs; a plain HTML5 doctype here would be the sign that
    // the shared Layout was bypassed.
    expect(rendered.html).toStartWith('<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN"');
    expect(rendered.html).toContain('role="presentation"');
    expect(rendered.html).toContain('marklayer.app');
  });

  test('applies the app brand token rather than a stock default', () => {
    // --color-ml-fg is #1a1a1a in apps/worker/web/style.css. If the build's
    // token parsing silently stops working, the link reverts to React Email's
    // default blue and nothing else fails — so assert the colour directly.
    expect(rendered.html).toContain('color:rgb(26,26,26)');
  });

  test('carries the link in both the anchor and as bare text', () => {
    // Some clients strip the anchor; a login email with no visible URL is a
    // dead end for the person holding it.
    expect(rendered.html).toContain('href="https://marklayer.app/auth/verify?token=abc"');
    expect(rendered.html.split('https://marklayer.app/auth/verify?token=abc').length - 1).toBeGreaterThan(1);
    expect(rendered.text).toContain('https://marklayer.app/auth/verify?token=abc');
  });

  test('produces a plain-text alternative that is not markup', () => {
    expect(rendered.text).not.toContain('<');
  });
});
