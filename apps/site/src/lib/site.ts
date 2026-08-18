export const ORIGIN = 'https://marklayer.app';
export const CHROME_STORE_URL = 'https://chromewebstore.google.com/detail/marklayer/fnfobegjifomgobgilaemihpcpidjamc';
export const OG_IMAGE = `${ORIGIN}/og.jpg`;
export const REPO_URL = 'https://github.com/thevrus/MarkLayer';
export const AUTHOR_NAME = 'Vadym Rusin';
export const AUTHOR_EMAIL = 'rusinvadym@gmail.com';

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

/** The nav sections. A page in one of these suppresses its own nav link. */
export type Section = 'compare' | 'alternatives' | 'use-cases' | 'guides' | 'pricing';

/** `/vs/pastel` → `compare`, `/for/qa` → `use-cases`. Undefined outside the nav. */
export function sectionFor(path: string): Section | undefined {
  if (path.startsWith('/compare') || path.startsWith('/vs/')) return 'compare';
  if (path.startsWith('/alternatives')) return 'alternatives';
  if (path.startsWith('/use-cases') || path.startsWith('/for/')) return 'use-cases';
  if (path.startsWith('/guides')) return 'guides';
  if (path.startsWith('/pricing')) return 'pricing';
  return undefined;
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
