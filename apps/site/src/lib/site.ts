export const ORIGIN = 'https://marklayer.app';
export const CHROME_STORE_URL = 'https://chromewebstore.google.com/detail/marklayer/fnfobegjifomgobgilaemihpcpidjamc';
/** The fallback card, for anything with no heading of its own to draw. */
export const OG_IMAGE = `${ORIGIN}/og.jpg`;

/**
 * A card drawn for one page: its own heading, set large, with a stroke under the
 * operative word and a comment pinned to it.
 *
 * Rendered by the Worker (`/og/page.png`) rather than baked at build time, because
 * that is where the fonts and the rasterizer already live. The heading travels in
 * the URL for the same reason: these pages are static, so the Worker has no copy
 * of their content to look up. The result is cached in R2 by the hash of both
 * params, so a given page renders once.
 */
export function pageOgImage({ heading, path }: { heading: string; path: string }): string {
  const query = new URLSearchParams({ h: heading, p: path });
  return `${ORIGIN}/og/page.png?${query}`;
}
/**
 * The cross-tab channel `/thanks` uses to tell an editor still open in another
 * tab that a payment landed.
 *
 * It lives here because both ends read it: the static thank-you page in this
 * workspace, and the app in apps/worker, which already depends on this module
 * for `CHROME_STORE_URL`. The checkout opens in a new tab so the tab holding
 * unsaved annotations is never navigated, which is exactly why the two need a
 * way to talk. Same-origin only, and it carries no order data — just the fact.
 */
export const SUPPORT_CHANNEL = 'marklayer:support';
export const SUPPORT_PAID = 'paid';

/**
 * The Polar checkout every support surface opens — the "Support MarkLayer"
 * product, pay-what-you-want with a $3 floor and $5 prefilled.
 *
 * It lives here for the same reason `SUPPORT_CHANNEL` does: three renderers open
 * it now (the app's support card, `/support`, and the footer link that points at
 * it), and a URL duplicated across two workspaces is a URL that goes stale in
 * one of them. apps/worker re-exports it from `web/support.ts`.
 *
 * No surface names the $5 in a button label: Polar is merchant of record and
 * adds VAT on top, so an EU supporter is charged $6.15. A button promising a
 * price the checkout then contradicts is a small lie. `/support` states the
 * floor and the VAT in prose instead, where there is room to be exact.
 *
 * Left empty and every surface degrades to its no-payment form rather than
 * offering a button that goes nowhere, which is also what should happen if the
 * product is ever retired.
 */
export const POLAR_CHECKOUT_URL = 'https://buy.polar.sh/polar_cl_DBsDl9Ufd2O0mOEodJrcrIDpuOu2iEc0UqG4w4cXdk2';

export const REPO_URL = 'https://github.com/thevrus/MarkLayer';
export const AUTHOR_NAME = 'Vadym Rusin';
export const AUTHOR_EMAIL = 'hello@marklayer.app';

/** apps/worker's Vite dev server, started alongside this one by `turbo run dev`. */
export const WORKER_DEV = 'http://localhost:5173';

/**
 * The app shell at `/` only. The marketing pages self-host Geist from /fonts
 * (see the @font-face block in styles/global.css) and preload it in BaseHead;
 * the shell can't share that, because its styles come from apps/worker's bundle
 * rather than from global.css. Self-hosting it there too is a follow-up: the
 * files already ship to this origin via embed:site, so it needs only the
 * @font-face block in apps/worker/web/style.css and a preload here.
 *
 * Italic is requested, not synthesized: the shell sets `italic` on placeholder
 * and quoted text, so a roman-only request left the browser slanting the upright
 * face. The `400..700` range serves one variable file per subset instead of four
 * static weights.
 */
export const FONTS_HREF = 'https://fonts.googleapis.com/css2?family=Geist:ital,wght@0,400..700;1,400..700&display=swap';

/**
 * The nav sections, in the order the header renders them. One entry per section:
 * the label, the hub it links to, and every path prefix that counts as being
 * inside it — `/vs/pastel` is a comparison, `/for/qa` is a use case. A page in a
 * section suppresses its own nav link.
 */
export const SECTIONS = [
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

export type Section = (typeof SECTIONS)[number]['key'];

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
