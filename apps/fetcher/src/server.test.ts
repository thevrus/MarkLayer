import { afterEach, beforeAll, describe, expect, mock, test } from 'bun:test';

const TOKEN = 'test-token';
process.env.FETCHER_TOKEN = TOKEN;

type LookupAddress = { address: string; family: number };
type LookupFn = (hostname: string, options: { all: true }) => Promise<LookupAddress[]>;
type FetchFn = (input: string | URL | Request, init?: BunFetchRequestInit) => Promise<Response>;

// Stand-ins for the two things `resolvesPublicly` and `fetchGuarded` reach out
// to. Installed before `./server` is imported (below, in `beforeAll`) so the
// module binds to these, not the real DNS resolver or the real network.
const mockLookup = mock<LookupFn>();
mock.module('node:dns/promises', () => ({ lookup: mockLookup }));

const mockFetch = mock<FetchFn>();
// `fetch` also carries Bun's `preconnect` extension; stub it so this reads as
// a real replacement rather than just the callable part of the signature.
globalThis.fetch = Object.assign(mockFetch, { preconnect: (): void => {} });

const publicAddress = (address: string): LookupAddress => ({ address, family: 4 });

let handle: (req: Request) => Promise<Response>;

// Imported after the token is set and the mocks above are installed: the
// module reads the token once, at load, and binds `lookup`/`fetch` at call time.
beforeAll(async () => {
  ({ handle } = await import('./server'));
});

// `mock.calls` accumulates for the life of the mock, not per test — without
// this, an assertion like "called exactly once" would count every previous
// test's calls too.
afterEach(() => {
  mockLookup.mockReset();
  mockFetch.mockReset();
});

const call = (path: string, init?: RequestInit) => handle(new Request(`http://relay.test${path}`, init));
const authed = (path: string) => call(path, { headers: { Authorization: `Bearer ${TOKEN}` } });

describe('auth', () => {
  test('rejects a request with no token', async () => {
    expect((await call('/fetch?url=https://example.com')).status).toBe(401);
  });

  test('rejects a wrong token', async () => {
    const res = await call('/fetch?url=https://example.com', { headers: { Authorization: 'Bearer nope' } });
    expect(res.status).toBe(401);
  });

  test('rejects a token that is only a prefix of the real one', async () => {
    const res = await call('/fetch?url=https://example.com', {
      headers: { Authorization: `Bearer ${TOKEN.slice(0, 4)}` },
    });
    expect(res.status).toBe(401);
  });
});

describe('target guards', () => {
  test('refuses a missing url', async () => {
    expect((await authed('/fetch')).status).toBe(400);
  });

  test.each([
    'file:///etc/passwd',
    'http://localhost:8080/',
    'http://169.254.169.254/latest/meta-data/',
    'http://10.0.0.1/',
    'gopher://example.com/',
  ])('refuses %s', async (target) => {
    const res = await authed(`/fetch?url=${encodeURIComponent(target)}`);
    expect(res.status).toBe(400);
    expect(res.headers.get('x-ml-relay')).toBe('error');
  });

  test('refuses a dual-homed name where only one resolved address is private', async () => {
    // This is the invariant `.every()` exists for: checking only the first
    // address would let a name that also resolves privately through.
    mockLookup.mockResolvedValueOnce([publicAddress('93.184.216.34'), publicAddress('127.0.0.1')]);
    const res = await authed('/fetch?url=https://dual-homed.test/');
    expect(res.status).toBe(400);
  });

  test('allows a name that resolves to more than one public address', async () => {
    // Without this, a `resolvesPublicly` that rejected every hostname would
    // still make the dual-homed and DNS-failure tests pass, for the wrong reason.
    mockLookup.mockResolvedValueOnce([publicAddress('93.184.216.34'), publicAddress('1.1.1.1')]);
    mockFetch.mockResolvedValueOnce(new Response('ok', { status: 200 }));
    const res = await authed('/fetch?url=https://multi-public.test/');
    expect(res.status).toBe(200);
    expect(res.headers.get('x-ml-relay')).toBe('ok');
  });

  test('refuses a name when DNS resolution fails, failing closed', async () => {
    mockLookup.mockRejectedValueOnce(new Error('ENOTFOUND'));
    const res = await authed('/fetch?url=https://dns-failure.test/');
    expect(res.status).toBe(400);
  });
});

describe('redirects', () => {
  test('refuses a redirect to a host that resolves privately, without ever fetching it', async () => {
    mockLookup
      .mockResolvedValueOnce([publicAddress('93.184.216.34')]) // the origin host
      .mockResolvedValueOnce([publicAddress('127.0.0.1')]); // the redirect target
    mockFetch.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: 'https://internal.test/' } }),
    );

    const res = await authed('/fetch?url=https://redirect-origin.test/');

    expect(res.status).toBe(400);
    // `redirect: 'manual'` exists precisely so the second hop is judged before
    // it is ever requested; if this failed, 169.254.169.254 would be one 302 away.
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  test('does not re-resolve a redirect that keeps the same hostname', async () => {
    mockLookup.mockResolvedValueOnce([publicAddress('93.184.216.34')]);
    mockFetch
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: '/b' } }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));

    const res = await authed('/fetch?url=https://same-host.test/a');

    expect(res.status).toBe(200);
    // Pins the `guarded` memo: re-resolving an already-cleared hostname would
    // cost a cold lookup on the render budget for nothing.
    expect(mockLookup).toHaveBeenCalledTimes(1);
  });
});

describe('routing', () => {
  test('serves health without a token', async () => {
    mockFetch.mockResolvedValueOnce(new Response('203.0.113.9'));
    const res = await call('/health');
    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    expect(body).toMatchObject({ ok: true, userAgent: expect.stringContaining('MarkLayer') });
  });

  test('404s an unknown path', async () => {
    expect((await call('/nope')).status).toBe(404);
  });
});
