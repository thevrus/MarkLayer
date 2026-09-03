import { isUploadId, MAX_UPLOAD_BYTES, RETENTION_DAYS, uploadPath } from '@marklayer/types';
import LLMS_TXT from '@site/content/agent/llms.txt?raw';
import LLMS_FULL_TXT from '@site/content/agent/llms-full.txt?raw';
import ROBOTS_TXT from '@site/content/agent/robots.txt?raw';
import SKILL_MD from '@site/content/agent/SKILL.md?raw';
import { API_CATALOG, MCP_SERVER_CARD, SKILL_PATH, skillIndex } from '@site/lib/agent';
import type { Context } from 'hono';
import { Hono } from 'hono/tiny';
import { nanoid } from 'nanoid';
import { api } from './api';
import { auth, authStore } from './auth';
import type { EmailEnv } from './email';
import { cachedPng, dayCached, once, sha256Hex } from './http';
import { generateOgImage, generatePageOgImage } from './og';
import { collectTally, EMPTY_TALLY_LABEL, plural, tallyParts } from './og-tally';
import { proxy } from './proxy';
import { annotationStore, nowInSeconds, projectStore, uploadStore } from './store';
import { extensionFor, isUploadType, sniffUploadType } from './uploads';

export { AnnotationRoom } from './annotation-room';

export type Env = {
  Bindings: {
    DB: D1Database;
    ASSETS: Fetcher;
    ANNOTATION_ROOM: DurableObjectNamespace;
    OG_BUCKET: R2Bucket;
    FILE_BUCKET: R2Bucket;
    TURN_KEY_ID?: string;
    TURN_KEY_TOKEN?: string;
    POSTHOG_KEY?: string;
    POSTHOG_HOST?: string;
    /**
     * The fixed-IP relay (apps/fetcher) the proxy falls back to when a host
     * blocks Cloudflare's shared egress. Both unset — the default — means no
     * fallback, which is how the proxy behaved before the relay existed.
     */
    FETCHER_URL?: string;
    FETCHER_TOKEN?: string;
    /**
     * Off switch. Set to "false" to stop using the relay while leaving its URL
     * and token in place — the way to turn the fallback off without deleting
     * config, and the first thing to reach for if the relay host misbehaves.
     */
    FETCHER_ENABLED?: string;
    /**
     * Fallback for the relay's public address, shown to a user whose host blocks
     * even that. Only read when the relay never answered — when it did, it
     * reports its own address on the response, which cannot go stale.
     */
    FETCHER_EGRESS_IP?: string;
    /**
     * Sign-in email, from `EmailEnv` so the bindings the mailer reads are
     * declared once. `EMAIL` is the Cloudflare Email Service send binding and is
     * preferred; `RESEND_API_KEY` is the swap if its unpublished daily quota
     * ever bites. Neither set — the default in dev and in a fork — logs the
     * link instead of sending it, so sign-in still works locally.
     */
  } & EmailEnv;
};

const app = new Hono<Env>();

// HSTS (Cloudflare Security Insights: "Domains without HSTS"). TLS terminates
// at the Cloudflare edge, so the worker never sees plaintext requests — the
// HTTP→HTTPS redirect belongs at the zone level ("Always Use HTTPS"), not here.
// 2-year max-age with includeSubDomains + preload meets the hstspreload.org
// submission threshold.
const HSTS = 'max-age=63072000; includeSubDomains; preload';
app.use('*', async (c, next) => {
  await next();
  // Skip 101 WebSocket upgrades — their headers are locked. Header objects from
  // upstream fetches (proxy, assets) can be immutable, so rebuild on failure.
  if (c.res.status !== 101) {
    try {
      c.res.headers.set('Strict-Transport-Security', HSTS);
    } catch {
      const headers = new Headers(c.res.headers);
      headers.set('Strict-Transport-Security', HSTS);
      c.res = new Response(c.res.body, { status: c.res.status, statusText: c.res.statusText, headers });
    }
  }
});

/**
 * What a share link says when it unfurls. The site's own blurb pitches the
 * product; this says what is actually on the page someone was sent.
 */
function shareDescription({ domain, ops }: { domain: string; ops: unknown[] }): string {
  const counts = tallyParts(collectTally(ops)).map((p) => `${p.n} ${plural(p)}`);
  const what = counts.length > 0 ? counts.join(', ') : EMPTY_TALLY_LABEL;
  return `${what} on ${domain}. Open it in any browser. No extension, no account, no sign-up.`;
}

app.route('/api', api);

// Shared annotation page — injects dynamic OG tags then serves the SPA
app.get('/s/:id', async (c) => {
  const annotationId = c.req.param('id');
  const reqUrl = new URL(c.req.url);
  let domain = 'a webpage';
  const annotations = annotationStore(c.env.DB);
  const [pageUrl, ops] = await Promise.all([annotations.getUrl(annotationId), annotations.getOps(annotationId)]);
  if (pageUrl) {
    try {
      domain = new URL(pageUrl).hostname;
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
  const description = shareDescription({ domain, ops: ops ?? [] });
  html = html
    .replace(/<meta property="og:url"[^>]*>/, `<meta property="og:url" content="${reqUrl.href}">`)
    .replace(/<meta property="og:title"[^>]*>/, `<meta property="og:title" content="${title}">`)
    .replace(/<meta property="og:image"[^>]*>/, `<meta property="og:image" content="${ogImage}">`)
    .replace(/<meta property="og:description"[^>]*>/, `<meta property="og:description" content="${description}">`)
    .replace(/<meta name="twitter:description"[^>]*>/, `<meta name="twitter:description" content="${description}">`)
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
  const project = await projectStore(c.env.DB).get(projectId);
  const firstPageId = project?.pageIds[0];
  pageCount = project?.pageIds.length ?? 0;
  let firstPageOps: unknown[] | null = null;
  if (firstPageId) {
    const pages = annotationStore(c.env.DB);
    const [firstUrl, ops] = await Promise.all([pages.getUrl(firstPageId), pages.getOps(firstPageId)]);
    firstPageOps = ops;
    if (firstUrl) {
      try {
        domain = new URL(firstUrl).hostname;
      } catch {}
    }
  }
  const res = await assetsPromise;
  let html = await res.text();
  const ogImage = `${reqUrl.origin}/og/${projectId}.png?domain=${encodeURIComponent(domain)}`;
  const pagesLabel = pageCount > 0 ? ` (${pageCount} pages)` : '';
  const title = `MarkLayer · Annotations on ${domain}${pagesLabel}`;
  const description = shareDescription({ domain, ops: firstPageOps ?? [] });
  html = html
    .replace(/<meta property="og:url"[^>]*>/, `<meta property="og:url" content="${reqUrl.href}">`)
    .replace(/<meta property="og:title"[^>]*>/, `<meta property="og:title" content="${title}">`)
    .replace(/<meta property="og:image"[^>]*>/, `<meta property="og:image" content="${ogImage}">`)
    .replace(/<meta property="og:description"[^>]*>/, `<meta property="og:description" content="${description}">`)
    .replace(/<meta name="twitter:description"[^>]*>/, `<meta name="twitter:description" content="${description}">`)
    .replace(/<meta name="twitter:title"[^>]*>/, `<meta name="twitter:title" content="${title}">`)
    .replace(/<meta name="twitter:image"[^>]*>/, `<meta name="twitter:image" content="${ogImage}">`)
    .replace(/<link rel="canonical"[^>]*>/, `<link rel="canonical" href="${reqUrl.href}" />`);
  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
  });
});

/**
 * The marketing pages' OG card. Registered before `/og/:key` so it is not read
 * as an annotation id.
 *
 * The heading arrives as a query param rather than being looked up: those pages
 * are prerendered in apps/site and the Worker has no copy of their content. That
 * makes the text caller-supplied, which is the same exposure `?domain=` on the
 * share card already carries — it is escaped into the SVG, and clamped here so a
 * long string cannot turn into work.
 */
app.get('/og/page.png', async (c) => {
  const heading = (c.req.query('h') ?? '').slice(0, 200).replace(/\p{C}/gu, ' ').trim();
  const path = (c.req.query('p') ?? '/').slice(0, 120).replace(/\p{C}/gu, '').trim();
  if (!heading) return c.notFound();

  const key = `page/${(await sha256Hex(`${heading}|${path}`)).slice(0, 32)}.png`;
  return cachedPng({
    bucket: c.env.OG_BUCKET,
    key,
    ctx: c.executionCtx,
    render: () => generatePageOgImage({ heading, path }),
  });
});

// Generate OG preview image on-the-fly (cached in R2)
app.get('/og/:key', async (c) => {
  const key = c.req.param('key');
  if (!key.endsWith('.png')) return c.notFound();
  const id = key.slice(0, -4);
  const domain = c.req.query('domain') || 'a webpage';

  return cachedPng({
    bucket: c.env.OG_BUCKET,
    key,
    ctx: c.executionCtx,
    render: async () => {
      const annotations = annotationStore(c.env.DB);
      let stored = await annotations.getOps(id);
      if (!stored) {
        // Fall back to project: render the first page's ops as the preview
        const firstPageId = (await projectStore(c.env.DB).get(id))?.pageIds[0];
        if (firstPageId) stored = await annotations.getOps(firstPageId);
      }
      return generateOgImage({ domain, ops: stored ?? [] });
    },
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

// Anonymous file upload, so a share can annotate a local PDF or image and not
// just a public URL. The id itself is the access token, same as an annotation's.
app.post('/f', async (c) => {
  const reader = c.req.raw.body?.getReader();
  if (!reader) return c.text('Empty body', 400);

  // Read as a stream and count bytes as they arrive — a Content-Length header
  // is only a claim from the client, so the cap has to hold against the bytes
  // actually received, and stop pulling once it's blown rather than buffering
  // an oversized body just to reject it after the fact.
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_UPLOAD_BYTES) {
      await reader.cancel();
      return c.text('File too large', 413);
    }
    chunks.push(value);
  }

  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  // Sniff the real bytes, never the client's declared Content-Type: this type is
  // what `/f/{id}` will later hand a browser on our own origin.
  const contentType = sniffUploadType(body);
  if (!contentType) return c.text('Unsupported file type', 415);

  const id = nanoid();
  // Row first: the cleanup cron sweeps R2 by what it finds in D1, so an object
  // written without one would never be collected. The reverse order only risks a
  // row pointing at nothing, which reads as a 404 and expires on its own.
  await uploadStore(c.env.DB).put({ id, size });
  await c.env.FILE_BUCKET.put(id, body, { httpMetadata: { contentType } });
  return c.json({ id, url: uploadPath(id) });
});

app.get('/f/:id', async (c) => {
  const id = c.req.param('id');
  if (!isUploadId(id)) return c.notFound();

  const object = await c.env.FILE_BUCKET.get(id);
  if (!object) return c.notFound();

  // Written by the upload route, but re-checked rather than echoed: this value
  // becomes a `Content-Type` the browser acts on.
  const stored = object.httpMetadata?.contentType;
  if (!isUploadType(stored)) return c.notFound();

  // Push the retention clock back without delaying the response the browser is
  // waiting on to render the file.
  c.executionCtx.waitUntil(uploadStore(c.env.DB).touch(id));

  return new Response(object.body, {
    headers: {
      'Content-Type': stored,
      // Load-bearing: without this, a sniffing browser could treat the bytes at
      // this URL as something other than what they were stored as and execute
      // them as the app's own origin.
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': `inline; filename="document.${extensionFor(stored)}"`,
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
});

// The agent-facing text surface. apps/site owns the source (it also prerenders
// these paths for its standalone deploy), but `run_worker_first` claims them
// here, so the Worker is what actually answers in production — reading the same
// files rather than restating them is the only thing keeping the two honest.
app.get('/robots.txt', (c) => c.body(ROBOTS_TXT, 200, dayCached('text/plain')));

app.get('/llms.txt', (c) => c.body(LLMS_TXT, 200, dayCached('text/plain; charset=utf-8')));

app.get('/llms-full.txt', (c) => c.body(LLMS_FULL_TXT, 200, dayCached('text/plain; charset=utf-8')));

// RFC 8288 Link headers pointing agents at machine-readable resources. Uses
// IANA-registered relation types: service-doc (human/agent docs), service-desc
// (fuller machine description), and sitemap. Surfaced on the homepage so an
// agent hitting `/` discovers them without parsing HTML.
const HOMEPAGE_LINK_HEADER = [
  '</.well-known/api-catalog>; rel="api-catalog"; type="application/linkset+json"',
  '</llms.txt>; rel="service-doc"; type="text/markdown"',
  '</llms-full.txt>; rel="service-desc"; type="text/markdown"',
  '</sitemap.xml>; rel="sitemap"; type="application/xml"',
].join(', ');

app.get('/.well-known/api-catalog', (c) =>
  c.body(JSON.stringify(API_CATALOG), 200, dayCached('application/linkset+json')),
);

// RFC 9116 security.txt (Cloudflare Security Insights: "Security.txt not
// configured"). Gives researchers a clear vulnerability-disclosure channel.
// Expires is required and must be < 1 year out; computed lazily on first
// request (Date in module-global scope is unreliable on Workers) and memoized,
// landing ~1 year ahead and refreshing on every redeploy/isolate restart so it
// never goes stale.
const securityTxt = once(() => {
  const expires = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
  return `Contact: mailto:hello@marklayer.app
Expires: ${expires}
Preferred-Languages: en
Canonical: https://marklayer.app/.well-known/security.txt
`;
});

app.get('/.well-known/security.txt', (c) => c.body(securityTxt(), 200, dayCached('text/plain; charset=utf-8')));

app.get(SKILL_PATH, (c) => c.body(SKILL_MD, 200, dayCached('text/markdown; charset=utf-8')));

// Built once per isolate and memoized: the digest is computed from the SKILL.md
// bytes this Worker actually serves, so it always matches — even if the skill
// text is edited — with no manual bookkeeping.
const skillIndexJson = once(async () => JSON.stringify(skillIndex(`sha256:${await sha256Hex(SKILL_MD)}`)));

app.get('/.well-known/agent-skills/index.json', async (c) =>
  c.body(await skillIndexJson(), 200, dayCached('application/json; charset=utf-8')),
);

app.get('/.well-known/mcp/server-card.json', (c) =>
  c.body(JSON.stringify(MCP_SERVER_CARD), 200, dayCached('application/json; charset=utf-8')),
);

// Rough token estimate (~4 chars/token) for the x-markdown-tokens hint agents
// use to budget context before fetching the markdown body.
const LLMS_TXT_TOKENS = String(Math.ceil(LLMS_TXT.length / 4));

// Homepage: serve agent-friendly Link headers, and a markdown representation
// when the client negotiates `Accept: text/markdown` (Markdown for Agents).
app.get('/', async (c) => {
  const accept = c.req.header('Accept') || '';
  if (accept.includes('text/markdown')) {
    return c.body(LLMS_TXT, 200, {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
      Vary: 'Accept',
      Link: HOMEPAGE_LINK_HEADER,
      'x-markdown-tokens': LLMS_TXT_TOKENS,
    });
  }
  const res = await c.env.ASSETS.fetch(new Request(new URL('/', c.req.url)));
  const headers = new Headers(res.headers);
  headers.set('Link', HOMEPAGE_LINK_HEADER);
  headers.append('Vary', 'Accept');
  return new Response(res.body, { status: res.status, headers });
});

app.route('/auth', auth);

// The dashboard is its own bundle (app.html), so `/app` resolves from the asset
// layer — but `/app/links` does not, and an unmatched path falls through to the
// proxy catch-all, which would try to fetch it as a remote URL. Serve the same
// shell for every path under /app and let the client router read the rest.
// `/app`, not `/app.html`: the asset layer redirects the extension away.
const appShell = (c: Context<Env>) => c.env.ASSETS.fetch(new Request(new URL('/app', c.req.url)));
app.get('/app', appShell);
app.get('/app/*', appShell);

// Proxy + catch-all (must be last)
app.route('/', proxy);

// Scheduled cleanup: delete stale and expired annotations + their OG images
const scheduled: ExportedHandlerScheduledHandler<Env['Bindings']> = async (_event, env) => {
  const staleBefore = nowInSeconds() - RETENTION_DAYS * 24 * 60 * 60;

  // R2 caps a batch delete at 1000 keys.
  const dropKeys = async ({ bucket, keys }: { bucket: R2Bucket; keys: string[] }) => {
    const batches: Promise<void>[] = [];
    for (let i = 0; i < keys.length; i += 1000) {
      batches.push(bucket.delete(keys.slice(i, i + 1000)));
    }
    await Promise.all(batches);
  };
  const dropOgCards = (ids: string[]) => dropKeys({ bucket: env.OG_BUCKET, keys: ids.map((id) => `${id}.png`) });

  // Same retention policy for single annotations and project bundles.
  await dropOgCards(await annotationStore(env.DB).deleteExpired({ unusedSince: staleBefore }));
  await dropOgCards(await projectStore(env.DB).deleteExpired({ unusedSince: staleBefore }));

  // Expired sessions and spent magic links are dead weight, not history.
  await authStore(env.DB).sweepExpired();

  // Uploaded PDFs get the same window, keyed off their own last_accessed_at —
  // an upload that never makes it into a shared annotation must still be
  // collected, not just the annotations that reference one.
  await dropKeys({
    bucket: env.FILE_BUCKET,
    keys: await uploadStore(env.DB).deleteExpired({ unusedSince: staleBefore }),
  });
};

export default { ...app, scheduled };
