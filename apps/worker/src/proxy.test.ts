import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { isChallenged, isRefusedSubResource, peekBody, relayFetch, resetRelayBreaker } from './proxy';

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
