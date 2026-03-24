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

// Static SEO/AI text responses — hoisted to avoid per-request allocation
const ROBOTS_TXT = `User-agent: *
Allow: /

# AI crawlers
User-agent: GPTBot
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: Google-Extended
Allow: /

Sitemap: https://marklayer.app/sitemap.xml`;

app.get('/robots.txt', (c) =>
  c.body(ROBOTS_TXT, 200, { 'Content-Type': 'text/plain', 'Cache-Control': 'public, max-age=86400' }),
);

const LLMS_TXT = `# MarkLayer

> Free webpage annotation and visual collaboration tool for Chrome.

MarkLayer is a Chrome extension that lets you draw, comment, and mark up any live website — then share a single link so anyone can see your annotations instantly. No account or sign-up required.

## Features

- Drawing tools: Freehand drawing, shapes, arrows, and lines on any webpage
- Real-time collaboration: Live cursors so everyone sees changes as they happen
- Shareable links: Share a link — recipients don't need the extension to view
- Threaded comments: Pin comments to any spot on the page
- No sign-up required: Just install and start annotating
- Private by default: Annotations are only shared when you choose
- Works on any website: No exceptions, one click to start
- Free and open source: No paywall, no trial period

## Links

- Website: https://marklayer.app
- Chrome Web Store: https://chromewebstore.google.com/detail/marklayer/fnfobegjifomgobgilaemihpcpidjamc
- GitHub: https://github.com/thevrus/MarkLayer
- Privacy Policy: https://marklayer.app/privacy

## How It Works

1. Install the MarkLayer Chrome extension (free)
2. Navigate to any webpage and click the MarkLayer icon
3. Draw, comment, or highlight anything on the page
4. Click "Share" to get a link anyone can open — no extension needed on their end
5. Collaborate in real time with live cursors

## FAQ

Q: Does the other person need the extension installed?
A: No. Anyone can view annotations via the share link — no install required.

Q: Is it really free?
A: Yes. No account, no paywall, no trial period.

Q: Does it work on any website?
A: Yes, MarkLayer works on any webpage.

Q: Can multiple people annotate at the same time?
A: Yes — real-time cursors let you collaborate live on any page.

## Contact

Email: rusinvadym@gmail.com

## Optional

- [Full details](/llms-full.txt)`;

app.get('/llms.txt', (c) =>
  c.body(LLMS_TXT, 200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=86400' }),
);

const LLMS_FULL_TXT = `# MarkLayer — Full Reference

> Free webpage annotation and visual collaboration tool for Chrome.

## What is MarkLayer?

MarkLayer is a free, open-source Chrome extension for annotating any webpage. Users can draw, comment, highlight, and add arrows directly on top of any live website. Annotations are shareable via a single link — the recipient does not need to install any extension or create an account to view them. Real-time collaboration is supported with live cursors.

MarkLayer is designed for designers, developers, QA engineers, product managers, and anyone who needs to give visual feedback on web content.

## Core Features

### Drawing Tools
Freehand drawing, shapes, arrows, and lines. Users can mark up any page with precision using a floating toolbar. Stroke colors and widths are customizable.

### Real-time Collaboration
Multiple users can annotate the same page simultaneously. Live cursors show each participant's position and name in real time, powered by WebSockets and Cloudflare Durable Objects.

### Shareable Links
One click generates a share link. Anyone who opens the link sees the annotated page in their browser — no extension, no account, no install required. The link loads the original webpage with annotations overlaid.

### Threaded Comments
Users can pin comments to any spot on the page. Comments support threaded replies, making it easy to have contextual conversations directly on the webpage rather than in external tools like Slack or email.

### No Sign-up Required
There is no registration, no email verification, and no onboarding flow. Users install the extension and start annotating immediately.

### Private by Default
Annotations stay on the user's device until they explicitly choose to share. There is no central feed, no public profile, and no social features.

### Works on Any Website
MarkLayer works on any webpage without exceptions. The extension injects a transparent canvas overlay on top of the page content.

### Free and Open Source
MarkLayer is completely free with no paywall, trial period, or premium tier. The source code is available on GitHub under an open-source license.

## Technical Architecture

- **Frontend:** Preact with Preact Signals for state management, Tailwind CSS for styling
- **Extension framework:** WXT (Web Extension Tools)
- **Backend:** Cloudflare Workers with Hono framework
- **Database:** Cloudflare D1 (SQLite)
- **Real-time:** WebSockets via Cloudflare Durable Objects
- **Storage:** Cloudflare R2 for OG images
- **Build:** Bun workspaces, Turborepo, Vite

## How It Works

1. Install the MarkLayer Chrome extension from the Chrome Web Store (free)
2. Navigate to any webpage
3. Click the MarkLayer icon in the browser toolbar to activate the annotation overlay
4. Use the floating toolbar to draw, add shapes, arrows, or pin comments
5. Click "Share" to generate a unique link
6. Send the link to anyone — they see the annotated page in their browser without needing the extension
7. For real-time collaboration, multiple users can open the same share link and annotate simultaneously

## Use Cases

- **Design review:** Annotate mockups or staging sites with visual feedback
- **QA and bug reporting:** Circle bugs, add arrows, and describe issues in context
- **Content review:** Highlight text, suggest edits, and comment on live articles
- **Client feedback:** Share annotated pages with clients who don't need any tools installed
- **Education:** Teachers can annotate web resources for students
- **Research:** Highlight and comment on academic papers or articles

## Frequently Asked Questions

Q: Does the other person need the extension installed?
A: No. Anyone can view annotations via the share link — no install required. The share link loads the original page with annotations overlaid in a web app.

Q: Is it really free?
A: Yes. No account, no paywall, no trial period. MarkLayer is open source.

Q: Does it work on any website?
A: Yes, MarkLayer works on any webpage. The extension injects a transparent overlay on top of any page content.

Q: Can multiple people annotate at the same time?
A: Yes — real-time cursors let you collaborate live on any page. Changes appear instantly for all participants.

Q: Is my data private?
A: Yes. Annotations stay on your device until you choose to share. There is no tracking, no public profiles, and no social feed.

Q: What browsers are supported?
A: MarkLayer works on Chrome and Chromium-based browsers (Edge, Brave, Arc, etc.).

## Links

- Website: https://marklayer.app
- Chrome Web Store: https://chromewebstore.google.com/detail/marklayer/fnfobegjifomgobgilaemihpcpidjamc
- GitHub: https://github.com/thevrus/MarkLayer
- Privacy Policy: https://marklayer.app/privacy

## Contact

Email: rusinvadym@gmail.com`;

app.get('/llms-full.txt', (c) =>
  c.body(LLMS_FULL_TXT, 200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=86400' }),
);

const SITEMAP_XML = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://marklayer.app/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>
  <url><loc>https://marklayer.app/privacy</loc><changefreq>monthly</changefreq><priority>0.3</priority></url>
  <url><loc>https://marklayer.app/llms.txt</loc><changefreq>monthly</changefreq><priority>0.2</priority></url>
</urlset>`;

app.get('/sitemap.xml', (c) =>
  c.body(SITEMAP_XML, 200, { 'Content-Type': 'application/xml', 'Cache-Control': 'public, max-age=86400' }),
);

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
