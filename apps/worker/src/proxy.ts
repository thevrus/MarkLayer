import { Hono } from 'hono/tiny';
import type { Env } from './index';
import { captureServer } from './posthog';
import { PROXY_ERRORS } from './proxy-errors';

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const BLOCKED_HOSTS = new Set(['localhost', 'metadata.google.internal', 'metadata.goog']);

// URL schemes that must never be routed through the proxy (non-fetchable or in-page).
const SKIP_SCHEME = /^(data:|blob:|javascript:|mailto:|tel:|about:|#)/i;

function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return (
    BLOCKED_HOSTS.has(h) ||
    h.endsWith('.internal') ||
    h.endsWith('.local') ||
    /^127\./.test(h) ||
    /^10\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
    /^169\.254\./.test(h) ||
    h === '0.0.0.0' ||
    h === '[::1]' ||
    h === '[::]'
  );
}

/** Escape a string for safe insertion into a <script> block */
function escapeForScript(s: string): string {
  return JSON.stringify(s).slice(1, -1);
}

/** Compiled once — `rewriteUrl` runs per attribute while streaming the page. */
const ABSOLUTE_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

const proxy = new Hono<Env>();

// Proxy endpoint: fetches a page and strips frame-blocking headers
proxy.get('/proxy', async (c) => {
  const url = c.req.query('url');
  if (!url) return c.text(PROXY_ERRORS.missingUrl.message, 400);

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return c.text(PROXY_ERRORS.invalidUrl.message, 400);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return c.text(PROXY_ERRORS.badScheme.message, 400);
  }

  const hostname = parsed.hostname.toLowerCase();
  if (isBlockedHost(hostname)) {
    captureServer(c.env, c.executionCtx, 'proxy_render_failed', { reason: PROXY_ERRORS.blockedHost.label });
    return c.text(PROXY_ERRORS.blockedHost.message, 400);
  }

  const reqUrl = new URL(c.req.url);
  if (hostname === reqUrl.hostname.toLowerCase()) return c.redirect('/#error=self');

  const fetchStart = Date.now();
  try {
    const resp = await fetch(url, {
      headers: {
        'User-Agent': BROWSER_UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        Referer: `${parsed.origin}/`,
        Origin: parsed.origin,
      },
      redirect: 'follow',
    });

    const contentType = resp.headers.get('content-type') || 'text/html';

    if (!resp.ok) {
      captureServer(c.env, c.executionCtx, 'proxy_render_failed', {
        reason: 'upstream-not-ok',
        status: resp.status,
        duration_ms: Date.now() - fetchStart,
      });
    }

    // For non-HTML resources, pass through as-is
    if (!contentType.includes('text/html')) {
      const headers = new Headers();
      headers.set('Content-Type', contentType);
      headers.set('Access-Control-Allow-Origin', '*');
      return new Response(resp.body, { headers });
    }

    const baseUrl = new URL(resp.url || url);
    const origin = baseUrl.origin;
    const host = baseUrl.host;
    const origPath = baseUrl.pathname + baseUrl.search;
    const selfOrigin = reqUrl.origin;
    const inject = `<script>document.documentElement.dataset.marklayer="1";history.replaceState(null,"","${escapeForScript(origPath)}");navigator.serviceWorker&&(navigator.serviceWorker.register=function(){return Promise.resolve()});(function(){var H="${selfOrigin}";var T="${escapeForScript(baseUrl.host)}";var F=window.fetch;function _pw(s){try{var u=new URL(s,location.href);if(/^https?:$/.test(u.protocol)){if(u.origin!==location.origin)return H+"/px/"+u.host+u.pathname+u.search;if(u.pathname!=="/"&&!/^\\/(px|api|ws|proxy|s|og)(\\/|$)/.test(u.pathname))return H+"/px/"+T+u.pathname+u.search}}catch(e){}return null}window.fetch=function(i,o){var s=typeof i==="string"?i:i instanceof Request?i.url:String(i);var p=_pw(s);if(p)i=typeof i==="string"?p:new Request(p,i);return F.call(this,i,o)};var O=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(){var p=_pw(String(arguments[1]));if(p)arguments[1]=p;return O.apply(this,arguments)}})()</script><base href="${origin}/"><script>(function(){var r=history.replaceState,p=history.pushState;history.replaceState=function(){try{return r.apply(this,arguments)}catch(e){}};history.pushState=function(){try{return p.apply(this,arguments)}catch(e){}}; document.addEventListener("click",function(e){var a=e.target.closest?e.target.closest("a"):null;if(!a)return;var h=a.href;if(!h||h.indexOf("javascript:")===0||h.charAt(0)==="#")return;e.preventDefault();e.stopPropagation();window.parent.postMessage({type:"ml-navigate",url:h},"*")},true)})();</script>`;

    /** Route a same-origin sub-resource (absolute, protocol-relative, or relative) through the proxy. */
    const px = `${selfOrigin}/px/${host}`;
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
            el.setAttribute('style', style.replace(/url\(\s*(['"]?)\//g, `url($1${selfOrigin}/px/${host}/`));
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
      // Strip CSP meta tags that block framing
      .on('meta[http-equiv]', {
        element(el) {
          if ((el.getAttribute('http-equiv') || '').toLowerCase() === 'content-security-policy') el.remove();
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
            chunk.replace(buf.replace(/url\(\s*(['"]?)\//g, `url($1${selfOrigin}/px/${host}/`), { html: true });
            styleParts.length = 0;
          } else {
            chunk.replace('');
          }
        },
      });

    const headers = new Headers();
    headers.set('Content-Type', 'text/html; charset=utf-8');
    headers.set('Access-Control-Allow-Origin', '*');

    return rewriter.transform(new Response(resp.body, { headers }));
  } catch (err) {
    captureServer(c.env, c.executionCtx, 'proxy_render_failed', {
      reason: PROXY_ERRORS.fetchThrew.label,
      message: err instanceof Error ? err.message : String(err),
      duration_ms: Date.now() - fetchStart,
    });
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
  if (isBlockedHost(host)) return c.text('Blocked host', 400);

  const targetUrl = `https://${host}${rest}${new URL(c.req.url).search}`;

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

    const resp = await fetch(targetUrl, {
      method: c.req.method,
      body: c.req.method !== 'GET' && c.req.method !== 'HEAD' ? c.req.raw.body : undefined,
      headers: fetchHeaders,
      redirect: 'follow',
    });

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
    const originalUrl = new URL(decodeURIComponent(match[1]));
    if (isBlockedHost(originalUrl.hostname)) return c.env.ASSETS.fetch(c.req.raw);
    const reqUrl = new URL(c.req.url);
    const target = `${originalUrl.origin}${reqUrl.pathname}${reqUrl.search}`;

    const resp = await fetch(target, {
      method: c.req.method,
      body: c.req.method !== 'GET' && c.req.method !== 'HEAD' ? c.req.raw.body : undefined,
      headers: {
        'User-Agent': BROWSER_UA,
        Accept: c.req.header('Accept') || '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        Referer: `${originalUrl.origin}/`,
        Origin: originalUrl.origin,
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

export { proxy };
