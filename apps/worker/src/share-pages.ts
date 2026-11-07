import { projectPagePath } from '@marklayer/brand/links';
import { Hono } from 'hono/tiny';
import { DEMO_ROOM } from '../shared/demo-room';
import type { Env } from './env';
import { hostnameOf } from './hostname';
import { lockedPages, openRoom, refuse } from './lock/gate';
import { unlockPage } from './lock/page';
import { collectTally, EMPTY_TALLY_LABEL, plural, tallyParts } from './og-tally';
import { captureServer } from './posthog';
import { ensureDemoRoom } from './rooms-lifecycle';
import { SHELL_CACHE, shellResponse } from './shell';
import { annotationStore, isExpired, projectStore } from './store';

const app = new Hono<Env>();

/**
 * What a share link says when it unfurls. The site's own blurb pitches the
 * product; this says what is actually on the page someone was sent.
 */
function shareDescription({ domain, ops }: { domain: string; ops: unknown[] }): string {
  const counts = tallyParts(collectTally(ops)).map((p) => `${p.n} ${plural(p)}`);
  const what = counts.length > 0 ? counts.join(', ') : EMPTY_TALLY_LABEL;
  return `${what} on ${domain}. Open it in any browser. No extension, no account, no sign-up.`;
}

app.get('/s/:id', async (c) => {
  const annotationId = c.req.param('id');
  const reqUrl = new URL(c.req.url);
  const annotations = annotationStore(c.env.DB);

  // The landing's embedded board mints the demo room, being what first asks for one.
  if (annotationId === DEMO_ROOM.id) await ensureDemoRoom(c.env.DB);

  // Read alongside the door, so a link that was never promoted pays no extra round trip.
  const [room, promotion] = await Promise.all([
    openRoom({ env: c.env, id: annotationId, headers: c.req.raw.headers, ctx: c.executionCtx }),
    annotationId === DEMO_ROOM.id ? null : annotations.getPromotion(annotationId),
  ]);
  if (!room.ok) return refuse(room, 'page', { returnTo: `/s/${annotationId}` });
  // Unlocked, but the tags below are what a link preview caches and reposts, so they stay generic.
  if (room.guarded) return shellResponse({ env: c.env, url: reqUrl });

  // Nothing unfurls an iframe, so the tags below are never read for the embedded board.
  if (reqUrl.searchParams.get('still') === '1') return shellResponse({ env: c.env, url: reqUrl });

  // Opening a second page from a share link made a new /p/ link; the /s/ link already sent follows it there.
  // A page dropped from its project is unlinked at that write, so a stale promotion never reaches here.
  if (promotion && !isExpired(promotion.expiresAt)) {
    const idx = promotion.pageIds.indexOf(annotationId);
    if (idx >= 0) {
      const location = projectPagePath({ projectId: promotion.projectId, idx, search: reqUrl.search });
      return new Response(null, { status: 302, headers: { Location: location, 'Cache-Control': 'no-store' } });
    }
  }

  const [pageUrl, ops] = await Promise.all([annotations.getUrl(annotationId), annotations.getOps(annotationId)]);
  let domain = hostnameOf(pageUrl);
  if (!domain) {
    const viewParam = reqUrl.searchParams.get('view');
    if (viewParam) {
      // D6: counted so the decoder here and in web/boot.ts can go once nothing arrives by it.
      captureServer(c.env, c.executionCtx, 'legacy_view_link', { route: '/s/:id' });
      try {
        const decoded = atob(decodeURIComponent(viewParam));
        const hashIdx = decoded.indexOf('#ant=');
        if (hashIdx > 0) domain = hostnameOf(decoded.substring(0, hashIdx));
      } catch {}
    }
  }
  domain ??= 'a webpage';
  const res = await shellResponse({ env: c.env, url: reqUrl });
  const ogImage = `${reqUrl.origin}/og/${annotationId}.png`;
  const title = `MarkLayer · Annotations on ${domain}`;
  const description = shareDescription({ domain, ops: ops ?? [] });
  return shareShell({ html: await res.text(), url: reqUrl.href, title, image: ogImage, description });
});

/** The `/` shell re-tagged for one share link; the home clip is stripped, a share card shows only its own still. */
function shareShell({
  html,
  url,
  title,
  image,
  description,
}: {
  html: string;
  url: string;
  title: string;
  image: string;
  description: string;
}) {
  const tagged = html
    .replace(/<meta property="og:url"[^>]*>/, `<meta property="og:url" content="${url}">`)
    .replace(/<meta property="og:title"[^>]*>/, `<meta property="og:title" content="${title}">`)
    .replace(/<meta property="og:image"[^>]*>/, `<meta property="og:image" content="${image}">`)
    .replace(/<meta property="og:video[^>]*>/g, '')
    .replace(/<meta property="og:description"[^>]*>/, `<meta property="og:description" content="${description}">`)
    .replace(/<meta name="twitter:description"[^>]*>/, `<meta name="twitter:description" content="${description}">`)
    .replace(/<meta name="twitter:title"[^>]*>/, `<meta name="twitter:title" content="${title}">`)
    .replace(/<meta name="twitter:image"[^>]*>/, `<meta name="twitter:image" content="${image}">`)
    .replace(/<link rel="canonical"[^>]*>/, `<link rel="canonical" href="${url}" />`);
  return new Response(tagged, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': SHELL_CACHE },
  });
}

app.get('/p/:id', async (c) => {
  const projectId = c.req.param('id');
  const reqUrl = new URL(c.req.url);
  // Asset shell is independent of the project metadata — fetch in parallel.
  const assetsPromise = shellResponse({ env: c.env, url: reqUrl });
  const project = await projectStore(c.env.DB).get(projectId);
  // A project has no password of its own; it asks for each protected page's in turn, returning here after each.
  const [firstLocked] = await lockedPages({
    db: c.env.DB,
    pageIds: project?.pageIds ?? [],
    headers: c.req.raw.headers,
  });
  if (firstLocked) return unlockPage({ roomId: firstLocked, returnTo: `/p/${projectId}`, reason: 'locked' });
  const firstPageId = project?.pageIds[0];
  const pageCount = project?.pageIds.length ?? 0;
  let domain = 'a project';
  let firstPageOps: unknown[] | null = null;
  if (firstPageId) {
    const pages = annotationStore(c.env.DB);
    const [firstUrl, ops] = await Promise.all([pages.getUrl(firstPageId), pages.getOps(firstPageId)]);
    firstPageOps = ops;
    domain = hostnameOf(firstUrl) ?? domain;
  }
  const res = await assetsPromise;
  const ogImage = `${reqUrl.origin}/og/${projectId}.png`;
  const pagesLabel = pageCount > 0 ? ` (${pageCount} pages)` : '';
  const title = `MarkLayer · Annotations on ${domain}${pagesLabel}`;
  const description = shareDescription({ domain, ops: firstPageOps ?? [] });
  return shareShell({ html: await res.text(), url: reqUrl.href, title, image: ogImage, description });
});

export { app as sharePages };
