/**
 * The fixed-IP relay.
 *
 * Cloudflare Workers egress from a shared pool that hosts block wholesale —
 * SiteGround challenges every request from it regardless of headers, verified
 * against the real edge — and a dedicated Worker egress IP is Enterprise-only.
 * So the Worker's proxy falls back to this: one small box with one address we
 * own, publish, and can ask a host to allow.
 *
 * Deliberately dumb. It resolves, guards, fetches and streams bytes back; every
 * bit of HTML rewriting stays in the Worker, so there is one implementation of
 * that and one place for it to be wrong.
 */

import { timingSafeEqual } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isPrivateAddress, parseFetchableUrl } from '@marklayer/types/net';

const PORT = Number(process.env.PORT || 8080);
const TOKEN = process.env.FETCHER_TOKEN;

/**
 * An honest user-agent, and load-bearing.
 *
 * The Worker sends a Chrome string, which is what a browser-verifying WAF looks
 * for — and punishes, because the TLS handshake behind it is plainly not
 * Chrome's. Measured against the site that started this: a Chrome UA is refused
 * (403) while this one is served the full page from the same address. Claiming
 * to be a browser we are not is what gets a fetcher blocked; saying what we are,
 * with a URL that explains it, is what gets it allowed.
 */
const USER_AGENT = 'MarkLayer/1.0 (+https://marklayer.app/bot; page renderer for user-requested annotations)';

const MAX_REDIRECTS = 5;
const FETCH_TIMEOUT_MS = 20_000;
/** Big enough for any real page, small enough that one request cannot wedge the box. */
const MAX_BYTES = 25 * 1024 * 1024;

/** Encoded once: the token never changes, and the length guard below reads it. */
const EXPECTED_TOKEN = TOKEN ? Buffer.from(TOKEN) : null;

function authorized(req: Request): boolean {
  if (!EXPECTED_TOKEN) return false;
  const header = req.headers.get('authorization') || '';
  const presented = header.startsWith('Bearer ') ? Buffer.from(header.slice(7)) : null;
  // `timingSafeEqual` throws on a length mismatch, so the length is compared
  // first; the bytes themselves never leak a matching prefix through timing.
  return presented?.length === EXPECTED_TOKEN.length && timingSafeEqual(presented, EXPECTED_TOKEN);
}

function relayError(message: string, status = 502): Response {
  return Response.json({ error: message }, { status, headers: { 'x-ml-relay': 'error' } });
}

/**
 * Guard a URL by what it *resolves to*, not just how it is spelled.
 *
 * The Worker can only check the hostname text; here DNS is available, so this is
 * the layer that stops `evil.com` from pointing at the metadata endpoint. Every
 * address the name resolves to has to be public — checking only the first would
 * leave a dual-homed name a way through.
 */
async function resolvesPublicly(hostname: string): Promise<boolean> {
  try {
    const addresses = await lookup(hostname, { all: true });
    return addresses.length > 0 && addresses.every((a) => !isPrivateAddress(a.address));
  } catch {
    return false;
  }
}

/** Cap the stream so a hostile or broken upstream cannot exhaust the box. */
function capped(body: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  let seen = 0;
  return body.pipeThrough(
    new TransformStream({
      transform(chunk, controller) {
        seen += chunk.byteLength;
        if (seen > MAX_BYTES) {
          controller.error(new Error('response too large'));
          return;
        }
        controller.enqueue(chunk);
      },
    }),
  );
}

/**
 * Follow redirects by hand, re-running the guard on every hop.
 *
 * `redirect: 'follow'` would resolve the chain inside fetch, where a 302 to
 * 169.254.169.254 is invisible until it has already been requested.
 */
async function fetchGuarded(start: URL): Promise<Response> {
  let current = start;
  // http→https and trailing-slash redirects keep the hostname, and re-resolving
  // an already-cleared name buys nothing but a cold lookup on the render budget.
  let guarded = '';
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (current.hostname !== guarded) {
      if (!(await resolvesPublicly(current.hostname))) {
        return relayError(`blocked host: ${current.hostname}`, 400);
      }
      guarded = current.hostname;
    }

    const upstream = await fetch(current, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    const location = upstream.headers.get('location');
    if (upstream.status >= 300 && upstream.status < 400 && location) {
      const next = parseFetchableUrl(new URL(location, current));
      if (!next.ok) return relayError(`redirected to a ${next.reason} URL`, 400);
      current = next.url;
      continue;
    }

    // The address a site owner would allowlist, carried on the response itself so
    // the Worker can name it without a hand-copied secret that silently goes stale.
    const headers = new Headers({
      'x-ml-relay': 'ok',
      'x-ml-final-url': current.href,
      ...(settledAddress ? { 'x-ml-egress': settledAddress } : {}),
    });
    const contentType = upstream.headers.get('content-type');
    if (contentType) headers.set('content-type', contentType);
    return new Response(upstream.body ? capped(upstream.body) : null, { status: upstream.status, headers });
  }
  return relayError('too many redirects', 400);
}

/**
 * This box's public address — what a site owner allowlists.
 *
 * Looked up once and kept, but a *failed* lookup is not kept: memoizing
 * `unknown` would mean one transient blip costs the machine its only diagnostic
 * for the rest of its life. The settled value is held separately from the
 * promise so a relayed response can carry it without ever awaiting — a fetch on
 * someone's render budget must not wait on a diagnostic lookup.
 */
let settledAddress: string | null = null;
let pendingAddress: Promise<string> | null = null;
function egressAddress(): Promise<string> {
  if (settledAddress) return Promise.resolve(settledAddress);
  pendingAddress ??= fetch('https://api.ipify.org', { signal: AbortSignal.timeout(5_000) })
    .then(async (r) => {
      settledAddress = (await r.text()).trim();
      return settledAddress;
    })
    .catch(() => 'unknown')
    .finally(() => {
      pendingAddress = null;
    });
  return pendingAddress;
}

export async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url);

  if (url.pathname === '/health') {
    return Response.json({ ok: true, egress: await egressAddress(), userAgent: USER_AGENT });
  }

  if (url.pathname !== '/fetch') return new Response('Not found', { status: 404 });
  if (!authorized(req)) return relayError('unauthorized', 401);

  const target = url.searchParams.get('url');
  if (!target) return relayError('missing ?url=', 400);

  const parsed = parseFetchableUrl(target);
  if (!parsed.ok) return relayError(`${parsed.reason} URL`, 400);

  try {
    return await fetchGuarded(parsed.url);
  } catch (err) {
    return relayError(err instanceof Error ? err.message : 'fetch failed');
  }
}

// Guarded so the tests can import `handle` without binding a port.
if (import.meta.main) {
  void egressAddress(); // warmed at boot, so no request ever waits on it
  const server = Bun.serve({ port: PORT, idleTimeout: 30, fetch: handle });
  console.log(`fetcher listening on :${server.port}`);
}
