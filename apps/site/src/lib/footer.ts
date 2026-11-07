import claudeSvg from '@lobehub/icons-static-svg/icons/claude.svg?raw';
import geminiSvg from '@lobehub/icons-static-svg/icons/gemini.svg?raw';
import grokSvg from '@lobehub/icons-static-svg/icons/grok.svg?raw';
import openaiSvg from '@lobehub/icons-static-svg/icons/openai.svg?raw';
import perplexitySvg from '@lobehub/icons-static-svg/icons/perplexity.svg?raw';
import { CHROME_STORE_URL } from '@marklayer/brand';
import { HOW_IT_WORKS_PATH } from '@marklayer/brand/mark';
import { AUTHOR_EMAIL, REPO_URL } from './site';

/**
 * The site's floor, as data.
 *
 * There are two renderers — SiteFooter.astro for the prerendered marketing
 * pages and the <footer> in apps/worker/web/Landing.tsx for the app shell at
 * `/` — and they used to carry different columns, different labels and a
 * different colophon, so the footer changed shape the moment you clicked out of
 * `/`. Neither framework can import the other's component, but both can import
 * this, so the CONTENT has one source and only the container width differs.
 *
 * apps/site/scripts/verify-build.mjs resolves every internal href in the built
 * HTML, so a path that stops existing fails the build rather than shipping.
 */

export interface FooterLink {
  href: string;
  label: string;
  /** Off-origin. Rendered with `target="_blank" rel="noopener noreferrer"`. */
  external?: boolean;
}

export interface FooterColumn {
  heading: string;
  links: FooterLink[];
}

/**
 * Four columns, hub-level. The landing's footer used to list eleven individual
 * comparison and use-case pages; picking four of sixteen competitors to name
 * there was arbitrary, and every one of them is one click away through the hub
 * that replaces them. The prerendered `/` (HomeContent.astro) still links them
 * all inline for the crawlers that never run the SPA.
 */
export const FOOTER_COLUMNS: FooterColumn[] = [
  {
    heading: 'Product',
    links: [
      { href: '/', label: 'Home' },
      { href: '/features', label: 'Features' },
      { href: HOW_IT_WORKS_PATH, label: 'How it works' },
      { href: '/pricing', label: 'Pricing' },
      { href: CHROME_STORE_URL, label: 'Chrome extension', external: true },
    ],
  },
  {
    heading: 'Compare',
    links: [
      { href: '/compare', label: 'Comparisons' },
      { href: '/alternatives', label: 'Alternatives' },
      { href: '/use-cases', label: 'Use cases' },
    ],
  },
  {
    heading: 'Resources',
    links: [
      { href: '/guides', label: 'Guides' },
      { href: '/guides/free-website-annotation-tools', label: 'Free annotation tools' },
      { href: '/changelog', label: "What's new" },
      { href: REPO_URL, label: 'GitHub', external: true },
      { href: 'https://www.producthunt.com/products/marklayer', label: 'Product Hunt', external: true },
      { href: '/llms-full.txt', label: 'llms-full.txt' },
    ],
  },
  {
    heading: 'Company',
    links: [
      { href: '/about', label: 'About' },
      /* Named "Support the project", not "Support": in a footer column headed
         Company, beside About and Contact, the bare word reads as a help desk. */
      { href: '/support', label: 'Support the project' },
      { href: '/privacy', label: 'Privacy' },
      { href: `mailto:${AUTHOR_EMAIL}`, label: 'Contact' },
    ],
  },
];

export const ASK_AI_LABEL = 'Ask an AI about MarkLayer';

/**
 * Brand marks from @lobehub/icons-static-svg (simple-icons dropped OpenAI and
 * Grok). Single-path 24×24, drawn in `currentColor` so they take the same faint
 * → ink hover as every other row icon, and `evenodd` — the files rely on it for
 * their counters. Bare, with padding for the hit area only — no tile.
 */
const markPath = (svg: string): string => svg.match(/<path[^>]*\sd="([^"]+)"/)?.[1] ?? '';

const PROVIDERS: { label: string; url: (encodedQuestion: string) => string; path: string }[] = [
  {
    label: 'ChatGPT',
    url: (q) => `https://chatgpt.com/?hints=search&q=${q}`,
    path: markPath(openaiSvg),
  },
  {
    label: 'Claude',
    url: (q) => `https://claude.ai/new?q=${q}`,
    path: markPath(claudeSvg),
  },
  {
    label: 'Perplexity',
    url: (q) => `https://www.perplexity.ai/search?q=${q}`,
    path: markPath(perplexitySvg),
  },
  {
    /* Google AI Mode is Gemini, so the mark is Gemini's; `udm=50` is the
       parameter that opens AI Mode rather than the ten blue links. */
    label: 'Google Gemini',
    url: (q) => `https://www.google.com/search?udm=50&q=${q}`,
    path: markPath(geminiSvg),
  },
  {
    label: 'Grok',
    url: (q) => `https://grok.com/?q=${q}`,
    path: markPath(grokSvg),
  },
];

/** The assistants' deep links for `question`; the footer asks about MarkLayer, an article about itself. */
export const askAi = (question: string): { href: string; label: string; path: string }[] =>
  PROVIDERS.map(({ label, url, path }) => ({ label, href: url(encodeURIComponent(question)), path }));

/**
 * A prefilled question to the assistants people actually ask before they trust
 * a tool. Plain `<a href>` deep links, so the zero-JS build is unchanged. The
 * query is neutral on purpose — it points at the comparison pages the site
 * already answers rather than fishing for a pitch.
 */
export const ASK_AI = askAi(
  'What is MarkLayer (marklayer.app), and how does it compare to other web annotation and visual feedback tools?',
);

/**
 * The site names 27 competitors across /vs and /alternatives. Naming a
 * trademark in honest comparison is nominative fair use, but the attribution
 * and the no-affiliation line are what keep it plainly that.
 */
export const TRADEMARK_NOTICE =
  'BugHerd, Marker.io, Pastel, Usersnap, Userback, Markup.io, Loom, and Jam.dev are trademarks of their respective owners, as are the other product names on this site. MarkLayer is independent and is not affiliated with, endorsed by, or sponsored by any of them.';

/** The colophon, after the year. */
export const COLOPHON = 'Free, anonymous webpage annotation · Open source, Apache-2.0.';
