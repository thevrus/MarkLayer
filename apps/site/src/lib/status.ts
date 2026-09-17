/**
 * The status line that closes the footer, on this site and in the app's own
 * footer (apps/worker/web/Landing.tsx). One module because both renderers must
 * agree on the copy and on what the claim actually rests on.
 */

export type SystemStatus = 'ok' | 'degraded';

export const STATUS_LABEL: Record<SystemStatus, string> = {
  ok: 'All systems operational',
  degraded: 'Some systems degraded',
};

/**
 * Probes `GET /api/health`, which probes the Worker's D1 and R2 bindings.
 *
 * Optimistic, and deliberately so: the page carrying this line was served by the
 * same Worker, so `ok` is what the page itself already attests, and only a probe
 * that comes back degraded downgrades it. Everything else — a dropped
 * connection, an ad blocker, a 404 from a standalone Pages deploy where `/api`
 * does not exist, a dev server with no bindings — leaves the claim alone rather
 * than telling a visitor the product is down because their wifi is.
 *
 * Relative on purpose. An absolute origin would make localhost report on
 * production, and same-origin is the case that matters: the app and all 55
 * content pages are served by the Worker that answers this route.
 */
export async function probeStatus(): Promise<SystemStatus> {
  const cached = readCache();
  if (cached) return cached;
  try {
    const res = await fetch('/api/health', { headers: { Accept: 'application/json' } });
    if (res.status === 503) return 'degraded';
    if (!res.ok) return 'ok';
    const body: unknown = await res.json();
    const status = typeof body === 'object' && body !== null && 'status' in body ? body.status : null;
    return writeCache(status === 'degraded' ? 'degraded' : 'ok');
  } catch {
    return 'ok';
  }
}

const CACHE_KEY = 'ml:status';
const CACHE_MS = 60_000;

/**
 * One probe per minute per visit, shared by the app and all 55 content pages.
 * Each is a separate document load, so without this a visitor reading four
 * pages pays four D1 + R2 round trips to be told the same thing.
 */
function readCache(): SystemStatus | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const [at, status] = raw.split(':');
    if (!at || Date.now() - Number(at) > CACHE_MS) return null;
    return status === 'degraded' ? 'degraded' : status === 'ok' ? 'ok' : null;
  } catch {
    return null;
  }
}

function writeCache(status: SystemStatus): SystemStatus {
  try {
    sessionStorage.setItem(CACHE_KEY, `${Date.now()}:${status}`);
  } catch {}
  return status;
}
