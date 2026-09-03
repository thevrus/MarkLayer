import { describe, expect, test } from 'bun:test';
import { blockedDomain, captureServer } from './posthog';

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

describe('captureServer', () => {
  const env = { POSTHOG_KEY: 'phc_test', POSTHOG_HOST: 'https://ph.test' };
  const noopCtx = { waitUntil() {} };

  /**
   * Swap in a stand-in for global fetch for the duration of one test. Built with
   * Object.assign rather than a cast because Bun's `fetch` carries a
   * `preconnect` method that a bare arrow function does not.
   */
  async function withStubbedFetch(impl: () => Promise<Response>, run: () => Promise<void>) {
    const real = globalThis.fetch;
    globalThis.fetch = Object.assign(impl, { preconnect: real.preconnect });
    try {
      await run();
    } finally {
      globalThis.fetch = real;
    }
  }

  test('resolves only once the capture has actually been sent', async () => {
    // A Durable Object has nothing keeping it alive after its last socket closes,
    // so `waitUntil` cannot be trusted to finish the POST. The awaited return
    // value is what makes the room's session and agent events survive that.
    let release = () => {};
    const inFlight = new Promise<Response>((resolve) => {
      release = () => resolve(new Response(null, { status: 200 }));
    });
    await withStubbedFetch(
      () => inFlight,
      async () => {
        let settled = false;
        const sent = captureServer(env, noopCtx, 'agent_left', { ops_total: 3 }).then(() => {
          settled = true;
        });
        await Promise.resolve();
        expect(settled).toBe(false);
        release();
        await sent;
        expect(settled).toBe(true);
      },
    );
  });

  test('resolves rather than rejects when the capture fails', async () => {
    // Telemetry must never take a room's teardown down with it.
    await withStubbedFetch(
      () => Promise.reject(new Error('network down')),
      async () => {
        expect(await captureServer(env, noopCtx, 'agent_left', {}).then(() => 'resolved')).toBe('resolved');
      },
    );
  });

  test('resolves without a key, so a self-hosted deployment never blocks', async () => {
    let called = false;
    await withStubbedFetch(
      () => {
        called = true;
        return Promise.resolve(new Response(null));
      },
      async () => {
        await captureServer({}, noopCtx, 'agent_left', {});
        expect(called).toBe(false);
      },
    );
  });
});
