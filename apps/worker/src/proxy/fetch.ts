import { parseFetchableUrl } from '@marklayer/types/net';
import { RELAY_HEADERS } from '@marklayer/types/relay';
import { type Firewall, identifyFirewall } from '../../shared/proxy-errors';
import { isChallenged } from './challenge';
import { fetchWithHeaderTimeout } from './header-timeout';
import { decodeAttr } from './html-attr';
import { isolateBreaker, type RelayBreaker, type RelaySettings, relayFetch } from './relay';

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** How much of the body to read before deciding — a challenge page is smaller than this entire. */
const PEEK_BYTES = 4096;

/**
 * Read the first `PEEK_BYTES` of a body, and hand back a stream that still
 * yields all of it. Deciding whether a response is a challenge means looking at
 * the markup, and the response must survive being looked at.
 */
export async function peekBody(
  body: ReadableStream<Uint8Array>,
): Promise<{ head: string; stream: ReadableStream<Uint8Array> }> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let seen = 0;
  let ended = false;

  while (seen < PEEK_BYTES) {
    const { done, value } = await reader.read();
    if (done) {
      ended = true;
      break;
    }
    chunks.push(value);
    seen += value.byteLength;
  }

  const decoder = new TextDecoder();
  const head = chunks.map((chunk) => decoder.decode(chunk, { stream: true })).join('') + decoder.decode();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      chunks.length = 0; // released here, or the closures hold the peek for the whole page
      if (ended) controller.close();
    },
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) controller.close();
      else controller.enqueue(value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });

  return { head, stream };
}

/**
 * How long to wait for the upstream's response *headers*, and nothing more.
 *
 * Deliberately generous: the goal is to render as many sites as possible, and a
 * host that answers at 18s is still a site we can show. Before this the direct
 * fetch had no bound at all, so a hanging host held the request open until the
 * platform killed it and the viewer was left to guess at the cause.
 */
const UPSTREAM_HEADERS_TIMEOUT_MS = 20_000;

/** A page, and how it was obtained. */
export interface FetchedPage {
  status: number;
  contentType: string;
  finalUrl: string;
  stream: ReadableStream<Uint8Array> | null;
  via: 'direct' | 'relay';
  challenged: boolean;
  firewall: Firewall | null;
  /** The relay's public address, when the relay is what answered. */
  egressIp: string | null;
  /** A same-origin page this one bounces to at once — see `instantRefreshTarget`. */
  refreshTo: string | null;
}

/**
 * Describe a response, judging on the head of the body whether a firewall
 * answered instead of the page. Only HTML can carry a challenge, and only HTML
 * is worth buffering to check.
 */
async function describePage({
  resp,
  finalUrl,
  via,
}: {
  resp: Response;
  finalUrl: string;
  via: FetchedPage['via'];
}): Promise<FetchedPage> {
  const contentType = resp.headers.get('content-type') || 'text/html';
  const egressIp = resp.headers.get(RELAY_HEADERS.egress);
  const base = { status: resp.status, contentType, finalUrl, via, egressIp };

  if (!contentType.includes('text/html') || !resp.body) {
    return { ...base, stream: resp.body, challenged: false, firewall: null, refreshTo: null };
  }
  const { head, stream } = await peekBody(resp.body);
  const challenged = isChallenged({ status: resp.status, head });
  const firewall = challenged ? identifyFirewall({ headers: resp.headers, head }) : null;
  // A challenge's refresh points at its CAPTCHA; following it would hide the block from the viewer.
  const refreshTo = challenged ? null : instantRefreshTarget({ head, base: finalUrl });
  return { ...base, stream, challenged, firewall, refreshTo };
}

const META_TAG = /<meta\b[^>]*>/gi;
const REFRESH_CONTENT = /^\s*0+(?:\.0*)?(?:\s*[;,]\s*|\s+)(?:url\s*=\s*)?(['"]?)(.+?)\1\s*$/i;

/** One attribute of a single tag, quoted or bare. */
function attrOf({ tag, name }: { tag: string; name: string }): string | null {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return m ? decodeAttr(m[1] ?? m[2] ?? m[3] ?? '') : null;
}

/**
 * Where a zero-delay `<meta http-equiv="refresh">` sends the page, when that is
 * elsewhere on the same origin.
 *
 * Static hosts (Astro's redirect template) answer `/about` with a stub bouncing
 * to `/about/`. In the frame it resolves after our `<base>` and `replaceState`
 * land, so it either walks out to our own 404 or escapes to the raw target.
 * Followed here like the HTTP redirect it stands in for, it never reaches the frame.
 */
function instantRefreshTarget({ head, base }: { head: string; base: string }): string | null {
  for (const tag of head.match(META_TAG) ?? []) {
    if (attrOf({ tag, name: 'http-equiv' })?.trim().toLowerCase() !== 'refresh') continue;
    const target = attrOf({ tag, name: 'content' })?.match(REFRESH_CONTENT)?.[2];
    if (!target) return null;
    try {
      const next = new URL(target, base);
      return next.origin === new URL(base).origin && next.href !== base ? next.href : null;
    } catch {
      return null;
    }
  }
  return null;
}

/** A chain of stubs longer than this is a loop, not a page. */
const MAX_REFRESH_HOPS = 3;

/**
 * The one way the proxy asks a host for anything: `/proxy`, `/px/*` and the catch-all
 * all arrive looking like the same browser, and all give up at the same bound.
 */
export function upstreamRequest({
  url,
  accept = '*/*',
  method = 'GET',
  body,
  contentType,
}: {
  url: string;
  accept?: string;
  method?: string;
  body?: BodyInit | null;
  contentType?: string;
}): Promise<Response> {
  const { origin } = new URL(url);
  return fetchWithHeaderTimeout({
    url,
    timeoutMs: UPSTREAM_HEADERS_TIMEOUT_MS,
    init: {
      method,
      body,
      headers: {
        'User-Agent': BROWSER_UA,
        Accept: accept,
        'Accept-Language': 'en-US,en;q=0.9',
        Referer: `${origin}/`,
        Origin: origin,
        ...(contentType && { 'Content-Type': contentType }),
      },
      redirect: 'follow',
    },
  });
}

/**
 * Fetch a page, falling back to the fixed-IP relay when Cloudflare's shared
 * egress is challenged.
 *
 * Hosts that block Workers block the whole shared pool: verified against the
 * real edge, every user-agent from a Worker was challenged by the same site that
 * served the full page to an ordinary connection. So there is nothing to retry
 * with here — only somewhere else to retry *from*.
 */
export async function fetchPage({
  url,
  env,
  breaker = isolateBreaker,
  hops = 0,
}: {
  url: string;
  env: RelaySettings;
  breaker?: RelayBreaker;
  /** Meta-refresh stubs already followed to reach `url`. */
  hops?: number;
}): Promise<FetchedPage> {
  const resp = await upstreamRequest({
    url,
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  });

  const direct = await describePage({ resp, finalUrl: resp.url || url, via: 'direct' });
  const next = direct.refreshTo && hops < MAX_REFRESH_HOPS ? parseFetchableUrl(direct.refreshTo) : null;
  if (next?.ok) {
    void direct.stream?.cancel();
    return fetchPage({ url: next.url.href, env, breaker, hops: hops + 1 });
  }
  if (!direct.challenged) return direct;

  const relayed = await relayFetch({ url, env, breaker });
  if (!relayed?.body) return direct;

  // The direct body lost, so release its upstream connection rather than leaving
  // it open for the life of the request.
  void direct.stream?.cancel();
  const page = await describePage({
    resp: relayed,
    finalUrl: relayed.headers.get(RELAY_HEADERS.finalUrl) || url,
    via: 'relay',
  });
  if (page.challenged) breaker.refused(url);
  return page;
}
