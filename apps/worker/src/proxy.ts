import { Hono } from 'hono';
import type { Env } from './index';

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const BLOCKED_HOSTS = new Set(['localhost', 'metadata.google.internal', 'metadata.goog']);

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

const proxy = new Hono<Env>();

// Proxy endpoint: fetches a page and strips frame-blocking headers
proxy.get('/proxy', async (c) => {
  const url = c.req.query('url');
  if (!url) return c.text('Missing ?url= parameter', 400);

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return c.text('Invalid URL', 400);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return c.text('Only HTTP(S) URLs are allowed', 400);
  }

  const hostname = parsed.hostname.toLowerCase();
  if (isBlockedHost(hostname)) return c.text('Blocked URL', 400);

  const reqUrl = new URL(c.req.url);
  if (hostname === reqUrl.hostname.toLowerCase()) return c.redirect('/?error=self');

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

    /** Rewrite a URL if it matches the target origin (must be absolute — <base href> points at target) */
    const px = `${selfOrigin}/px/${host}`;
    const rewriteUrl = (val: string): string | null => {
      if (val.startsWith(`${origin}/`)) return `${px}${val.slice(origin.length)}`;
      if (val.startsWith(`//${host}/`)) return `${px}${val.slice(host.length + 2)}`;
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
          for (const attr of ['src', 'href', 'action', 'poster']) {
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
  } catch {
    return c.text('Proxy error: failed to fetch the requested URL', 502);
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
