import { describe, expect, test } from 'bun:test';
import { mailerFor } from './providers';
import { signInTemplate } from './templates';

describe('mailerFor', () => {
  const binding = {
    async send() {
      return { messageId: 'x' };
    },
  };

  test('picks the configured provider when MAIL_PROVIDER is unset', () => {
    expect(mailerFor({}).id).toBe('console');
    expect(mailerFor({ RESEND_API_KEY: 'k' }).id).toBe('resend');
    expect(mailerFor({ EMAIL: binding, RESEND_API_KEY: 'k' }).id).toBe('cloudflare');
  });

  test('MAIL_PROVIDER overrides that order, so a switch is one variable', () => {
    expect(mailerFor({ MAIL_PROVIDER: 'resend', EMAIL: binding, RESEND_API_KEY: 'k' }).id).toBe('resend');
    expect(mailerFor({ MAIL_PROVIDER: 'console', EMAIL: binding }).id).toBe('console');
  });

  test('throws rather than degrading to the console when the pinned provider is unconfigured', () => {
    // The whole point of pinning: a deploy that loses its binding must fail the
    // send, not print login links to the log while answering 200.
    expect(() => mailerFor({ MAIL_PROVIDER: 'cloudflare' })).toThrow();
    expect(() => mailerFor({ MAIL_PROVIDER: 'resend' })).toThrow();
    expect(() => mailerFor({ MAIL_PROVIDER: 'sendgrid', EMAIL: binding })).toThrow();
  });

  test('sends through the binding with a named from address', async () => {
    const sent: unknown[] = [];
    const capture = {
      async send(message: unknown) {
        sent.push(message);
        return { messageId: 'x' };
      },
    };
    await mailerFor({ EMAIL: capture, MAIL_FROM: 'login@marklayer.app' }).send({
      to: 'someone@example.com',
      subject: 'Sign in',
      text: 'plain',
      html: '<p>rich</p>',
    });
    expect(sent[0]).toEqual({
      from: { email: 'login@marklayer.app', name: 'MarkLayer' },
      to: 'someone@example.com',
      subject: 'Sign in',
      text: 'plain',
      html: '<p>rich</p>',
    });
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
