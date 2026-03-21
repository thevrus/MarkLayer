import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { generateOgImage } from './og';
import { opsArraySchema } from './schema';

export { AnnotationRoom } from './annotation-room';

type Env = {
  Bindings: {
    DB: D1Database;
    ASSETS: Fetcher;
    ANNOTATION_ROOM: DurableObjectNamespace;
    OG_BUCKET: R2Bucket;
  };
};

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
  return JSON.stringify(s).slice(1, -1); // uses JSON escaping, strips outer quotes
}

const app = new Hono<Env>();

const api = new Hono<Env>();
api.use('*', cors());

// Store annotations
api.post('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();

  // Accept { ops, expires_in? } or a raw ops array for backwards compat
  let ops: unknown;
  let expiresAt: number | null = null;
  if (Array.isArray(body)) {
    ops = body;
  } else if (body && typeof body === 'object' && 'ops' in body) {
    ops = body.ops;
    if (typeof body.expires_in === 'number' && body.expires_in > 0) {
      expiresAt = Math.floor(Date.now() / 1000) + body.expires_in;
    }
  } else {
    ops = body;
  }

  const result = opsArraySchema.safeParse(ops);
  if (!result.success) {
    return c.json({ error: 'Invalid operations data' }, 400);
  }

  await c.env.DB.prepare('INSERT OR REPLACE INTO annotations (id, ops, expires_at) VALUES (?, ?, ?)')
    .bind(id, JSON.stringify(result.data), expiresAt)
    .run();

  return c.json({ ok: true });
});

// Retrieve annotations
api.get('/:id', async (c) => {
  const id = c.req.param('id');
  const row = await c.env.DB.prepare('SELECT ops, expires_at FROM annotations WHERE id = ?')
    .bind(id)
    .first<{ ops: string; expires_at: number | null }>();

  if (!row) return c.json({ error: 'not found' }, 404);

  // Check expiration
  if (row.expires_at && Math.floor(Date.now() / 1000) > row.expires_at) {
    // Clean up expired annotation
    c.executionCtx.waitUntil(c.env.DB.prepare('DELETE FROM annotations WHERE id = ?').bind(id).run());
    return c.json({ error: 'expired' }, 410);
  }

  // Touch last_accessed_at (fire-and-forget)
  c.executionCtx.waitUntil(
    c.env.DB.prepare('UPDATE annotations SET last_accessed_at = unixepoch() WHERE id = ?').bind(id).run(),
  );
  return c.json(JSON.parse(row.ops));
});

app.route('/api', api);

app.get('/privacy', (c) =>
  c.html(`<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Privacy Policy — MarkLayer</title>
<style>body{font-family:system-ui,sans-serif;max-width:640px;margin:40px auto;padding:0 20px;line-height:1.6;color:#1a1a1a}h1{font-size:24px}h2{font-size:18px;margin-top:32px}p{margin:12px 0}</style>
</head><body>
<h1>Privacy Policy</h1>
<p><strong>Last updated:</strong> March 2026</p>
<h2>What we collect</h2>
<p>MarkLayer does not collect personal information. No account, email, or sign-up is required.</p>
<p>When you use the annotation tools, a randomly generated display name and cursor color are stored in your browser's local storage. These are never sent to our servers except as part of real-time collaboration sessions you initiate.</p>
<h2>Annotation data</h2>
<p>Annotations you create (drawings, comments, text) are sent to our server only when you choose to share them. Shared annotations are stored temporarily and automatically deleted after their expiration period.</p>
<h2>Page content</h2>
<p>The extension does not read, collect, or transmit the content of any webpage you visit. It only renders its own overlay on top of the page.</p>
<h2>Third parties</h2>
<p>We do not sell, share, or transfer any data to third parties.</p>
<h2>Contact</h2>
<p>Questions? Open an issue on our <a href="https://github.com/nicepkg/marklayer">GitHub repository</a>.</p>
</body></html>`),
);

// Shared annotation page — injects dynamic OG tags then serves the SPA
app.get('/s/:id', async (c) => {
  const annotationId = c.req.param('id');
  const reqUrl = new URL(c.req.url);
  // Extract domain from view param for OG card
  let domain = 'a webpage';
  const viewParam = reqUrl.searchParams.get('view');
  if (viewParam) {
    try {
      const decoded = atob(decodeURIComponent(viewParam));
      const hashIdx = decoded.indexOf('#ant=');
      if (hashIdx > 0) domain = new URL(decoded.substring(0, hashIdx)).hostname;
    } catch {}
  }
  const res = await c.env.ASSETS.fetch(new Request(new URL('/', reqUrl)));
  let html = await res.text();
  const ogImage = `${reqUrl.origin}/og/${annotationId}.png?domain=${encodeURIComponent(domain)}`;
  const title = `MarkLayer \u2014 Annotations on ${domain}`;
  html = html
    .replace(
      /<meta property="og:title"[^>]*>/,
      `<meta property="og:url" content="${reqUrl.href}">\n    <meta property="og:title" content="${title}">`,
    )
    .replace(/<meta property="og:image"[^>]*>/, `<meta property="og:image" content="${ogImage}">`)
    .replace(/<meta name="twitter:title"[^>]*>/, `<meta name="twitter:title" content="${title}">`)
    .replace(/<meta name="twitter:image"[^>]*>/, `<meta name="twitter:image" content="${ogImage}">`);
  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
});

// Generate OG preview image on-the-fly (cached in R2)
app.get('/og/:key', async (c) => {
  const key = c.req.param('key');
  if (!key.endsWith('.png')) return c.notFound();
  const id = key.slice(0, -4);
  const domain = c.req.query('domain') || 'a webpage';

  // Serve from R2 cache if available
  const cached = await c.env.OG_BUCKET.get(key);
  if (cached) {
    return new Response(cached.body, {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=86400',
      },
    });
  }

  // Fetch ops from D1 to compute stats
  const row = await c.env.DB.prepare('SELECT ops FROM annotations WHERE id = ?').bind(id).first<{ ops: string }>();
  const ops = row ? JSON.parse(row.ops) : [];

  // Generate card
  const png = await generateOgImage({ domain, ops });

  // Cache in R2 (fire-and-forget)
  c.executionCtx.waitUntil(
    c.env.OG_BUCKET.put(key, png, {
      httpMetadata: { contentType: 'image/png' },
    }),
  );

  return new Response(png, {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=86400',
    },
  });
});

// WebSocket endpoint for realtime collaboration
app.get('/ws/:id', async (c) => {
  const id = c.req.param('id');
  const upgradeHeader = c.req.header('Upgrade');
  if (upgradeHeader !== 'websocket') {
    return c.text('Expected WebSocket', 426);
  }
  const roomId = c.env.ANNOTATION_ROOM.idFromName(id);
  const room = c.env.ANNOTATION_ROOM.get(roomId);
  // Forward the request with the annotation ID as a query param
  const url = new URL(c.req.url);
  url.searchParams.set('id', id);
  return room.fetch(new Request(url.toString(), c.req.raw));
});

// Proxy endpoint: fetches a page and strips frame-blocking headers
app.get('/proxy', async (c) => {
  const url = c.req.query('url');
  if (!url) return c.text('Missing ?url= parameter', 400);

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return c.text('Invalid URL', 400);
  }

  // Only allow http(s) protocols
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return c.text('Only HTTP(S) URLs are allowed', 400);
  }

  // Block private/internal hostnames
  const hostname = parsed.hostname.toLowerCase();
  if (isBlockedHost(hostname)) {
    return c.text('Blocked URL', 400);
  }

  // Prevent recursive self-fetch (error 1042)
  const selfHost = new URL(c.req.url).hostname;
  if (hostname === selfHost.toLowerCase()) {
    return c.text('Cannot proxy to self', 400);
  }

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

    // Inject <base> tag + history patch + link interceptor
    const baseUrl = new URL(url);
    const origin = baseUrl.origin;
    const origPath = baseUrl.pathname + baseUrl.search;
    // 1. Set data-marklayer to prevent extension double-injection
    // 2. replaceState to original path so JS frameworks (Remix etc.) see correct window.location
    // 3. <base> tag so HTML-relative URLs resolve to original domain
    // 4. Patch pushState/replaceState to prevent navigation away from the iframe
    // 5. Intercept link clicks and forward to parent via postMessage
    const inject = `<script>document.documentElement.dataset.marklayer="1";history.replaceState(null,"","${escapeForScript(origPath)}")</script><base href="${origin}/"><script>(function(){var r=history.replaceState,p=history.pushState;history.replaceState=function(){try{return r.apply(this,arguments)}catch(e){}};history.pushState=function(){try{return p.apply(this,arguments)}catch(e){}}; document.addEventListener("click",function(e){var a=e.target.closest?e.target.closest("a"):null;if(!a)return;var h=a.href;if(!h||h.indexOf("javascript:")===0||h.charAt(0)==="#")return;e.preventDefault();e.stopPropagation();window.parent.postMessage({type:"ml-navigate",url:h},"*")},true)})();</script>`;
    if (html.includes('<head>')) {
      html = html.replace('<head>', `<head>${inject}`);
    } else if (html.includes('<head ')) {
      html = html.replace(/<head\s[^>]*>/, (match) => `${match}${inject}`);
    } else {
      html = inject + html;
    }

    // Rewrite absolute-path CSS url() references in inline <style> to use original origin
    // (The <base> tag handles HTML attributes but not CSS url() in <style> blocks)
    html = html.replace(/<style[\s\S]*?<\/style>/gi, (block) =>
      block.replace(/url\(\s*(['"]?)\//g, `url($1${origin}/`),
    );

    // Strip CSP meta tags that block framing (frame-ancestors)
    html = html.replace(/<meta[^>]*http-equiv=["']?content-security-policy["']?[^>]*>/gi, '');

    const headers = new Headers();
    headers.set('Content-Type', 'text/html; charset=utf-8');
    headers.set('Access-Control-Allow-Origin', '*');

    return new Response(html, { headers });
  } catch {
    return c.text('Proxy error: failed to fetch the requested URL', 502);
  }
});

// Sub-resource proxy: serves assets from the original domain through our worker
// Handles resources that can't be fixed by <base> or CSS url() rewriting (e.g., JS-fetched assets)
app.get('/px/*', async (c) => {
  // Path format: /px/host.com/rest/of/path
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

// Catch-all: proxy unknown requests to the original domain when they originate from a proxied page
// (e.g., Remix's __manifest fetches use window.location.origin which points to marklayer.app)
app.all('*', async (c) => {
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

// Scheduled cleanup: delete stale and expired annotations + their OG images
const scheduled: ExportedHandlerScheduledHandler<Env['Bindings']> = async (_event, env) => {
  const ninetyDaysAgo = Math.floor(Date.now() / 1000) - 90 * 24 * 60 * 60;
  const now = Math.floor(Date.now() / 1000);

  // Delete stale rows and get their IDs in one query
  const deleted = await env.DB.prepare(
    'DELETE FROM annotations WHERE last_accessed_at < ? OR (expires_at IS NOT NULL AND expires_at < ?) RETURNING id',
  )
    .bind(ninetyDaysAgo, now)
    .all<{ id: string }>();

  if (deleted.results.length > 0) {
    // Clean up R2 OG images; chunk deletes (max 1000 per call)
    const keys = deleted.results.map((r) => `${r.id}.png`);
    const r2Deletes: Promise<void>[] = [];
    for (let i = 0; i < keys.length; i += 1000) {
      r2Deletes.push(env.OG_BUCKET.delete(keys.slice(i, i + 1000)));
    }
    await Promise.all(r2Deletes);
  }
};

export default { ...app, scheduled };
