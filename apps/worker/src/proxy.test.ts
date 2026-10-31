import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  fetchPage,
  fetchWithHeaderTimeout,
  isChallenged,
  isRefusedSubResource,
  peekBody,
  proxy,
  relayFetch,
  resetRelayBreaker,
} from './proxy';

/** A body delivered in fixed-size chunks, so the peek boundary lands mid-stream. */
function streamOf(text: string, chunkSize: number): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.slice(offset, offset + chunkSize));
      offset += chunkSize;
    },
  });
}

const read = async (stream: ReadableStream<Uint8Array>) => new Response(stream).text();

describe('peekBody', () => {
  test('a body longer than the peek window survives intact', async () => {
    const body = `<html><head><title>hi</title></head><body>${'x'.repeat(20_000)}</body></html>`;
    const { head, stream } = await peekBody(streamOf(body, 512));
    expect(head.length).toBeGreaterThanOrEqual(4096);
    expect(body.startsWith(head)).toBe(true);
    expect(await read(stream)).toBe(body);
  });

  test('a body shorter than the peek window survives intact', async () => {
    const body = '<html><head><meta http-equiv="refresh" content="0;/.well-known/sgcaptcha/"></head></html>';
    const { head, stream } = await peekBody(streamOf(body, 16));
    expect(head).toBe(body);
    expect(await read(stream)).toBe(body);
  });

  test('an empty body yields an empty head and closes', async () => {
    const { head, stream } = await peekBody(streamOf('', 8));
    expect(head).toBe('');
    expect(await read(stream)).toBe('');
  });

  test('a multi-byte character split across chunks is not mangled', async () => {
    // The bytes of "é" land in different chunks; a non-streaming decode would
    // put a replacement character in the head and mis-read the markup after it.
    const body = `<title>café — 日本語</title>${'y'.repeat(9000)}`;
    const { head, stream } = await peekBody(streamOf(body, 3));
    expect(head).toContain('café');
    expect(head).not.toContain('�');
    expect(await read(stream)).toBe(body);
  });
});

describe('isChallenged', () => {
  test('a SiteGround captcha redirect served as 202', () => {
    const head = '<html><head><meta http-equiv="refresh" content="0;/.well-known/sgcaptcha/?r=%2F"></head></html>';
    expect(isChallenged({ status: 202, head })).toBe(true);
  });

  test('a Cloudflare interstitial by title', () => {
    expect(isChallenged({ status: 200, head: '<html><head><title>Just a moment...</title>' })).toBe(true);
  });

  test.each([401, 403, 429, 503])('a %i refusal', (status) => {
    expect(isChallenged({ status, head: '<html><body>nope</body></html>' })).toBe(true);
  });

  test('an ordinary page is not challenged', () => {
    expect(isChallenged({ status: 200, head: '<html><head><title>iot450</title></head>' })).toBe(false);
  });

  test('a real 404 is left alone — retrying it elsewhere would still 404', () => {
    expect(isChallenged({ status: 404, head: '<html><title>Not found</title>' })).toBe(false);
  });
});

describe('relayFetch — surviving a relay that is gone', () => {
  const env = { FETCHER_URL: 'https://relay.invalid', FETCHER_TOKEN: 'tok' };
  const realFetch = globalThis.fetch;

  /** `fetch` carries a `preconnect` method, so a bare function is not assignable — borrow the real one. */
  function stubFetch(impl: () => Promise<Response>): void {
    globalThis.fetch = Object.assign(impl, { preconnect: realFetch.preconnect });
  }

  beforeEach(() => resetRelayBreaker());
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test('an unreachable relay yields null rather than throwing', async () => {
    stubFetch(() => Promise.reject(new Error('connection refused')));
    expect(await relayFetch({ url: 'https://iot450.com/', env })).toBeNull();
  });

  test('the breaker stops calling a dead relay after three failures', async () => {
    let calls = 0;
    stubFetch(() => {
      calls++;
      return Promise.reject(new Error('connection refused'));
    });

    for (let i = 0; i < 10; i++) await relayFetch({ url: 'https://iot450.com/', env });

    // Cancelling the Fly account must cost three slow requests a minute, not ten.
    expect(calls).toBe(3);
  });

  test('a relay that answers resets the failure count', async () => {
    let calls = 0;
    stubFetch(() => {
      calls++;
      // Fail, fail, succeed, repeated: never three in a row, so never tripped.
      return calls % 3 === 0
        ? Promise.resolve(new Response('<html></html>', { headers: { 'x-ml-relay': 'ok' } }))
        : Promise.reject(new Error('flaky'));
    });

    for (let i = 0; i < 9; i++) await relayFetch({ url: 'https://iot450.com/', env });
    expect(calls).toBe(9);
  });

  test('FETCHER_ENABLED=false turns the fallback off without touching the secrets', async () => {
    let called = false;
    stubFetch(() => {
      called = true;
      return Promise.resolve(new Response(''));
    });

    expect(await relayFetch({ url: 'https://iot450.com/', env: { ...env, FETCHER_ENABLED: 'false' } })).toBeNull();
    expect(called).toBe(false);
  });

  test('no relay configured is a silent no-op', async () => {
    let called = false;
    stubFetch(() => {
      called = true;
      return Promise.resolve(new Response(''));
    });

    expect(await relayFetch({ url: 'https://iot450.com/', env: {} })).toBeNull();
    expect(called).toBe(false);
  });

  test('a relay answering without the ok header is not treated as a page', async () => {
    stubFetch(() => Promise.resolve(Response.json({ error: 'blocked host' }, { status: 400 })));
    expect(await relayFetch({ url: 'https://iot450.com/', env })).toBeNull();
  });
});

describe('isRefusedSubResource', () => {
  const res = ({ status = 200, type = 'text/css' }: { status?: number; type?: number | string } = {}) =>
    new Response('', { status, headers: { 'content-type': String(type) } });

  test("SiteGround's 202 challenge, which no status list catches", () => {
    // The status is not a refusal code and never will be; the stylesheet coming
    // back as HTML is the whole signal. Without this a relayed page renders bare.
    expect(isRefusedSubResource({ resp: res({ status: 202, type: 'text/html' }), accept: 'text/css,*/*;q=0.1' })).toBe(
      true,
    );
  });

  test('a refusal status', () => {
    expect(isRefusedSubResource({ resp: res({ status: 403 }), accept: 'text/css,*/*;q=0.1' })).toBe(true);
  });

  test('a real stylesheet is served, not refused', () => {
    expect(isRefusedSubResource({ resp: res(), accept: 'text/css,*/*;q=0.1' })).toBe(false);
  });

  test('an iframe asking for HTML and getting HTML is not a refusal', () => {
    expect(isRefusedSubResource({ resp: res({ type: 'text/html' }), accept: 'text/html,application/xhtml+xml' })).toBe(
      false,
    );
  });

  test('a missing Accept header does not turn an HTML response into a refusal by itself', () => {
    expect(isRefusedSubResource({ resp: res({ status: 200, type: 'image/png' }), accept: undefined })).toBe(false);
  });
});

describe('fetchWithHeaderTimeout', () => {
  /** Serve one response, controlling headers and body timing independently. */
  function serve({ headerDelayMs, chunks }: { headerDelayMs: number; chunks: string[] }) {
    return Bun.serve({
      port: 0,
      async fetch() {
        if (headerDelayMs > 0) await Bun.sleep(headerDelayMs);
        return new Response(
          new ReadableStream({
            async pull(controller) {
              for (const chunk of chunks) {
                await Bun.sleep(200);
                controller.enqueue(new TextEncoder().encode(chunk));
              }
              controller.close();
            },
          }),
          { headers: { 'content-type': 'text/html' } },
        );
      },
    });
  }

  test('a body that streams for longer than the timeout still arrives whole', async () => {
    // The regression this exists for: `AbortSignal.timeout` keeps firing after the
    // response resolves, so it truncates any page that streams its HTML slowly —
    // and a half-document arrives with no marker, turning a page that renders into
    // a reported failure. Headers are instant here; the body outlasts the bound.
    const server = serve({ headerDelayMs: 0, chunks: ['<html><head></head><body>', 'a'.repeat(64), '</body></html>'] });
    try {
      const resp = await fetchWithHeaderTimeout({ url: server.url.href, init: {}, timeoutMs: 300 });
      expect(await resp.text()).toBe(`<html><head></head><body>${'a'.repeat(64)}</body></html>`);
    } finally {
      await server.stop(true);
    }
  });

  test('a host that never answers is abandoned at the bound', async () => {
    const server = serve({ headerDelayMs: 1500, chunks: ['ignored'] });
    try {
      await expect(fetchWithHeaderTimeout({ url: server.url.href, init: {}, timeoutMs: 150 })).rejects.toThrow();
    } finally {
      await server.stop(true);
    }
  });
});

describe('isChallenged — interstitials with no status, path or title tell', () => {
  // The regression: these came back as a plain 200 with an empty title, so the
  // proxy marked them a success and the challenge's own script then navigated the
  // frame off-origin, leaving the viewer a blank box. Detecting them is what lets
  // the relay retry and, failing that, what makes the failure screen honest.
  const cases: Array<[string, string]> = [
    ['cloudflare challenge container', '<html><head><title></title></head><body><div id="challenge-container"></div>'],
    ['cloudflare challenge form', '<html><body><form id="challenge-form" action="/cdn-cgi/l/chk"></form>'],
    ['perimeterx', '<html><body><div id="px-captcha"></div>'],
    ['datadome', '<html><body><iframe src="https://geo.captcha-delivery.com/captcha/?initialCid=x">'],
    ['aws waf', '<html><head><script src="https://token.awswaf.com/token.js"></script>'],
  ];
  for (const [name, head] of cases) {
    test(`${name} is a challenge, not a page`, () => {
      expect(isChallenged({ status: 200, head })).toBe(true);
    });
  }

  test('a page that merely mentions a WAF vendor is still a page', () => {
    const head =
      '<html><head><title>How Cloudflare challenges work</title></head><body><p>A challenge container is…</p>';
    expect(isChallenged({ status: 200, head })).toBe(false);
  });
});

const realFetchForRoutes = globalThis.fetch;

/** Serve every upstream fetch from `respond`, then GET `/proxy` with no bindings (so no relay). */
async function getProxy({ query, respond }: { query: string; respond: () => Response }): Promise<Response> {
  globalThis.fetch = Object.assign(async () => respond(), { preconnect: realFetchForRoutes.preconnect });
  return proxy.request(
    `/proxy?${query}`,
    {},
    // biome-ignore lint/suspicious/noExplicitAny: a fake env with no bindings; the route only reads optional ones.
    {} as any,
    // biome-ignore lint/suspicious/noExplicitAny: ditto for the execution context.
    { waitUntil() {}, passThroughOnException() {} } as any,
  );
}

describe("GET /proxy — a stranger's non-HTML bytes", () => {
  afterEach(() => {
    globalThis.fetch = realFetchForRoutes;
  });

  const get = ({ query, body, type }: { query: string; body: string; type: string }) =>
    getProxy({ query, respond: () => new Response(body, { headers: { 'content-type': type } }) });

  test('come back sandboxed', async () => {
    const target = encodeURIComponent('https://example.com/x.svg');
    for (const query of [`url=${target}&raw=1`, `url=${target}`]) {
      const res = await get({ query, body: '<svg onload=alert(1)>', type: 'image/svg+xml' });
      expect(res.headers.get('content-security-policy')).toContain('sandbox');
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(res.headers.get('content-type')).toBe('image/svg+xml');
    }
  });

  test('a PDF without raw is handed to the document viewer', async () => {
    const res = await get({
      query: `url=${encodeURIComponent('https://example.com/a.pdf')}`,
      body: '%PDF-1.4',
      type: 'application/pdf',
    });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/doc?url=https%3A%2F%2Fexample.com%2Fa.pdf');
  });
});

describe('GET /proxy — naming the firewall that refused us', () => {
  afterEach(() => {
    globalThis.fetch = realFetchForRoutes;
  });

  const blockedBy = async (respond: () => Response) =>
    (await getProxy({ query: `url=${encodeURIComponent('https://example.com/')}`, respond })).text();

  test("SiteGround's challenge is named, so the owner is told it can't be fixed from their side", async () => {
    const body = await blockedBy(
      () =>
        new Response(
          '<html><head><meta http-equiv="refresh" content="0;/.well-known/sgcaptcha/?r=%2F"></head></html>',
          {
            status: 202,
            headers: { 'content-type': 'text/html', 'sg-captcha': 'challenge' },
          },
        ),
    );
    expect(body).toContain('firewall:"siteground"');
  });

  test('any other firewall gets the generic advice', async () => {
    const body = await blockedBy(
      () =>
        new Response('<html><head><title>Just a moment...</title></head></html>', {
          status: 403,
          headers: { 'content-type': 'text/html' },
        }),
    );
    expect(body).toContain('reason:"firewall"');
    expect(body).toContain('firewall:null');
  });
});

describe('fetchPage — leaving a host alone once it refuses the relay too', () => {
  const relay = { FETCHER_URL: 'https://relay.invalid', FETCHER_TOKEN: 'tok' };
  // biome-ignore lint/suspicious/noExplicitAny: only the relay bindings are read.
  const env = relay as any;
  const challenge = '<html><head><meta http-equiv="refresh" content="0;/.well-known/sgcaptcha/?r=%2F"></head></html>';
  let relayCalls = 0;

  beforeEach(() => {
    resetRelayBreaker();
    relayCalls = 0;
    globalThis.fetch = Object.assign(
      async (input: RequestInfo | URL) => {
        const relayed = String(input).startsWith(relay.FETCHER_URL);
        if (relayed) relayCalls++;
        const asset = String(input).includes('missing.png');
        return new Response(asset ? '<html>Not found</html>' : challenge, {
          status: asset ? 404 : 202,
          headers: { 'content-type': 'text/html', ...(relayed ? { 'x-ml-relay': 'ok' } : {}) },
        });
      },
      { preconnect: realFetchForRoutes.preconnect },
    );
  });
  afterEach(() => {
    globalThis.fetch = realFetchForRoutes;
  });

  test('a second view of a host that challenged the relay does not knock again', async () => {
    // Repeat refusals from our one IP are what got it flagged across SiteGround's whole network.
    expect((await fetchPage({ url: 'https://flagged.example/', env })).challenged).toBe(true);
    expect((await fetchPage({ url: 'https://flagged.example/other', env })).challenged).toBe(true);
    expect(relayCalls).toBe(1);

    await fetchPage({ url: 'https://another.example/', env });
    expect(relayCalls).toBe(2);
  });

  test("one missing asset doesn't stop the relay rescuing the host's pages", async () => {
    // A 404 page for a stray image is HTML answering a non-HTML request, from the relay as much as direct.
    await proxy.request(
      '/px/flagged.example/missing.png',
      { headers: { Accept: 'image/avif,image/webp,*/*' } },
      env,
      // biome-ignore lint/suspicious/noExplicitAny: a fake execution context.
      { waitUntil() {}, passThroughOnException() {} } as any,
    );
    expect(relayCalls).toBe(1);

    await fetchPage({ url: 'https://flagged.example/', env });
    expect(relayCalls).toBe(2);
  });
});

describe('GET /proxy — entity-encoded attribute URLs (#4)', () => {
  afterEach(() => {
    globalThis.fetch = realFetchForRoutes;
  });

  const rewrite = async (html: string) =>
    (
      await getProxy({
        query: `url=${encodeURIComponent('https://example.com/')}`,
        respond: () => new Response(html, { headers: { 'content-type': 'text/html' } }),
      })
    ).text();

  test('srcset and src are decoded before rewriting, as the browser would read them', async () => {
    // Twig's html_attr escaper output.
    const body = await rewrite(
      '<img src="https&#x3A;&#x2F;&#x2F;example.com&#x2F;a.webp" srcset="https&#x3A;&#x2F;&#x2F;example.com&#x2F;a.webp 683w, &#x2F;b.webp 1024w">',
    );
    expect(body).toContain('src="http://localhost/px/example.com/a.webp"');
    expect(body).toContain(
      'srcset="http://localhost/px/example.com/a.webp 683w, http://localhost/px/example.com/b.webp 1024w"',
    );
  });

  test('an ampersand in a rewritten query is re-escaped, so &copy= stays a parameter', async () => {
    const body = await rewrite('<img src="/i.png?a=1&amp;copy=2">');
    expect(body).toContain('src="http://localhost/px/example.com/i.png?a=1&amp;copy=2"');
  });
});

describe('fetchPage — meta-refresh redirect stubs', () => {
  // biome-ignore lint/suspicious/noExplicitAny: no relay bindings, so a challenge is returned as-is.
  const env = {} as any;
  const page = '<html><head><title>About</title></head><body>the real page</body></html>';
  let fetched: string[] = [];

  const serve = (pages: Record<string, string>) => {
    fetched = [];
    globalThis.fetch = Object.assign(
      async (input: RequestInfo | URL) => {
        const url = String(input);
        fetched.push(url);
        return new Response(pages[url] ?? page, { headers: { 'content-type': 'text/html' } });
      },
      { preconnect: realFetchForRoutes.preconnect },
    );
  };
  const load = async (url: string) => {
    const result = await fetchPage({ url, env });
    return { ...result, body: result.stream ? await read(result.stream) : '' };
  };

  afterEach(() => {
    globalThis.fetch = realFetchForRoutes;
  });

  test("Astro's head-less stub is followed to the page it points at", async () => {
    serve({
      'https://site.example/about':
        '<!doctype html><title>Redirecting to: /about/</title><meta http-equiv="refresh" content="0;url=/about/"><meta name="robots" content="noindex"><body><a href="/about/">Redirecting</a></body>',
    });
    const result = await load('https://site.example/about');
    expect(result.finalUrl).toBe('https://site.example/about/');
    expect(result.body).toContain('the real page');
  });

  test('a stub with a head and its own redirect script is followed too', async () => {
    serve({
      'https://site.example/about':
        "<html><head><META HTTP-EQUIV='Refresh' CONTENT=\"0; URL='/about/'\"><script>location.replace('/about/')</script></head></html>",
    });
    const result = await load('https://site.example/about');
    expect(result.finalUrl).toBe('https://site.example/about/');
    expect(result.body).toContain('the real page');
  });

  test('a delayed refresh is the page, not a stub', async () => {
    serve({ 'https://site.example/a': '<html><head><meta http-equiv="refresh" content="5;url=/b"></head></html>' });
    expect((await load('https://site.example/a')).finalUrl).toBe('https://site.example/a');
    expect(fetched).toEqual(['https://site.example/a']);
  });

  test('a refresh to another host is left for the frame', async () => {
    serve({ 'https://site.example/a': '<meta http-equiv="refresh" content="0;url=https://other.example/">' });
    expect((await load('https://site.example/a')).finalUrl).toBe('https://site.example/a');
    expect(fetched).toEqual(['https://site.example/a']);
  });

  test('a refresh loop stops after three hops', async () => {
    serve({
      'https://site.example/a': '<meta http-equiv="refresh" content="0;url=/b">',
      'https://site.example/b': '<meta http-equiv="refresh" content="0;url=/a">',
    });
    await load('https://site.example/a');
    expect(fetched).toHaveLength(4);
  });

  test("a challenge's refresh to its CAPTCHA is still reported as a challenge", async () => {
    serve({
      'https://site.example/':
        '<html><head><meta http-equiv="refresh" content="0;/.well-known/sgcaptcha/?r=%2F"></head></html>',
    });
    const result = await load('https://site.example/');
    expect(result.challenged).toBe(true);
    expect(result.firewall).toBe('siteground');
    expect(result.finalUrl).toBe('https://site.example/');
    expect(fetched).toEqual(['https://site.example/']);
  });
});
