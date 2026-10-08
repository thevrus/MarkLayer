import { parseFetchableUrl } from '@marklayer/types';

/**
 * A pasted address as a fetchable http(s) href, or null. A bare host gets
 * `https://` because people type "staging.example.com"; the shared gate still
 * decides, so a private or non-http target is refused here as it is by the proxy.
 */
export function parseCompareUrl(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  const parsed = parseFetchableUrl(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`);
  return parsed.ok ? parsed.url.href : null;
}

/** The compare view for two pages; `b` may be omitted to open it with only the first filled in. */
export function compareHref({ a, b }: { a: string; b?: string }): string {
  const params = new URLSearchParams({ a });
  if (b) params.set('b', b);
  return `/app/compare?${params}`;
}
