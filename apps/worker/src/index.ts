import { Hono } from 'hono';
import { api } from './api';
import { generateOgImage } from './og';
import { privacyHtml } from './privacy';
import { proxy } from './proxy';

export { AnnotationRoom } from './annotation-room';

export type Env = {
  Bindings: {
    DB: D1Database;
    ASSETS: Fetcher;
    ANNOTATION_ROOM: DurableObjectNamespace;
    OG_BUCKET: R2Bucket;
    TURN_KEY_ID?: string;
    TURN_KEY_TOKEN?: string;
  };
};

const app = new Hono<Env>();

app.route('/api', api);

app.get('/privacy', (c) => c.html(privacyHtml));

// Shared annotation page — injects dynamic OG tags then serves the SPA
app.get('/s/:id', async (c) => {
  const annotationId = c.req.param('id');
  const reqUrl = new URL(c.req.url);
  let domain = 'a webpage';
  const row = await c.env.DB.prepare('SELECT url FROM annotations WHERE id = ?')
    .bind(annotationId)
    .first<{ url: string | null }>();
  if (row?.url) {
    try {
      domain = new URL(row.url).hostname;
    } catch {}
  } else {
    const viewParam = reqUrl.searchParams.get('view');
    if (viewParam) {
      try {
        const decoded = atob(decodeURIComponent(viewParam));
        const hashIdx = decoded.indexOf('#ant=');
        if (hashIdx > 0) domain = new URL(decoded.substring(0, hashIdx)).hostname;
      } catch {}
    }
  }
  const res = await c.env.ASSETS.fetch(new Request(new URL('/', reqUrl)));
  let html = await res.text();
  const ogImage = `${reqUrl.origin}/og/${annotationId}.png?domain=${encodeURIComponent(domain)}`;
  const title = `MarkLayer \u2014 Annotations on ${domain}`;
  html = html
    .replace(/<meta property="og:url"[^>]*>/, `<meta property="og:url" content="${reqUrl.href}">`)
    .replace(/<meta property="og:title"[^>]*>/, `<meta property="og:title" content="${title}">`)
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

  const cached = await c.env.OG_BUCKET.get(key);
  if (cached) {
    return new Response(cached.body, {
      headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' },
    });
  }

  const row = await c.env.DB.prepare('SELECT ops FROM annotations WHERE id = ?').bind(id).first<{ ops: string }>();
  const ops = row ? JSON.parse(row.ops) : [];
  const png = await generateOgImage({ domain, ops });

  c.executionCtx.waitUntil(c.env.OG_BUCKET.put(key, png, { httpMetadata: { contentType: 'image/png' } }));

  return new Response(png, {
    headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' },
  });
});

// WebSocket endpoint for realtime collaboration
app.get('/ws/:id', async (c) => {
  const id = c.req.param('id');
  if (c.req.header('Upgrade') !== 'websocket') return c.text('Expected WebSocket', 426);
  const roomId = c.env.ANNOTATION_ROOM.idFromName(id);
  const room = c.env.ANNOTATION_ROOM.get(roomId);
  const url = new URL(c.req.url);
  url.searchParams.set('id', id);
  return room.fetch(new Request(url.toString(), c.req.raw));
});

// Sitemap for SEO
app.get('/sitemap.xml', (c) => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://marklayer.app/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>
  <url><loc>https://marklayer.app/privacy</loc><changefreq>monthly</changefreq><priority>0.3</priority></url>
</urlset>`;
  return c.body(xml, 200, { 'Content-Type': 'application/xml', 'Cache-Control': 'public, max-age=86400' });
});

// Proxy + catch-all (must be last)
app.route('/', proxy);

// Scheduled cleanup: delete stale and expired annotations + their OG images
const scheduled: ExportedHandlerScheduledHandler<Env['Bindings']> = async (_event, env) => {
  const ninetyDaysAgo = Math.floor(Date.now() / 1000) - 90 * 24 * 60 * 60;
  const now = Math.floor(Date.now() / 1000);

  const deleted = await env.DB.prepare(
    'DELETE FROM annotations WHERE last_accessed_at < ? OR (expires_at IS NOT NULL AND expires_at < ?) RETURNING id',
  )
    .bind(ninetyDaysAgo, now)
    .all<{ id: string }>();

  if (deleted.results.length > 0) {
    const keys = deleted.results.map((r) => `${r.id}.png`);
    const r2Deletes: Promise<void>[] = [];
    for (let i = 0; i < keys.length; i += 1000) {
      r2Deletes.push(env.OG_BUCKET.delete(keys.slice(i, i + 1000)));
    }
    await Promise.all(r2Deletes);
  }
};

export default { ...app, scheduled };
