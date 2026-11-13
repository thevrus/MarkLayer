import { describe, expect, test } from 'bun:test';
import { type FrameMessage, frameMessageSchema, hasFrameMarker } from '../../../shared/frame-protocol';
import { fakeEnv } from '../../test-env';
import type { FetchedPage } from '../fetch';
import { injectedHead } from '.';

const SELF = 'https://marklayer.test';

const page = (over: Partial<FetchedPage> = {}): FetchedPage => ({
  status: 200,
  contentType: 'text/html',
  finalUrl: 'https://example.com/a',
  stream: null,
  via: 'direct',
  challenged: false,
  firewall: null,
  egressIp: null,
  refreshTo: null,
  ...over,
});

/** Runs the real injected scripts, in order, against the few browser objects they touch. */
function run({ resp = page(), url = 'https://example.com/a' }: { resp?: FetchedPage; url?: string } = {}) {
  const posted: Array<{ message: unknown; target: string }> = [];
  const windowListeners = new Map<string, (e: object) => void>();
  const fetched: string[] = [];
  const dataset: Record<string, string> = {};
  const fakeWindow = {
    parent: { postMessage: (message: unknown, target: string) => posted.push({ message, target }) },
    addEventListener: (type: string, listener: (e: object) => void) => windowListeners.set(type, listener),
    fetch: (input: string) => {
      fetched.push(input);
      const status = input.includes('/bad') ? 503 : 200;
      return Promise.resolve({ ok: status < 400, status });
    },
  };
  const fakeDocument = { documentElement: { dataset }, baseURI: 'https://example.com/a', addEventListener: () => {} };
  const fakeHistory = { replaceState: () => {}, pushState: () => {} };
  class FakeXhr {
    open() {}
  }
  const html = injectedHead({ resp, baseUrl: new URL(url), selfOrigin: SELF, env: fakeEnv() });
  for (const [, body] of html.matchAll(/<script>(.*?)<\/script>/gs)) {
    new Function('window', 'document', 'history', 'navigator', 'location', 'XMLHttpRequest', body ?? '')(
      fakeWindow,
      fakeDocument,
      fakeHistory,
      {},
      { href: `${SELF}/a`, origin: SELF },
      FakeXhr,
    );
  }
  const press = (target: object) =>
    windowListeners.get('keydown')?.({
      key: 'k',
      code: 'KeyK',
      metaKey: false,
      ctrlKey: true,
      shiftKey: false,
      altKey: false,
      composedPath: () => [target],
    });
  return { posted, fakeWindow, fetched, dataset, press };
}

const parsed = (message: unknown): FrameMessage => frameMessageSchema.parse(message);
const typesOf = (posted: Array<{ message: unknown }>) => posted.map(({ message }) => parsed(message).type);

describe('the injected block', () => {
  test('stamps the marker the frame protocol reads', () => {
    const { dataset } = run();
    expect(hasFrameMarker({ documentElement: { dataset } })).toBe(true);
  });

  test('a page that arrived posts ml-ready and no refusal', () => {
    expect(typesOf(run().posted)).toEqual(['ml-ready']);
  });

  test('a refused page tells the viewer why before it says ready', () => {
    const { posted } = run({ resp: page({ challenged: true, firewall: 'siteground', egressIp: '203.0.113.1' }) });
    expect(typesOf(posted)).toEqual(['ml-blocked', 'ml-ready']);
    // The shape today's Viewer reads, field for field.
    expect(posted[0]?.message).toEqual({
      type: 'ml-blocked',
      reason: 'firewall',
      status: 200,
      via: 'direct',
      ip: '203.0.113.1',
      firewall: 'siteground',
    });
  });

  test('nothing is posted to anyone but the viewer', () => {
    const { posted, press } = run({ resp: page({ status: 500 }) });
    press({ nodeType: 1, tagName: 'DIV' });
    expect(posted.length).toBeGreaterThan(2);
    expect(new Set(posted.map(({ target }) => target))).toEqual(new Set([SELF]));
  });

  test.each([
    ['an input', { nodeType: 1, tagName: 'INPUT' }, true],
    ['a textarea', { nodeType: 1, tagName: 'TEXTAREA' }, true],
    ['a select', { nodeType: 1, tagName: 'SELECT' }, true],
    ['a contenteditable', { nodeType: 1, tagName: 'DIV', isContentEditable: true }, true],
    ['a plain element', { nodeType: 1, tagName: 'DIV', isContentEditable: false }, false],
    ['the document', { nodeType: 9 }, false],
  ])('a key aimed at %s', (_, target, editable) => {
    const { posted, press } = run();
    press(target);
    expect(parsed(posted.at(-1)?.message)).toMatchObject({ type: 'ml-key', phase: 'keydown', key: 'k', editable });
  });

  test("an http page's calls go out over http, an https page's as they always did", () => {
    const http = run({ url: 'http://plain.example/a' });
    http.fakeWindow.fetch('http://other.example/x');
    http.fakeWindow.fetch('/api2/y');
    expect(http.fetched).toEqual([`${SELF}/px/http/other.example/x`, `${SELF}/px/http/plain.example/api2/y`]);

    const https = run();
    https.fakeWindow.fetch('http://other.example/x');
    https.fakeWindow.fetch('/api2/y');
    expect(https.fetched).toEqual([`${SELF}/px/other.example/x`, `${SELF}/px/example.com/api2/y`]);
  });

  test('captures only a failed request and redacts query and fragment in the proxied page', async () => {
    const { posted, fakeWindow } = run();
    await fakeWindow.fetch('/bad?token=secret#private');
    await fakeWindow.fetch('/ok?token=also-secret');
    await new Promise((resolve) => setTimeout(resolve, 120));
    const report = posted
      .map(({ message }) => message)
      .find(
        (message) =>
          typeof message === 'object' && message !== null && 'type' in message && message.type === 'ml-network-errors',
      );
    expect(report).toMatchObject({
      type: 'ml-network-errors',
      errors: [{ method: 'GET', url: 'https://example.com/bad', status: 503 }],
    });
    expect(JSON.stringify(report)).not.toContain('secret');
  });

  test("the page's own /api and /s calls reach its host, not MarkLayer", () => {
    const { fakeWindow, fetched } = run();
    fakeWindow.fetch('/api/x');
    fakeWindow.fetch('/s/y');
    expect(fetched).toEqual([`${SELF}/px/example.com/api/x`, `${SELF}/px/example.com/s/y`]);
  });

  test('a call already rewritten to /px is left alone', () => {
    const { fakeWindow, fetched } = run();
    fakeWindow.fetch('/px/example.com/a.css');
    expect(fetched).toEqual(['/px/example.com/a.css']);
  });
});
