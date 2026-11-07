import { ORIGIN } from '@marklayer/brand';
import type { APIRoute } from 'astro';
import dates from '../data/page-dates.json';
import { getAlternatives, getComparisons, getGuides, getReleases, getUseCases } from '../lib/collections';
import { alternativesPath, forPath, guidePath, releasePath, vsPath } from '../lib/site';

type Entry = { path: string; lastmod: string; changefreq: string; priority: string };

const url = ({ path, lastmod, changefreq, priority }: Entry): string =>
  `  <url><loc>${ORIGIN}${path}</loc><lastmod>${lastmod}</lastmod><changefreq>${changefreq}</changefreq><priority>${priority}</priority></url>`;

/**
 * Owned by the site rather than the Worker: the page list lives here now, and a
 * sitemap that has to be kept in sync by hand across two deployments goes stale.
 * Only indexable pages belong in it: llms.txt and llms-full.txt are for agents, not
 * search results, and listing them only invites a "crawled, not indexed" report.
 */
export const GET: APIRoute = async () => {
  const [comparisons, alternatives, useCases, guides, releases] = await Promise.all([
    getComparisons(),
    getAlternatives(),
    getUseCases(),
    getGuides(),
    getReleases(),
  ]);

  const article = (path: string, lastmod: string): Entry => ({
    path,
    lastmod,
    changefreq: 'monthly',
    priority: '0.7',
  });

  const entries: Entry[] = [
    { path: '/', lastmod: dates.home.modified, changefreq: 'weekly', priority: '1.0' },
    // Above the hubs: it is the one page that answers what the product does, and
    // it changes on every release rather than on an editorial cadence.
    { path: '/features', lastmod: dates.features.modified, changefreq: 'weekly', priority: '0.9' },
    { path: '/mcp', lastmod: dates.mcp.modified, changefreq: 'monthly', priority: '0.8' },
    article('/compare', dates['hub-compare'].modified),
    article('/alternatives', dates['hub-alternatives'].modified),
    article('/use-cases', dates['hub-use-cases'].modified),
    article('/guides', dates['hub-guides'].modified),
    // The changelog gains an entry on every release, so it is re-crawled on the
    // home page's cadence rather than a hub's monthly one.
    { path: '/changelog', lastmod: dates['hub-changelog'].modified, changefreq: 'weekly', priority: '0.8' },
    ...comparisons.map((c) => article(vsPath(c.id), c.data.modified)),
    ...alternatives.map((a) => article(alternativesPath(a.id), a.data.modified)),
    ...useCases.map((u) => article(forPath(u.id), u.data.modified)),
    ...guides.map((g) => article(guidePath(g.id), g.data.modified)),
    // A shipped release never changes again, so `yearly` is the honest signal.
    ...releases.map((r) => ({
      path: releasePath(r.id),
      lastmod: r.data.date,
      changefreq: 'yearly',
      priority: '0.5',
    })),
    article('/pricing', dates.pricing.modified),
    // Lower than a hub: it is in the nav and it should be findable, but it is
    // not a page anybody is searching for.
    { path: '/support', lastmod: dates.support.modified, changefreq: 'monthly', priority: '0.4' },
    article('/about', dates.about.modified),
    { path: '/privacy', lastmod: dates.privacy.modified, changefreq: 'monthly', priority: '0.3' },
    { path: '/bot', lastmod: dates.bot.modified, changefreq: 'yearly', priority: '0.2' },
  ];

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.map(url).join('\n')}
</urlset>`;

  return new Response(body, { headers: { 'Content-Type': 'application/xml' } });
};
