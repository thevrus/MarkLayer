import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { classifyProxyError, identifyFirewall, PROXY_ERRORS } from '../../shared/proxy-errors';
import { FakeExecutionContext, fakeEnv } from '../test-env';
import { isChallenged, isRefusedSubResource } from './challenge';
import { fetchPage, peekBody } from './fetch';
import { fetchWithHeaderTimeout } from './header-timeout';
import { createRelayBreaker, type RelayBreaker, relayFetch } from './relay';
import { proxy, proxyRoutes } from './routes';

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

  let breaker: RelayBreaker;

  beforeEach(() => {
    breaker = createRelayBreaker();
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test('an unreachable relay yields null rather than throwing', async () => {
    stubFetch(() => Promise.reject(new Error('connection refused')));
    expect(await relayFetch({ url: 'https://iot450.com/', env, breaker })).toBeNull();
  });

  test('the breaker stops calling a dead relay after three failures', async () => {
    let calls = 0;
    stubFetch(() => {
      calls++;
      return Promise.reject(new Error('connection refused'));
    });

    for (let i = 0; i < 10; i++) await relayFetch({ url: 'https://iot450.com/', env, breaker });

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

    for (let i = 0; i < 9; i++) await relayFetch({ url: 'https://iot450.com/', env, breaker });
    expect(calls).toBe(9);
  });

  test('FETCHER_ENABLED=false turns the fallback off without touching the secrets', async () => {
    let called = false;
    stubFetch(() => {
      called = true;
      return Promise.resolve(new Response(''));
    });

    expect(
      await relayFetch({ url: 'https://iot450.com/', env: { ...env, FETCHER_ENABLED: 'false' }, breaker }),
    ).toBeNull();
    expect(called).toBe(false);
  });

  test('no relay configured is a silent no-op', async () => {
    let called = false;
    stubFetch(() => {
      called = true;
      return Promise.resolve(new Response(''));
    });

    expect(await relayFetch({ url: 'https://iot450.com/', env: {}, breaker })).toBeNull();
    expect(called).toBe(false);
  });

  test('a relay answering without the ok header is not treated as a page', async () => {
    stubFetch(() => Promise.resolve(Response.json({ error: 'blocked host' }, { status: 400 })));
    expect(await relayFetch({ url: 'https://iot450.com/', env, breaker })).toBeNull();
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

  // No Accept is not a request for HTML, so the content type decides.
  test('with no Accept header, HTML is a refusal and anything else is served', () => {
    expect(isRefusedSubResource({ resp: res({ type: 'text/html' }), accept: undefined })).toBe(true);
    expect(isRefusedSubResource({ resp: res({ type: 'image/png' }), accept: undefined })).toBe(false);
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
  return proxy.request(`/proxy?${query}`, {}, fakeEnv(), new FakeExecutionContext());
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
  const env = fakeEnv(relay);
  const challenge = '<html><head><meta http-equiv="refresh" content="0;/.well-known/sgcaptcha/?r=%2F"></head></html>';
  let relayCalls = 0;
  let breaker: RelayBreaker;

  beforeEach(() => {
    breaker = createRelayBreaker();
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
    expect((await fetchPage({ url: 'https://flagged.example/', env, breaker })).challenged).toBe(true);
    expect((await fetchPage({ url: 'https://flagged.example/other', env, breaker })).challenged).toBe(true);
    expect(relayCalls).toBe(1);

    await fetchPage({ url: 'https://another.example/', env, breaker });
    expect(relayCalls).toBe(2);
  });

  test("one missing asset doesn't stop the relay rescuing the host's pages", async () => {
    // A 404 page for a stray image is HTML answering a non-HTML request, from the relay as much as direct.
    await proxyRoutes({ breaker }).request(
      '/px/flagged.example/missing.png',
      { headers: { Accept: 'image/avif,image/webp,*/*' } },
      env,
      new FakeExecutionContext(),
    );
    expect(relayCalls).toBe(1);

    await fetchPage({ url: 'https://flagged.example/', env, breaker });
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
  // No relay bindings, so a challenge is returned as-is.
  const env = fakeEnv();
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

describe('sub-requests carry the same bound as the page', () => {
  let init: RequestInit | undefined;

  beforeEach(() => {
    init = undefined;
    globalThis.fetch = Object.assign(
      async (_input: RequestInfo | URL, given?: RequestInit) => {
        init = given;
        return new Response('body{}', { headers: { 'content-type': 'text/css' } });
      },
      { preconnect: realFetchForRoutes.preconnect },
    );
  });
  afterEach(() => {
    globalThis.fetch = realFetchForRoutes;
  });

  // A signal is the only handle a hung host leaves; waiting out the real 20s bound would not fit in a unit test.
  test('W24 a /px sub-resource fetch can be aborted', async () => {
    const res = await proxy.request('/px/example.com/a.css', {}, fakeEnv(), new FakeExecutionContext());
    expect(res.status).toBe(200);
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  test('W24 a catch-all fetch from a proxied page can be aborted', async () => {
    const res = await proxy.request(
      '/assets/app.css',
      { headers: { Referer: 'https://marklayer.app/proxy?url=https%3A%2F%2Fexample.com%2F' } },
      fakeEnv(),
      new FakeExecutionContext(),
    );
    expect(res.status).toBe(200);
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });
});

describe('classifying what the proxy served', () => {
  test('every error it can serve has a label, so none reports as unrecognized', () => {
    for (const { message, label } of Object.values(PROXY_ERRORS)) expect(classifyProxyError(message)).toBe(label);
  });

  test('a rate-limited page says so', async () => {
    const env = fakeEnv({ FETCH_LIMITER: { limit: async () => ({ success: false }) } });
    const res = await proxy.request(
      `/proxy?url=${encodeURIComponent('https://example.com/')}`,
      {},
      env,
      new FakeExecutionContext(),
    );
    expect(res.status).toBe(429);
    expect(classifyProxyError(await res.text())).toBe('too-many-requests');
  });
});

describe('identifyFirewall', () => {
  test('a header alone names it, and no tell names nothing', () => {
    expect(identifyFirewall({ headers: new Headers({ 'sg-captcha': 'challenge' }), head: '' })).toBe('siteground');
    expect(identifyFirewall({ headers: new Headers(), head: '<title>Just a moment...</title>' })).toBeNull();
  });
});

describe('/px paths carry the scheme', () => {
  let fetched: Array<{ url: string; referer: string | null }> = [];

  beforeEach(() => {
    fetched = [];
    globalThis.fetch = Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        fetched.push({ url: String(input), referer: new Headers(init?.headers).get('referer') });
        return new Response('a{background:url(/b.png)}', { headers: { 'content-type': 'text/css' } });
      },
      { preconnect: realFetchForRoutes.preconnect },
    );
  });
  afterEach(() => {
    globalThis.fetch = realFetchForRoutes;
  });

  const get = (path: string) => proxy.request(path, {}, fakeEnv(), new FakeExecutionContext());

  test('the scheme form reaches the host over that scheme and speaks as it', async () => {
    await get('/px/http/example.com/a.css?v=1');
    await get('/px/https/example.com/a.css');
    expect(fetched).toEqual([
      { url: 'http://example.com/a.css?v=1', referer: 'http://example.com/' },
      { url: 'https://example.com/a.css', referer: 'https://example.com/' },
    ]);
  });

  test('the legacy form still reads as https', async () => {
    await get('/px/example.com/a.css');
    expect(fetched).toEqual([{ url: 'https://example.com/a.css', referer: 'https://example.com/' }]);
  });

  test("an http stylesheet's own urls stay http", async () => {
    const res = await get('/px/http/example.com/a.css');
    expect(await res.text()).toBe('a{background:url(http://localhost/px/http/example.com/b.png)}');
  });

  test.each([
    '/px/http/127.0.0.1/',
    '/px/https/127.0.0.1/',
    '/px/http/localhost/',
    '/px/http/169.254.169.254/latest/meta-data/',
    '/px/http/user@127.0.0.1/',
    '/px/127.0.0.1/',
  ])('%s is refused before any fetch', async (path) => {
    const res = await get(path);
    expect(res.status).toBe(400);
    expect(fetched).toEqual([]);
  });

  test.each(['/px/', '/px/https', '/px/https/', '/px/http/'])('%s has no host', async (path) => {
    expect(await (await get(path)).text()).toBe(PROXY_ERRORS.missingHost.message);
    expect(fetched).toEqual([]);
  });

  test('an http page writes the scheme into its sub-resources, keeping its own https ones', async () => {
    globalThis.fetch = Object.assign(
      async () =>
        new Response(
          '<img src="/a.png"><img src="https://plain.example/b.png"><div style="background:url(/c.png)"></div>',
          { headers: { 'content-type': 'text/html' } },
        ),
      { preconnect: realFetchForRoutes.preconnect },
    );
    const body = await (await get(`/proxy?url=${encodeURIComponent('http://plain.example/')}`)).text();
    expect(body).toContain('src="http://localhost/px/http/plain.example/a.png"');
    expect(body).toContain('src="http://localhost/px/plain.example/b.png"');
    expect(body).toContain('url(http://localhost/px/http/plain.example/c.png)');
  });
});
