import { alternativesH1, compareH1, getAlternatives, getComparisons, getGuides, getUseCases } from './collections';
import { alternativesPath, forPath, guidePath, vsPath } from './site';

export interface DocLink {
  href: string;
  /** The short sidebar label. */
  label: string;
  /** The page's own heading, which search results and the pager show in full. */
  title: string;
  /** Matched by search alongside the title; never rendered. */
  keywords: string;
}

export interface DocGroup {
  label: string;
  links: DocLink[];
}

export type DocsNav = DocGroup[];

const hub = ({ href, title, keywords }: { href: string; title: string; keywords: string }): DocLink => ({
  href,
  label: 'Overview',
  title,
  keywords,
});

/** A Markdown page's own section headings, so search finds "Cursor" inside the agent guide. */
const sections = (entry: { rendered?: { metadata?: { [key: string]: unknown } } }): string => {
  const headings = entry.rendered?.metadata?.headings;
  if (!Array.isArray(headings)) return '';
  return headings
    .map((h) => (typeof h === 'object' && h && 'text' in h && typeof h.text === 'string' ? h.text : ''))
    .join(' ');
};

/**
 * The sidebar, the search index and the pager, from one read of the collections.
 * Every content page appears exactly once, so a page cannot be findable in search
 * yet missing from the sidebar, or the reverse.
 */
async function buildDocsNav(): Promise<DocsNav> {
  const [guides, useCases, comparisons, alternatives] = await Promise.all([
    getGuides(),
    getUseCases(),
    getComparisons(),
    getAlternatives(),
  ]);

  return [
    {
      label: 'Product',
      links: [
        {
          href: '/features',
          label: 'Features',
          title: 'MarkLayer features',
          keywords: 'tools shortcuts integrations mcp',
        },
        {
          href: '/mcp',
          label: 'MCP server',
          title: 'Connect MarkLayer to your coding agent',
          keywords: 'mcp claude code cursor codex vs code agent setup',
        },
        { href: '/changelog', label: 'Changelog', title: "What's new in MarkLayer", keywords: 'releases versions' },
      ],
    },
    {
      label: 'Guides',
      links: [
        hub({ href: '/guides', title: 'All guides', keywords: 'guides' }),
        {
          href: '/website-feedback-statistics',
          label: 'Feedback statistics',
          title: 'Website feedback statistics, 2026',
          keywords: 'statistics data index pricing median free plan sign-up research',
        },
        ...guides.map((g) => ({
          href: guidePath(g.id),
          label: g.data.nav ?? g.data.h1,
          title: g.data.h1,
          keywords: `${g.data.description} ${sections(g)}`,
        })),
      ],
    },
    {
      label: 'Use cases',
      links: [
        hub({ href: '/use-cases', title: 'All use cases', keywords: 'use cases workflows' }),
        ...useCases.map((u) => ({
          href: forPath(u.id),
          label: u.data.nav ?? u.data.h1,
          title: u.data.h1,
          keywords: `${u.data.audience} ${u.data.description} ${sections(u)}`,
        })),
      ],
    },
    {
      label: 'Compare',
      links: [
        hub({ href: '/compare', title: 'All comparisons', keywords: 'compare versus' }),
        ...comparisons.map((c) => ({
          href: vsPath(c.id),
          label: c.data.competitor,
          title: compareH1(c),
          keywords: `versus ${c.data.competitorTagline} ${sections(c)}`,
        })),
      ],
    },
    {
      label: 'Alternatives',
      links: [
        hub({ href: '/alternatives', title: 'All alternatives', keywords: 'alternatives' }),
        ...alternatives.map((a) => ({
          href: alternativesPath(a.id),
          label: a.data.target,
          title: alternativesH1(a),
          keywords: `${a.data.description} ${sections(a)}`,
        })),
      ],
    },
  ];
}

let built: Promise<DocsNav> | undefined;

/** Every page renders the sidebar, so a build reads the collections once. Dev re-reads, so an edit shows. */
export const getDocsNav = (): Promise<DocsNav> => {
  if (!import.meta.env.PROD) return buildDocsNav();
  built ??= buildDocsNav();
  return built;
};

/**
 * The current link. A release page has no row of its own, so it lights the
 * Changelog row — the one row that matches by prefix, because everywhere else a
 * page has its own row and `/guides` must not light up on `/guides/x`.
 */
export const isCurrent = ({ href, path }: { href: string; path: string }): boolean =>
  href === path || (href === '/changelog' && path.startsWith('/changelog/'));
