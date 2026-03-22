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

  const selfHost = new URL(c.req.url).hostname;
  if (hostname === selfHost.toLowerCase()) return c.text('Cannot proxy to self', 400);

  try {
    const resp = await fetch(url, {
      headers: {
        'User-Agent': BROWSER_UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
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

    let html = await resp.text();

    const baseUrl = new URL(url);
    const origin = baseUrl.origin;
    const origPath = baseUrl.pathname + baseUrl.search;
    const inject = `<script>document.documentElement.dataset.marklayer="1";history.replaceState(null,"","${escapeForScript(origPath)}");navigator.serviceWorker&&(navigator.serviceWorker.register=function(){return Promise.resolve()});(function(){var F=window.fetch;window.fetch=function(i,o){try{var u=new URL(typeof i==="string"?i:i instanceof Request?i.url:String(i),location.href);if(u.origin!==location.origin&&/^https?:$/.test(u.protocol)){var p="/px/"+u.host+u.pathname+u.search;i=typeof i==="string"?p:new Request(p,i)}}catch(e){}return F.call(this,i,o)};var O=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(){try{var u=new URL(arguments[1],location.href);if(u.origin!==location.origin&&/^https?:$/.test(u.protocol))arguments[1]="/px/"+u.host+u.pathname+u.search}catch(e){}return O.apply(this,arguments)}})()</script><base href="${origin}/"><script>(function(){var r=history.replaceState,p=history.pushState;history.replaceState=function(){try{return r.apply(this,arguments)}catch(e){}};history.pushState=function(){try{return p.apply(this,arguments)}catch(e){}}; document.addEventListener("click",function(e){var a=e.target.closest?e.target.closest("a"):null;if(!a)return;var h=a.href;if(!h||h.indexOf("javascript:")===0||h.charAt(0)==="#")return;e.preventDefault();e.stopPropagation();window.parent.postMessage({type:"ml-navigate",url:h},"*")},true)})();</script>`;

    // Rewrite absolute same-origin URLs in src/href attributes to route through /px/
    const escapedOrigin = origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const escapedHost = baseUrl.host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    html = html.replace(new RegExp(`((?:src|href)\\s*=\\s*["'])${escapedOrigin}/`, 'gi'), `$1/px/${baseUrl.host}/`);
    html = html.replace(new RegExp(`((?:src|href)\\s*=\\s*["'])//${escapedHost}/`, 'gi'), `$1/px/${baseUrl.host}/`);
    if (html.includes('<head>')) {
      html = html.replace('<head>', `<head>${inject}`);
    } else if (html.includes('<head ')) {
      html = html.replace(/<head\s[^>]*>/, (match) => `${match}${inject}`);
    } else {
      html = inject + html;
    }

    // Rewrite CSS url() references in inline <style> to use original origin
    html = html.replace(/<style[\s\S]*?<\/style>/gi, (block) =>
      block.replace(/url\(\s*(['"]?)\//g, `url($1${origin}/`),
    );

    // Strip CSP meta tags that block framing
    html = html.replace(/<meta[^>]*http-equiv=["']?content-security-policy["']?[^>]*>/gi, '');

    const headers = new Headers();
    headers.set('Content-Type', 'text/html; charset=utf-8');
    headers.set('Access-Control-Allow-Origin', '*');

    return new Response(html, { headers });
  } catch {
    return c.text('Proxy error: failed to fetch the requested URL', 502);
  }
});

// Sub-resource proxy: serves assets from the original domain
proxy.get('/px/*', async (c) => {
  const path = c.req.path.slice(4); // strip '/px/'
  const slashIdx = path.indexOf('/');
  const host = slashIdx > 0 ? path.slice(0, slashIdx) : path;
  const rest = slashIdx > 0 ? path.slice(slashIdx) : '/';

  if (!host) return c.text('Missing host', 400);
  if (isBlockedHost(host)) return c.text('Blocked host', 400);

  const targetUrl = `https://${host}${rest}${new URL(c.req.url).search}`;

  try {
    const resp = await fetch(targetUrl, {
      headers: {
        'User-Agent': BROWSER_UA,
        Accept: c.req.header('Accept') || '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
    });

    const headers = new Headers();
    const ct = resp.headers.get('content-type');
    if (ct) headers.set('Content-Type', ct);
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Cache-Control', resp.headers.get('cache-control') || 'public, max-age=3600');

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
      body: c.req.raw.body,
      headers: {
        'User-Agent': BROWSER_UA,
        Accept: c.req.header('Accept') || '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
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
