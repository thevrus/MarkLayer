/**
 * Facts about the product itself, for every workspace that states them: worker,
 * web, extension, MCP server, marketing site, emails, relay. Nothing here imports
 * anything, so anything can import it, including a build with no install step.
 */

export const ORIGIN = 'https://marklayer.app';

export const CHROME_STORE_URL = 'https://chromewebstore.google.com/detail/marklayer/fnfobegjifomgobgilaemihpcpidjamc';

/** Where a security report goes; `/.well-known/security.txt` renders it. */
export const SECURITY_CONTACT = 'hello@marklayer.app';

/**
 * The cross-tab channel `/thanks` uses to tell an editor still open in another tab
 * that a payment landed. The checkout opens in a new tab so the tab holding unsaved
 * annotations is never navigated, which is why the two need a way to talk. Same-origin
 * only, and it carries no order data, just the fact.
 */
export const SUPPORT_CHANNEL = 'marklayer:support';
export const SUPPORT_PAID = 'paid';

/**
 * The Polar checkout every support surface opens: pay what you want, $3 floor, $5 prefilled.
 * Buttons don't name the $5: Polar adds VAT on top, so an EU supporter is charged $6.15.
 */
export const POLAR_CHECKOUT_URL = 'https://buy.polar.sh/polar_cl_DBsDl9Ufd2O0mOEodJrcrIDpuOu2iEc0UqG4w4cXdk2';

/** Sent by the Worker and restated by `apps/site/public/_headers` for asset-served pages. */
export const HSTS = 'max-age=63072000; includeSubDomains; preload';

/**
 * Days of inactivity before a share link and its OG card are deleted. The cleanup
 * cron enforces it and the viewer quotes it back, so both read it from here.
 */
export const RETENTION_DAYS = 90;

export const MAX_PAGES_PER_PROJECT = 50;

/** How long a sign-in link works. The email states it, so the copy reads this too. */
export const LOGIN_TOKEN_TTL_SECONDS = 15 * 60;

/** The dev servers `turbo run dev` starts. The worker's Vite proxies marketing paths to the site's Astro. */
export const WORKER_DEV_PORT = 5173;
export const SITE_DEV_PORT = 4321;
