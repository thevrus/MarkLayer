import { beforeAll, describe, expect, test } from 'bun:test';

const TOKEN = 'test-token';
process.env.FETCHER_TOKEN = TOKEN;

let handle: (req: Request) => Promise<Response>;

// Imported after the token is set: the module reads it once, at load.
beforeAll(async () => {
  ({ handle } = await import('./server'));
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

  test('refuses a public name that resolves to a private address', async () => {
    // localtest.me and its subdomains are public DNS pointing at 127.0.0.1 —
    // exactly the rebinding shape the resolve-time guard exists to catch.
    const res = await authed('/fetch?url=https://anything.localtest.me/');
    expect(res.status).toBe(400);
  });
});

describe('routing', () => {
  test('serves health without a token', async () => {
    const res = await call('/health');
    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    expect(body).toMatchObject({ ok: true, userAgent: expect.stringContaining('MarkLayer') });
  });

  test('404s an unknown path', async () => {
    expect((await call('/nope')).status).toBe(404);
  });
});
