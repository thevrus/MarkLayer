/** Query params that only say where a visitor came from; the same page under any of them is one page. */
const TRACKING_PARAMS = new Set([
  'gclid',
  'dclid',
  'gbraid',
  'wbraid',
  'fbclid',
  'msclkid',
  'yclid',
  '_gl',
  'mc_eid',
  'mc_cid',
]);

/**
 * Canonical form for comparing two page URLs: fragment and tracking params dropped.
 * Trailing slash, path case and every other param are kept; they can serve different pages.
 */
export function normalizePageUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return raw;
  }
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    if (key.startsWith('utm_') || TRACKING_PARAMS.has(key)) url.searchParams.delete(key);
  }
  return url.href;
}

/** Index of the page already showing `url`, or -1. */
export function findPageIndex({ pages, url }: { pages: { url: string | null }[]; url: string }): number {
  const wanted = normalizePageUrl(url);
  return pages.findIndex((p) => p.url !== null && normalizePageUrl(p.url) === wanted);
}
