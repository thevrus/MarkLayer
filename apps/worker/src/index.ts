import { Hono } from 'hono';
import { api } from './api';
import { generateOgImage } from './og';
import { aboutHtml, deriveDates } from './pages';
import { privacyHtml } from './privacy';
import { proxy } from './proxy';
import { mountSeoRoutes, SEO_URLS } from './seo';

export { AnnotationRoom } from './annotation-room';

export type Env = {
  Bindings: {
    DB: D1Database;
    ASSETS: Fetcher;
    ANNOTATION_ROOM: DurableObjectNamespace;
    OG_BUCKET: R2Bucket;
    TURN_KEY_ID?: string;
    TURN_KEY_TOKEN?: string;
    POSTHOG_KEY?: string;
    POSTHOG_HOST?: string;
  };
};

const app = new Hono<Env>();

/** Parse a JSON-encoded array of page ids, dropping any non-string entries. */
function parsePageIds(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

type OgOp = { tool: string; parentId?: string };
function isOgOp(o: unknown): o is OgOp {
  return !!o && typeof o === 'object' && 'tool' in o && typeof o.tool === 'string';
}
function parseOgOps(raw: string): OgOp[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isOgOp) : [];
  } catch {
    return [];
  }
}

app.route('/api', api);

app.get('/privacy', (c) => c.html(privacyHtml));
app.get('/about', (c) => c.html(aboutHtml));

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
  const title = `MarkLayer \u00b7 Annotations on ${domain}`;
  html = html
    .replace(/<meta property="og:url"[^>]*>/, `<meta property="og:url" content="${reqUrl.href}">`)
    .replace(/<meta property="og:title"[^>]*>/, `<meta property="og:title" content="${title}">`)
    .replace(/<meta property="og:image"[^>]*>/, `<meta property="og:image" content="${ogImage}">`)
    .replace(/<meta name="twitter:title"[^>]*>/, `<meta name="twitter:title" content="${title}">`)
    .replace(/<meta name="twitter:image"[^>]*>/, `<meta name="twitter:image" content="${ogImage}">`)
    .replace(/<link rel="canonical"[^>]*>/, `<link rel="canonical" href="${reqUrl.href}" />`);
  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
  });
});

// Shared project page (multi-page annotation bundle)
app.get('/p/:id', async (c) => {
  const projectId = c.req.param('id');
  const reqUrl = new URL(c.req.url);
  let domain = 'a project';
  let pageCount = 0;
  // Asset shell is independent of the project metadata — fetch in parallel.
  const assetsPromise = c.env.ASSETS.fetch(new Request(new URL('/', reqUrl)));
  const projectRow = await c.env.DB.prepare('SELECT page_ids FROM projects WHERE id = ?')
    .bind(projectId)
    .first<{ page_ids: string }>();
  if (projectRow) {
    try {
      const pageIds = parsePageIds(projectRow.page_ids);
      pageCount = pageIds.length;
      if (pageIds.length > 0) {
        const first = await c.env.DB.prepare('SELECT url FROM annotations WHERE id = ?')
          .bind(pageIds[0])
          .first<{ url: string | null }>();
        if (first?.url) {
          try {
            domain = new URL(first.url).hostname;
          } catch {}
        }
      }
    } catch {}
  }
  const res = await assetsPromise;
  let html = await res.text();
  const ogImage = `${reqUrl.origin}/og/${projectId}.png?domain=${encodeURIComponent(domain)}`;
  const pagesLabel = pageCount > 0 ? ` (${pageCount} pages)` : '';
  const title = `MarkLayer · Annotations on ${domain}${pagesLabel}`;
  html = html
    .replace(/<meta property="og:url"[^>]*>/, `<meta property="og:url" content="${reqUrl.href}">`)
    .replace(/<meta property="og:title"[^>]*>/, `<meta property="og:title" content="${title}">`)
    .replace(/<meta property="og:image"[^>]*>/, `<meta property="og:image" content="${ogImage}">`)
    .replace(/<meta name="twitter:title"[^>]*>/, `<meta name="twitter:title" content="${title}">`)
    .replace(/<meta name="twitter:image"[^>]*>/, `<meta name="twitter:image" content="${ogImage}">`)
    .replace(/<link rel="canonical"[^>]*>/, `<link rel="canonical" href="${reqUrl.href}" />`);
  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
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

  let ops: OgOp[] = [];
  const annoRow = await c.env.DB.prepare('SELECT ops FROM annotations WHERE id = ?').bind(id).first<{ ops: string }>();
  if (annoRow) {
    ops = parseOgOps(annoRow.ops);
  } else {
    // Fall back to project: render the first page's ops as the preview
    const projRow = await c.env.DB.prepare('SELECT page_ids FROM projects WHERE id = ?')
      .bind(id)
      .first<{ page_ids: string }>();
    if (projRow) {
      const pageIds = parsePageIds(projRow.page_ids);
      if (pageIds.length > 0) {
        const firstPage = await c.env.DB.prepare('SELECT ops FROM annotations WHERE id = ?')
          .bind(pageIds[0])
          .first<{ ops: string }>();
        if (firstPage) ops = parseOgOps(firstPage.ops);
      }
    }
  }
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

> 100% free and 100% anonymous webpage annotation tool for Chrome. No account, no email, no sign-up.

MarkLayer is a Chrome extension that lets you draw, comment, and mark up any live website, then share a single link so anyone can see your annotations instantly. There is no account, no email, no sign-up, no payment, and no trial period.

## Pricing

Free. There is no paid plan. There is no trial. There is no per-seat pricing. Everything is included. See https://marklayer.app/pricing or https://marklayer.app/pricing.md for the machine-readable version.

## Anonymous by design

- No sign-up, no email verification, no login
- No personal data collected
- Random local display name and color generated in your browser
- Annotations stay on your device until you choose to share

## Features

- Drawing tools: Freehand drawing, shapes, arrows, and lines on any webpage
- Real-time collaboration: Live cursors with unlimited collaborators per session
- Shareable links: Recipients don't need the extension or an account to view
- Threaded comments: Pin comments to any spot on the page
- Works on any website: Production, staging, internal tools, third-party sites
- Open source and self-hostable

## Use cases

- Design review: https://marklayer.app/for/design-review
- QA and bug reporting: https://marklayer.app/for/qa-bug-reporting
- Client feedback: https://marklayer.app/for/client-feedback
- Remote teams: https://marklayer.app/for/remote-teams
- Students: https://marklayer.app/for/students
- Educators: https://marklayer.app/for/educators
- Researchers: https://marklayer.app/for/researchers
- Content creators: https://marklayer.app/for/content-creators
- Marketers: https://marklayer.app/for/marketers

## Comparisons

- vs Markup.io: https://marklayer.app/vs/markup-io
- vs Pastel: https://marklayer.app/vs/pastel
- vs BugHerd: https://marklayer.app/vs/bugherd
- vs Hypothesis: https://marklayer.app/vs/hypothesis
- vs AnnotateWeb: https://marklayer.app/vs/annotateweb
- vs Jam.dev: https://marklayer.app/vs/jam
- vs Marker.io: https://marklayer.app/vs/marker-io
- vs Userback: https://marklayer.app/vs/userback
- vs Ruttl: https://marklayer.app/vs/ruttl
- vs Loom: https://marklayer.app/vs/loom

## Free alternatives lists

- Free Markup.io alternatives: https://marklayer.app/alternatives/markup-io
- Free Pastel alternatives: https://marklayer.app/alternatives/pastel
- Free BugHerd alternatives: https://marklayer.app/alternatives/bugherd
- Free AnnotateWeb alternatives: https://marklayer.app/alternatives/annotateweb
- Free Jam.dev alternatives: https://marklayer.app/alternatives/jam
- Free Marker.io alternatives: https://marklayer.app/alternatives/marker-io
- Free Userback alternatives: https://marklayer.app/alternatives/userback
- Hypothesis alternatives: https://marklayer.app/alternatives/hypothesis

## Links

- Website: https://marklayer.app
- Pricing: https://marklayer.app/pricing
- Chrome Web Store: https://chromewebstore.google.com/detail/marklayer/fnfobegjifomgobgilaemihpcpidjamc
- GitHub: https://github.com/thevrus/MarkLayer
- Privacy Policy: https://marklayer.app/privacy

## How It Works

1. Install the MarkLayer Chrome extension (free, no account)
2. Navigate to any webpage and click the MarkLayer icon
3. Draw, comment, or highlight anything on the page
4. Click "Share" to get a link anyone can open. No extension needed on their end
5. Collaborate in real time with live cursors

## FAQ

Q: Is MarkLayer really free?
A: Yes. 100% free. No paid plan, no trial, no per-seat pricing, no usage cap.

Q: Is MarkLayer anonymous?
A: Yes. No sign-up, no email, no profile, no login. No personal data is collected.

Q: Does the other person need the extension installed?
A: No. Anyone can view annotations via the share link. No install required.

Q: Does it work on any website?
A: Yes, MarkLayer works on any webpage.

Q: Can multiple people annotate at the same time?
A: Yes. Real-time live cursors let unlimited collaborators work together.

## Contact

Email: rusinvadym@gmail.com

## Optional

- [Full details](/llms-full.txt)`;

app.get('/llms.txt', (c) =>
  c.body(LLMS_TXT, 200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=86400' }),
);

const LLMS_FULL_TXT = `# MarkLayer · Full Reference

> 100% free and 100% anonymous webpage annotation tool for Chrome. No account, no email, no sign-up, no payment.

## What is MarkLayer?

MarkLayer is a free, anonymous, open-source Chrome extension for annotating any webpage. Users can draw, comment, highlight, and add arrows directly on top of any live website. Annotations are shareable via a single link. The recipient does not need to install any extension or create an account to view them. Real-time collaboration is supported with live cursors.

The two defining principles are **free** (no paid plan, no trial, no per-seat pricing, no usage cap) and **anonymous** (no sign-up, no email, no profile, no login, no personal data collection).

MarkLayer is designed for designers, developers, QA engineers, product managers, agencies, and anyone who needs to give visual feedback on web content without onboarding the recipient through yet another account flow.

## Core Features

### Drawing Tools
Freehand drawing, shapes, arrows, and lines. Users can mark up any page with precision using a floating toolbar. Stroke colors and widths are customizable.

### Real-time Collaboration
Multiple users can annotate the same page simultaneously. Live cursors show each participant's position and name in real time, powered by WebSockets and Cloudflare Durable Objects.

### Shareable Links
One click generates a share link. Anyone who opens the link sees the annotated page in their browser. No extension, no account, no install required. The link loads the original webpage with annotations overlaid.

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
6. Send the link to anyone. They see the annotated page in their browser without needing the extension
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
A: No. Anyone can view annotations via the share link. No install required. The share link loads the original page with annotations overlaid in a web app.

Q: Is it really free?
A: Yes. No account, no paywall, no trial period. MarkLayer is open source.

Q: Does it work on any website?
A: Yes, MarkLayer works on any webpage. The extension injects a transparent overlay on top of any page content.

Q: Can multiple people annotate at the same time?
A: Yes. Real-time cursors let you collaborate live on any page. Changes appear instantly for all participants.

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

/** Pick a stable per-URL slug for date derivation so each sitemap entry has its own lastmod. */
function sitemapLastmod(path: string): string {
  if (path === '/') return deriveDates('home').modified;
  if (path === '/compare') return deriveDates('hub-compare').modified;
  if (path === '/alternatives') return deriveDates('hub-alternatives').modified;
  if (path === '/use-cases') return deriveDates('hub-use-cases').modified;
  if (path.startsWith('/vs/')) return deriveDates(path.slice(4)).modified;
  if (path.startsWith('/alternatives/')) return deriveDates(`alt-${path.slice(14)}`).modified;
  if (path.startsWith('/for/')) return deriveDates(`for-${path.slice(5)}`).modified;
  if (path === '/pricing') return deriveDates('pricing').modified;
  if (path === '/about') return deriveDates('about').modified;
  if (path === '/privacy') return deriveDates('privacy').modified;
  return deriveDates(path).modified;
}

const SEO_URL_ENTRIES = SEO_URLS.map(
  (path) =>
    `  <url><loc>https://marklayer.app${path}</loc><lastmod>${sitemapLastmod(path)}</lastmod><changefreq>monthly</changefreq><priority>0.7</priority></url>`,
).join('\n');

const SITEMAP_XML = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://marklayer.app/</loc><lastmod>${sitemapLastmod('/')}</lastmod><changefreq>weekly</changefreq><priority>1.0</priority></url>
${SEO_URL_ENTRIES}
  <url><loc>https://marklayer.app/privacy</loc><lastmod>${sitemapLastmod('/privacy')}</lastmod><changefreq>monthly</changefreq><priority>0.3</priority></url>
  <url><loc>https://marklayer.app/llms.txt</loc><lastmod>${sitemapLastmod('/about')}</lastmod><changefreq>monthly</changefreq><priority>0.2</priority></url>
  <url><loc>https://marklayer.app/llms-full.txt</loc><lastmod>${sitemapLastmod('/about')}</lastmod><changefreq>monthly</changefreq><priority>0.2</priority></url>
</urlset>`;

app.get('/sitemap.xml', (c) =>
  c.body(SITEMAP_XML, 200, { 'Content-Type': 'application/xml', 'Cache-Control': 'public, max-age=86400' }),
);

// Mount SEO landing pages (comparisons, alternatives, use-cases, pricing)
mountSeoRoutes(app);

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

  // Same retention policy for project bundles
  const deletedProjects = await env.DB.prepare(
    'DELETE FROM projects WHERE last_accessed_at < ? OR (expires_at IS NOT NULL AND expires_at < ?) RETURNING id',
  )
    .bind(ninetyDaysAgo, now)
    .all<{ id: string }>();
  if (deletedProjects.results.length > 0) {
    const keys = deletedProjects.results.map((r) => `${r.id}.png`);
    const r2Deletes: Promise<void>[] = [];
    for (let i = 0; i < keys.length; i += 1000) {
      r2Deletes.push(env.OG_BUCKET.delete(keys.slice(i, i + 1000)));
    }
    await Promise.all(r2Deletes);
  }
};

export default { ...app, scheduled };
