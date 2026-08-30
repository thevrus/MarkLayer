import { parseFetchableUrl } from '@marklayer/types';
import { Hono } from 'hono/tiny';
import type { Env } from './index';
import { captureBlockedSite, captureServer } from './posthog';
import { PROXY_ERRORS } from './proxy-errors';

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// URL schemes that must never be routed through the proxy (non-fetchable or in-page).
const SKIP_SCHEME = /^(data:|blob:|javascript:|mailto:|tel:|about:|#)/i;

/** Escape a string for safe insertion into a <script> block */
function escapeForScript(s: string): string {
  return JSON.stringify(s).slice(1, -1);
}

/** Compiled once — `rewriteUrl` runs per attribute while streaming the page. */
const ABSOLUTE_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Host firewalls (SiteGround, Cloudflare, Imperva, Akamai) answer a server-side
 * fetch with a browser challenge instead of the page, usually as a `200` carrying
 * a meta refresh to a challenge path. Nothing here can solve a CAPTCHA, so the
 * only useful move is to tell the viewer *why* the page is empty.
 */
const CHALLENGE_PATH =
  /(\/\.well-known\/sgcaptcha|\/cdn-cgi\/challenge|_incapsula_resource|distil_r_captcha|\/_sec\/cp_challenge)/i;

/** Titles the well-known challenge interstitials ship with, for the pages that carry no meta refresh. */
const CHALLENGE_TITLE = /<title[^>]*>[^<]*(just a moment|attention required|access denied|security check)/i;

/** Statuses a WAF answers with when it is refusing us rather than reporting a real 404/500. */
const CHALLENGE_STATUS = new Set([401, 403, 405, 429, 503]);

/**
 * Whether this response is a firewall refusing us rather than the page.
 *
 * Judged on the head of the body, because the tell is in the markup: a challenge
 * arrives as a perfectly ordinary `200` (SiteGround sends `202`) whose entire
 * content is a redirect to a CAPTCHA.
 */
function isChallenged({ status, head }: { status: number; head: string }): boolean {
  return CHALLENGE_STATUS.has(status) || CHALLENGE_PATH.test(head) || CHALLENGE_TITLE.test(head);
}

/**
 * Whether a sub-resource was refused rather than served.
 *
 * A status check alone is not enough: SiteGround answers a challenge with `202`,
 * and the giveaway is the content type, not the code — a stylesheet or script
 * request that comes back as HTML got an interstitial, not the asset. Judged on
 * the request's own `Accept`, so a genuine HTML sub-resource (an iframe) is not
 * mistaken for one.
 */
function isRefusedSubResource({ resp, accept }: { resp: Response; accept: string | undefined }): boolean {
  if (CHALLENGE_STATUS.has(resp.status)) return true;
  const wantsHtml = (accept || '').includes('text/html');
  return !wantsHtml && (resp.headers.get('content-type') || '').includes('text/html');
}

/** How much of the body to read before deciding — a challenge page is smaller than this entire. */
const PEEK_BYTES = 4096;

/**
 * Read the first `PEEK_BYTES` of a body, and hand back a stream that still
 * yields all of it. Deciding whether a response is a challenge means looking at
 * the markup, and the response must survive being looked at.
 */
async function peekBody(
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
 * Well inside the viewer's 12s render budget. The relay is an optimization on a
 * page that has already failed once, so it may spend a little time — but never
 * so much that waiting for a dead host is worse than the block it was fixing.
 */
const RELAY_TIMEOUT_MS = 6_000;

/** Consecutive failures before the relay is presumed gone rather than unlucky. */
const RELAY_FAILURES_BEFORE_TRIP = 3;
/** How long to stop calling it once tripped, before one request is allowed to re-test. */
const RELAY_COOLDOWN_MS = 60_000;

/**
 * A circuit breaker, so an unreachable relay costs one slow request a minute
 * instead of one on every view.
 *
 * This is the "the host went away" case made survivable: if the Fly account is
 * cancelled while the secrets still point at it, the breaker trips after three
 * failures and the proxy goes back to behaving exactly as it did before the
 * relay existed. Isolate-local and deliberately un-synchronized — an
 * approximate breaker that costs nothing beats an exact one that needs storage.
 */
let relayFailures = 0;
let relayBlockedUntil = 0;

/**
 * Just the bindings the relay reads. Narrower than `Env['Bindings']` on purpose:
 * this code has no business touching the database or the bucket, and saying so
 * in the type is what lets a test call it with three strings.
 */
type RelaySettings = Pick<Env['Bindings'], 'FETCHER_URL' | 'FETCHER_TOKEN' | 'FETCHER_ENABLED'>;

/** The relay's coordinates, or `null` when it is off — the one authority for that. */
function relayConfig(env: RelaySettings): { url: string; token: string } | null {
  const { FETCHER_URL, FETCHER_TOKEN, FETCHER_ENABLED } = env;
  // An explicit off switch that needs no redeploy and no secret deletion: set
  // FETCHER_ENABLED to "false" and the fallback stops, config intact.
  if (FETCHER_ENABLED === 'false' || FETCHER_ENABLED === '0') return null;
  return FETCHER_URL && FETCHER_TOKEN ? { url: FETCHER_URL.replace(/\/$/, ''), token: FETCHER_TOKEN } : null;
}

/**
 * Fetch through the fixed-IP relay, or `null` if it is off, tripped, or could
 * not answer. A relay-level failure is deliberately indistinguishable from
 * "not configured" here: either way the caller keeps whatever the direct fetch
 * gave it, which is never worse than what it had.
 */
async function relayFetch({ url, env }: { url: string; env: RelaySettings }): Promise<Response | null> {
  const relay = relayConfig(env);
  if (!relay) return null;
  if (Date.now() < relayBlockedUntil) return null;

  try {
    const resp = await fetch(`${relay.url}/fetch?url=${encodeURIComponent(url)}`, {
      headers: { Authorization: `Bearer ${relay.token}` },
      signal: AbortSignal.timeout(RELAY_TIMEOUT_MS),
    });
    // A relay that answers at all is alive, even when it reports it could not
    // reach the target — that is the target's fault, not the relay's.
    relayFailures = 0;
    return resp.headers.get('x-ml-relay') === 'ok' ? resp : null;
  } catch {
    relayFailures++;
    if (relayFailures >= RELAY_FAILURES_BEFORE_TRIP) {
      relayBlockedUntil = Date.now() + RELAY_COOLDOWN_MS;
      relayFailures = 0;
    }
    return null;
  }
}

/** Test seam: the breaker is module state, and a test that trips it must be able to clear it. */
export function resetRelayBreaker(): void {
  relayFailures = 0;
  relayBlockedUntil = 0;
}

/** A page, and how it was obtained. */
interface FetchedPage {
  status: number;
  contentType: string;
  finalUrl: string;
  stream: ReadableStream<Uint8Array> | null;
  via: 'direct' | 'relay';
  challenged: boolean;
  /** The relay's public address, when the relay is what answered. */
  egressIp: string | null;
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
  const egressIp = resp.headers.get('x-ml-egress');
  const base = { status: resp.status, contentType, finalUrl, via, egressIp };

  if (!contentType.includes('text/html') || !resp.body) {
    return { ...base, stream: resp.body, challenged: false };
  }
  const { head, stream } = await peekBody(resp.body);
  return { ...base, stream, challenged: isChallenged({ status: resp.status, head }) };
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
async function fetchPage({ url, env }: { url: string; env: Env['Bindings'] }): Promise<FetchedPage> {
  const origin = new URL(url).origin;
  const resp = await fetch(url, {
    headers: {
      'User-Agent': BROWSER_UA,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      Referer: `${origin}/`,
      Origin: origin,
    },
    redirect: 'follow',
  });

  const direct = await describePage({ resp, finalUrl: resp.url || url, via: 'direct' });
  if (!direct.challenged) return direct;

  const relayed = await relayFetch({ url, env });
  if (!relayed?.body) return direct;

  // The direct body lost, so release its upstream connection rather than leaving
  // it open for the life of the request.
  void direct.stream?.cancel();
  return describePage({ resp: relayed, finalUrl: relayed.headers.get('x-ml-final-url') || url, via: 'relay' });
}

/**
 * A script telling the viewer the page never arrived, or `''` when it did.
 *
 * Reaching here means both the direct fetch and the relay were refused, so the
 * only thing left to be useful with is the relay's own address: that is a single
 * IP a site owner can hand their host, unlike Cloudflare's shared egress, which
 * they would be allowing the entire platform through.
 */
function blockedNotice({ resp, env }: { resp: FetchedPage; env: Env['Bindings'] }): string {
  if (!resp.challenged && resp.status < 400) return '';
  const reason = resp.challenged ? 'firewall' : 'http';
  // What the relay reported about itself beats a hand-copied secret; the secret
  // is only the answer for the case where the relay never got to speak.
  const ip = resp.egressIp || env.FETCHER_EGRESS_IP;
  return `<script>window.parent.postMessage({type:"ml-blocked",reason:"${reason}",status:${resp.status},via:"${resp.via}",ip:${
    ip ? `"${escapeForScript(ip)}"` : 'null'
  }},"*")</script>`;
}

/** The shared gate's failure reasons, in the proxy's own error vocabulary. */
const URL_ERRORS = {
  invalid: PROXY_ERRORS.invalidUrl,
  scheme: PROXY_ERRORS.badScheme,
  blocked: PROXY_ERRORS.blockedHost,
} as const;

const proxy = new Hono<Env>();

// Proxy endpoint: fetches a page and strips frame-blocking headers
proxy.get('/proxy', async (c) => {
  const url = c.req.query('url');
  if (!url) return c.text(PROXY_ERRORS.missingUrl.message, 400);

  const gate = parseFetchableUrl(url);
  if (!gate.ok) {
    const { message, label } = URL_ERRORS[gate.reason];
    // Only a blocked host is worth a metric: the other two are a malformed paste.
    if (gate.reason === 'blocked') captureServer(c.env, c.executionCtx, 'proxy_render_failed', { reason: label });
    return c.text(message, 400);
  }

  const reqUrl = new URL(c.req.url);
  if (gate.url.hostname.toLowerCase() === reqUrl.hostname.toLowerCase()) return c.redirect('/#error=self');

  const fetchStart = Date.now();
  try {
    const resp = await fetchPage({ url, env: c.env });

    // Every fetch outcome in one event: the denominator the failure rates never
    // had, the relay's rescue rate (`via: 'relay'` means the direct fetch was
    // challenged and the relay answered), and the upstream error rate — which
    // used to be a second event carrying the same four properties.
    captureServer(c.env, c.executionCtx, 'proxy_page_fetched', {
      via: resp.via,
      challenged: resp.challenged,
      status: resp.status,
      html: resp.contentType.includes('text/html'),
      relay_configured: Boolean(relayConfig(c.env)),
      duration_ms: Date.now() - fetchStart,
    });

    // The same refusal the viewer is about to see, filed as an Error Tracking
    // issue keyed on the site — so "which sites turn us away" is a triageable
    // list rather than a breakdown someone has to remember to run.
    if (resp.challenged || resp.status >= 400) {
      captureBlockedSite(c.env, c.executionCtx, {
        kind: resp.challenged ? 'firewall-challenge' : 'http-error',
        url,
        status: resp.status,
        via: resp.via,
      });
    }

    // For non-HTML resources, pass through as-is
    if (!resp.contentType.includes('text/html')) {
      // pdf.js fetches the raw bytes itself via ?raw=1; that request must always
      // fall through to the plain pass-through below, whatever the content type is.
      if (reqUrl.searchParams.get('raw') !== '1' && resp.contentType.includes('application/pdf')) {
        // The viewer page fetches the bytes itself; this body is never read, so
        // release the upstream connection instead of leaving it open.
        void resp.stream?.cancel();
        // Redirect rather than inline a shell, so Vite owns the viewer's script tag
        // and its content hash. `/pdf`, not `/pdf.html`: the asset layer redirects
        // the extension away anyway, and this skips that second hop. It carries the
        // target url, not the ?raw=1 proxy url, so the page can only ever be
        // pointed at this origin's own proxy.
        return c.redirect(`/pdf?url=${encodeURIComponent(url)}`, 302);
      }

      const headers = new Headers();
      headers.set('Content-Type', resp.contentType);
      headers.set('Access-Control-Allow-Origin', '*');
      return new Response(resp.stream, { headers });
    }

    const baseUrl = new URL(resp.finalUrl);
    const origin = baseUrl.origin;
    const host = baseUrl.host;
    const origPath = baseUrl.pathname + baseUrl.search;
    const selfOrigin = reqUrl.origin;
    const inject = `<script>document.documentElement.dataset.marklayer="1";history.replaceState(null,"","${escapeForScript(origPath)}");navigator.serviceWorker&&(navigator.serviceWorker.register=function(){return Promise.resolve()});(function(){var H="${selfOrigin}";var T="${escapeForScript(baseUrl.host)}";var F=window.fetch;function _pw(s){try{var u=new URL(s,location.href);if(/^https?:$/.test(u.protocol)){if(u.origin!==location.origin)return H+"/px/"+u.host+u.pathname+u.search;if(u.pathname!=="/"&&!/^\\/(px|api|ws|proxy|s|og)(\\/|$)/.test(u.pathname))return H+"/px/"+T+u.pathname+u.search}}catch(e){}return null}window.fetch=function(i,o){var s=typeof i==="string"?i:i instanceof Request?i.url:String(i);var p=_pw(s);if(p)i=typeof i==="string"?p:new Request(p,i);return F.call(this,i,o)};var O=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(){var p=_pw(String(arguments[1]));if(p)arguments[1]=p;return O.apply(this,arguments)}})()</script><base href="${origin}/"><script>(function(){var r=history.replaceState,p=history.pushState;history.replaceState=function(){try{return r.apply(this,arguments)}catch(e){}};history.pushState=function(){try{return p.apply(this,arguments)}catch(e){}}; document.addEventListener("click",function(e){var a=e.target.closest?e.target.closest("a"):null;if(!a)return;var h=a.href;if(!h||h.indexOf("javascript:")===0||h.charAt(0)==="#")return;e.preventDefault();e.stopPropagation();window.parent.postMessage({type:"ml-navigate",url:h},"*")},true)})();</script>${blockedNotice(
      { resp, env: c.env },
    )}`;

    /** Route a same-origin sub-resource (absolute, protocol-relative, or relative) through the proxy. */
    const px = `${selfOrigin}/px/${host}`;
    /** Root-relative `url(/...)` in CSS, routed through the sub-resource proxy. */
    const cssUrlReplacement = `url($1${px}/`;
    const rewriteUrl = (val: string): string | null => {
      const v = val.trim();
      if (!v || SKIP_SCHEME.test(v)) return null;
      if (v.startsWith(`${selfOrigin}/px/`)) return null; // already proxied
      if (v.startsWith(`${origin}/`)) return `${px}${v.slice(origin.length)}`;
      if (v.startsWith(`//${host}/`)) return `${px}${v.slice(host.length + 2)}`;
      // Absolute URLs that don't even mention the target host are cross-origin —
      // skip the WHATWG parse (third-party CDN URLs dominate on real pages, and
      // this runs per attribute while streaming the rewritten HTML).
      if ((ABSOLUTE_SCHEME.test(v) || v.startsWith('//')) && !v.includes(host)) return null;
      // Root-relative paths are the common case on real pages and resolve to
      // exactly this, so answer them with string work rather than a URL parse.
      if (v.startsWith('/') && !v.startsWith('//')) return `${px}${v}`;
      // Resolve the remaining relative URLs against the target base and proxy same-host ones.
      // Required for ES-module scripts (and any [crossorigin] resource): they are always fetched
      // in CORS mode, so loading them cross-origin from the target is blocked. <base href> alone
      // leaves them on the target origin — they must come back through the same-origin proxy.
      try {
        const u = new URL(v, baseUrl);
        if ((u.protocol === 'http:' || u.protocol === 'https:') && u.host === host) {
          return `${px}${u.pathname}${u.search}`;
        }
      } catch {
        // not a resolvable URL — leave it for <base href> to handle
      }
      return null;
    };

    let injected = false;
    const styleParts: string[] = [];
    const scriptParts: string[] = [];
    const rewriter = new HTMLRewriter()
      .on('head', {
        element(el) {
          el.prepend(inject, { html: true });
          injected = true;
        },
      })
      .on('body', {
        element(el) {
          if (!injected) {
            el.prepend(inject, { html: true });
            injected = true;
          }
        },
      })
      // Rewrite same-origin absolute URLs in common attributes + inline style url()
      .on('*', {
        element(el) {
          // Leave anchor/area hrefs on the target origin — link clicks flow through
          // ml-navigate → navigateTo, which needs the real target URL, not a proxied one.
          const isAnchor = el.tagName === 'a' || el.tagName === 'area';
          for (const attr of ['src', 'href', 'action', 'poster']) {
            if (isAnchor && attr === 'href') continue;
            const val = el.getAttribute(attr);
            if (!val) continue;
            const rewritten = rewriteUrl(val);
            if (rewritten) el.setAttribute(attr, rewritten);
          }
          const style = el.getAttribute('style');
          if (style?.includes('url(')) {
            el.setAttribute('style', style.replace(/url\(\s*(['"]?)\//g, cssUrlReplacement));
          }
        },
      })
      // Rewrite srcset URLs
      .on('[srcset]', {
        element(el) {
          const srcset = el.getAttribute('srcset');
          if (!srcset) return;
          const rewritten = srcset
            .split(',')
            .map((entry) => {
              const trimmed = entry.trim();
              const idx = trimmed.search(/\s/);
              if (idx === -1) return rewriteUrl(trimmed) || trimmed;
              const u = trimmed.slice(0, idx);
              return (rewriteUrl(u) || u) + trimmed.slice(idx);
            })
            .join(', ');
          if (rewritten !== srcset) el.setAttribute('srcset', rewritten);
        },
      })
      // Strip SRI (fails on proxied resources) and nonce (blocks injected scripts)
      .on('[integrity]', {
        element(el) {
          el.removeAttribute('integrity');
        },
      })
      .on('[nonce]', {
        element(el) {
          el.removeAttribute('nonce');
        },
      })
      // Strip CSP meta tags that block framing, and turn a firewall's challenge
      // redirect into a message the viewer can explain (following it only lands
      // on a CAPTCHA we cannot answer).
      .on('meta[http-equiv]', {
        element(el) {
          const equiv = (el.getAttribute('http-equiv') || '').toLowerCase();
          if (equiv === 'content-security-policy') {
            el.remove();
            return;
          }
          if (equiv !== 'refresh') return;
          // Left in place it would navigate the iframe to a CAPTCHA we cannot
          // answer; the viewer has already been told why the page is empty.
          if (CHALLENGE_PATH.test(el.getAttribute('content') || '')) el.remove();
        },
      })
      // Strip external Cloudflare CDN scripts
      .on('script[src*="/cdn-cgi/"]', {
        element(el) {
          el.remove();
        },
      })
      // Strip inline Cloudflare CDN scripts
      .on('script:not([src])', {
        text(chunk) {
          scriptParts.push(chunk.text);
          if (chunk.lastInTextNode) {
            const buf = scriptParts.join('');
            chunk.replace(buf.includes('cdn-cgi') ? '' : buf, { html: true });
            scriptParts.length = 0;
          } else {
            chunk.replace('');
          }
        },
      })
      // Rewrite CSS url() in inline <style> to route through proxy
      .on('style', {
        text(chunk) {
          styleParts.push(chunk.text);
          if (chunk.lastInTextNode) {
            const buf = styleParts.join('');
            chunk.replace(buf.replace(/url\(\s*(['"]?)\//g, cssUrlReplacement), { html: true });
            styleParts.length = 0;
          } else {
            chunk.replace('');
          }
        },
      });

    const headers = new Headers();
    headers.set('Content-Type', 'text/html; charset=utf-8');
    headers.set('Access-Control-Allow-Origin', '*');

    if (resp.challenged) {
      captureServer(c.env, c.executionCtx, 'proxy_render_failed', {
        reason: 'firewall-challenge',
        via: resp.via,
        relay_configured: Boolean(relayConfig(c.env)),
        duration_ms: Date.now() - fetchStart,
      });
    }

    return rewriter.transform(new Response(resp.stream, { headers }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    captureServer(c.env, c.executionCtx, 'proxy_render_failed', {
      reason: PROXY_ERRORS.fetchThrew.label,
      message,
      duration_ms: Date.now() - fetchStart,
    });
    captureBlockedSite(c.env, c.executionCtx, { kind: 'fetch-threw', url, message });
    return c.text(PROXY_ERRORS.fetchThrew.message, 502);
  }
});

// CORS preflight for sub-resource proxy
proxy.options('/px/*', (c) => {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
      'Access-Control-Allow-Headers': c.req.header('Access-Control-Request-Headers') || '*',
      'Access-Control-Max-Age': '86400',
    },
  });
});

// Sub-resource proxy: serves assets from the original domain
proxy.all('/px/*', async (c) => {
  const path = c.req.path.slice(4); // strip '/px/'
  const slashIdx = path.indexOf('/');
  const host = slashIdx > 0 ? path.slice(0, slashIdx) : path;
  const rest = slashIdx > 0 ? path.slice(slashIdx) : '/';

  if (!host) return c.text('Missing host', 400);

  const targetUrl = `https://${host}${rest}${new URL(c.req.url).search}`;
  const gate = parseFetchableUrl(targetUrl);
  if (!gate.ok) {
    const { message, label } = URL_ERRORS[gate.reason];
    if (gate.reason === 'blocked') captureServer(c.env, c.executionCtx, 'proxy_render_failed', { reason: label });
    return c.text(message, 400);
  }

  try {
    const fetchHeaders: Record<string, string> = {
      'User-Agent': BROWSER_UA,
      Accept: c.req.header('Accept') || '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      Referer: `https://${host}/`,
      Origin: `https://${host}`,
    };
    const reqCt = c.req.header('Content-Type');
    if (reqCt) fetchHeaders['Content-Type'] = reqCt;

    const direct = await fetch(targetUrl, {
      method: c.req.method,
      body: c.req.method !== 'GET' && c.req.method !== 'HEAD' ? c.req.raw.body : undefined,
      headers: fetchHeaders,
      redirect: 'follow',
    });

    // A host that challenges the page challenges its stylesheets and images too,
    // so an unstyled skeleton is the failure mode without this. The relay only
    // speaks GET, which is every sub-resource a rendered page actually needs.
    let resp = direct;
    if (c.req.method === 'GET' && isRefusedSubResource({ resp: direct, accept: c.req.header('Accept') })) {
      const relayed = await relayFetch({ url: targetUrl, env: c.env });
      if (relayed) {
        void direct.body?.cancel(); // the direct body lost; do not hold its connection open
        resp = relayed;
      }
    }

    const headers = new Headers();
    const ct = resp.headers.get('content-type') || '';
    if (ct) headers.set('Content-Type', ct);
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Access-Control-Expose-Headers', '*');
    headers.set('Cache-Control', resp.headers.get('cache-control') || 'public, max-age=3600');

    // Rewrite absolute url() paths in CSS so they route through the proxy
    if (ct.includes('text/css')) {
      let css = await resp.text();
      css = css.replace(/url\(\s*(['"]?)\//g, `url($1/px/${host}/`);
      return new Response(css, { status: resp.status, headers });
    }

    return new Response(resp.body, { status: resp.status, headers });
  } catch {
    return c.text('Sub-proxy error', 502);
  }
});

// Catch-all: proxy unknown requests to original domain when originating from a proxied page
proxy.all('*', async (c) => {
  const referer = c.req.header('Referer') || '';
  const match = referer.match(/\/proxy\?url=([^&]+)/);
  if (!match) return c.env.ASSETS.fetch(c.req.raw);

  try {
    const gate = parseFetchableUrl(decodeURIComponent(match[1]));
    if (!gate.ok) return c.env.ASSETS.fetch(c.req.raw);
    const origin = gate.url.origin;
    const reqUrl = new URL(c.req.url);
    const target = `${origin}${reqUrl.pathname}${reqUrl.search}`;

    const resp = await fetch(target, {
      method: c.req.method,
      body: c.req.method !== 'GET' && c.req.method !== 'HEAD' ? c.req.raw.body : undefined,
      headers: {
        'User-Agent': BROWSER_UA,
        Accept: c.req.header('Accept') || '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        Referer: `${origin}/`,
        Origin: origin,
      },
      redirect: 'follow',
    });

    const headers = new Headers();
    const ct = resp.headers.get('content-type');
    if (ct) headers.set('Content-Type', ct);
    headers.set('Access-Control-Allow-Origin', '*');

    return new Response(resp.body, { status: resp.status, headers });
  } catch {
    return c.env.ASSETS.fetch(c.req.raw);
  }
});

// Exported for proxy.test.ts: both decide whether a page renders at all, and a
// silent truncation in `peekBody` would look like a site that half-loaded.
export { isChallenged, isRefusedSubResource, peekBody, proxy, relayFetch };
