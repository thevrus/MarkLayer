import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { opsArraySchema } from './schema';

export { AnnotationRoom } from './annotation-room';

type Env = { Bindings: { DB: D1Database; ASSETS: Fetcher; ANNOTATION_ROOM: DurableObjectNamespace } };

const app = new Hono<Env>();

const api = new Hono<Env>();
api.use('*', cors());

// Store annotations
api.post('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();

  const result = opsArraySchema.safeParse(body);
  if (!result.success) {
    return c.json({ error: 'Invalid operations data' }, 400);
  }

  await c.env.DB.prepare('INSERT OR REPLACE INTO annotations (id, ops) VALUES (?, ?)')
    .bind(id, JSON.stringify(result.data))
    .run();

  return c.json({ ok: true });
});

// Retrieve annotations
api.get('/:id', async (c) => {
  const id = c.req.param('id');
  const row = await c.env.DB.prepare('SELECT ops FROM annotations WHERE id = ?').bind(id).first<{ ops: string }>();

  if (!row) return c.json({ error: 'not found' }, 404);
  // Touch last_accessed_at (fire-and-forget)
  c.executionCtx.waitUntil(
    c.env.DB.prepare('UPDATE annotations SET last_accessed_at = unixepoch() WHERE id = ?').bind(id).run(),
  );
  return c.json(JSON.parse(row.ops));
});

app.route('/api', api);

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
  const blockedHosts = ['localhost', 'metadata.google.internal', 'metadata.goog'];
  if (
    blockedHosts.includes(hostname) ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.local') ||
    /^127\./.test(hostname) ||
    /^10\./.test(hostname) ||
    /^192\.168\./.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
    /^169\.254\./.test(hostname) ||
    hostname === '0.0.0.0' ||
    hostname === '[::1]' ||
    hostname === '[::]'
  ) {
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
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
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
    const inject = `<script>document.documentElement.dataset.marklayer="1"</script><base href="${baseUrl.origin}/"><script>(function(){var r=history.replaceState,p=history.pushState;history.replaceState=function(){try{return r.apply(this,arguments)}catch(e){}};history.pushState=function(){try{return p.apply(this,arguments)}catch(e){}}; document.addEventListener("click",function(e){var a=e.target.closest?e.target.closest("a"):null;if(!a)return;var h=a.href;if(!h||h.indexOf("javascript:")===0||h.charAt(0)==="#")return;e.preventDefault();e.stopPropagation();window.parent.postMessage({type:"ml-navigate",url:h},"*")},true)})();</script>`;
    if (html.includes('<head>')) {
      html = html.replace('<head>', `<head>${inject}`);
    } else if (html.includes('<head ')) {
      html = html.replace(/<head\s[^>]*>/, (match) => `${match}${inject}`);
    } else {
      html = inject + html;
    }

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

// Scheduled cleanup: delete annotations not accessed in 30 days
const scheduled: ExportedHandlerScheduledHandler<Env['Bindings']> = async (_event, env) => {
  const thirtyDaysAgo = Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60;
  await env.DB.prepare('DELETE FROM annotations WHERE last_accessed_at < ?').bind(thirtyDaysAgo).run();
};

export default { ...app, scheduled };
