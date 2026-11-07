import { ORIGIN, WORKER_DEV_PORT } from '@marklayer/brand';
import { pageOgImage as pageOgImageUrl } from '@marklayer/brand/links';

/* Only for apps/worker/web, which has not moved to @marklayer/brand yet. */

/** When the competitor prices on /pricing, /pricing.md and the alternatives tables were last re-verified. */
export const PRICES_CHECKED = 'August 2026';

export const vsPath = (slug: string): string => `/vs/${slug}`;
export const forPath = (slug: string): string => `/for/${slug}`;
export const alternativesPath = (slug: string): string => `/alternatives/${slug}`;
export const guidePath = (slug: string): string => `/guides/${slug}`;
export const releasePath = (slug: string): string => `/changelog/${slug}`;

/** How MarkLayer's own row reads wherever prices sit side by side. */
export const MARKLAYER_PRICE = 'Free. No tiers, no seats';

/** The fallback card, for anything with no heading of its own to draw. */
export const OG_IMAGE = `${ORIGIN}/og.jpg`;
/** The home card's moving twin, 1200×630 like the still; Telegram plays it, everyone else shows `OG_IMAGE`. */
export const OG_VIDEO = `${ORIGIN}/og.mp4`;

/** A card the Worker draws for one page (`/og/page.png`): its heading, set large, with a stroke under the operative word. */
export function pageOgImage({ heading, path }: { heading: string; path: string }): string {
  return pageOgImageUrl.build({ heading, path });
}

export const REPO_URL = 'https://github.com/thevrus/MarkLayer';
export const AUTHOR_NAME = 'Dean Rusin';
export const AUTHOR_EMAIL = 'hello@marklayer.app';

/** apps/worker's Vite dev server, started alongside this one by `turbo run dev`. */
export const WORKER_DEV = `http://localhost:${WORKER_DEV_PORT}`;

/**
 * The nav sections, in the order the header renders them. One entry per section:
 * the label, the hub it links to, and every path prefix that counts as being
 * inside it — `/vs/pastel` is a comparison, `/for/qa` is a use case. A page in a
 * section suppresses its own nav link.
 */
export const SECTIONS = [
  /* First in the row: what the product does comes before who it beats. It is
     also the only hub that answers a "what can it do" query, which the compare
     and alternatives pages were absorbing by default. */
  { key: 'features', label: 'Features', href: '/features', prefixes: ['/features'] },
  { key: 'compare', label: 'Compare', href: '/compare', prefixes: ['/compare', '/vs/'] },
  { key: 'alternatives', label: 'Alternatives', href: '/alternatives', prefixes: ['/alternatives'] },
  { key: 'use-cases', label: 'Use cases', href: '/use-cases', prefixes: ['/use-cases', '/for/'] },
  { key: 'guides', label: 'Guides', href: '/guides', prefixes: ['/guides'] },
  { key: 'changelog', label: 'Changelog', href: '/changelog', prefixes: ['/changelog'] },
  { key: 'pricing', label: 'Pricing', href: '/pricing', prefixes: ['/pricing'] },
  /* Last in the row on purpose, and it reads off the one before it: "Pricing"
     answers what it costs, "Support" answers who pays for it. Reversed, or set
     anywhere earlier, the word is ambiguous with a help desk — which this
     project explicitly does not run. */
  { key: 'support', label: 'Support', href: '/support', prefixes: ['/support'] },
] as const;

type Section = (typeof SECTIONS)[number]['key'];

/** `/vs/pastel` → `compare`, `/for/qa` → `use-cases`. Undefined outside the nav. */
export function sectionFor(path: string): Section | undefined {
  return SECTIONS.find((s) => s.prefixes.some((prefix) => path.startsWith(prefix)))?.key;
}

const LAST_UPDATED_FORMAT = new Intl.DateTimeFormat('en-US', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

/** "2026-04-12" → "April 2026". Matches the byline format the Worker shipped. */
export function formatLastUpdated(iso: string): string {
  return LAST_UPDATED_FORMAT.format(new Date(`${iso}T00:00:00Z`));
}

const RELEASE_DATE_FORMAT = new Intl.DateTimeFormat('en-US', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

/**
 * "2026-08-28" → "August 28, 2026". A release happened on a day, not in a month,
 * so the changelog states the day the month-level byline elsewhere would round off.
 */
export function formatReleaseDate(iso: string): string {
  return RELEASE_DATE_FORMAT.format(new Date(`${iso}T00:00:00Z`));
}
