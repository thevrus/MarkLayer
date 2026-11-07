import { Hono } from 'hono/tiny';
import { cachedPng } from './cache';
import { sha256Hex } from './encoding';
import type { Env } from './env';
import { hostnameOf } from './hostname';
import { ogSubject } from './lock/gate';
import { generateOgImage, generatePageOgImage } from './og';
import { overRateLimit } from './rate-limit';
import { ogCardKey } from './rooms-lifecycle';
import { annotationStore } from './store';

const app = new Hono<Env>();

/**
 * The marketing pages' OG card. Registered before `/og/:key` so it is not read
 * as an annotation id.
 *
 * The heading arrives as a query param rather than being looked up: those pages
 * are prerendered in apps/site and the Worker has no copy of their content. That
 * makes the text caller-supplied: it is escaped into the SVG, and clamped here so
 * a long string cannot turn into work.
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
    // The heading is caller-supplied, so varying it forces a fresh rasterize on every request.
    admit: async () => !(await overRateLimit({ limiter: c.env.FETCH_LIMITER, req: c.req })),
  });
});

/** The site-wide card from the asset layer, which says nothing about any one room. */
const GENERIC_OG_IMAGE = '/og.jpg';

app.get('/og/:key', async (c) => {
  const key = c.req.param('key');
  if (!key.endsWith('.png')) return c.notFound();
  const id = key.slice(0, -4);

  // The site's own card, not a rendered one: the domain, the tally and even the favicon would each describe the room.
  const pageId = await ogSubject({ db: c.env.DB, id });
  if (!pageId) return c.redirect(GENERIC_OG_IMAGE, 302);

  return cachedPng({
    bucket: c.env.OG_BUCKET,
    key: ogCardKey(id),
    ctx: c.executionCtx,
    render: async () => {
      const pages = annotationStore(c.env.DB);
      const [url, ops] = await Promise.all([pages.getUrl(pageId), pages.getOps(pageId)]);
      return generateOgImage({ domain: hostnameOf(url) ?? 'a webpage', ops: ops ?? [] });
    },
    admit: async () => !(await overRateLimit({ limiter: c.env.FETCH_LIMITER, req: c.req })),
  });
});

export { app as ogRoutes };
