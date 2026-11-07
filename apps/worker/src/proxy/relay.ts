import { RELAY_HEADERS, RELAY_STATUS_OK, relayFetchUrl } from '@marklayer/types/relay';
import { createBreaker } from '../breaker';
import type { Env, WaitUntil } from '../env';
import { isRefusedSubResource } from './challenge';
import { fetchWithHeaderTimeout } from './header-timeout';

/**
 * Well inside the viewer's give-up bound. The relay is an optimization on a
 * page that has already failed once, so it may spend a little time — but never
 * so much that waiting for a dead host is worse than the block it was fixing.
 */
const RELAY_TIMEOUT_MS = 6_000;

/** Consecutive failures before the relay is presumed gone rather than unlucky. */
const RELAY_FAILURES_BEFORE_TRIP = 3;
/** How long to stop calling it once tripped, before one request is allowed to re-test. */
const RELAY_COOLDOWN_MS = 60_000;

const RELAY_REFUSED_REST_MS = 30 * 60_000;
const RELAY_REFUSED_MAX_HOSTS = 500;

/**
 * A circuit breaker, so an unreachable relay costs one slow request a minute
 * instead of one on every view.
 *
 * This is the "the host went away" case made survivable: if the Fly account is
 * cancelled while the secrets still point at it, the breaker trips after three
 * failures and the proxy goes back to behaving exactly as it did before the
 * relay existed.
 */
export function createRelayBreaker() {
  const trip = createBreaker({ trips: RELAY_FAILURES_BEFORE_TRIP, cooldownMs: RELAY_COOLDOWN_MS });
  /** Host → rest-until. Re-knocking a refusal from our one IP got it flagged across SiteGround's network. */
  const refusedBy = new Map<string, number>();

  return {
    admits(url: string): boolean {
      return trip.admits() && Date.now() >= (refusedBy.get(new URL(url).hostname) ?? 0);
    },
    answered: trip.succeeded,
    failed: trip.failed,
    refused(url: string): void {
      // Forgetting every rest at the cap costs one extra knock per host; tracking age would cost more code.
      if (refusedBy.size >= RELAY_REFUSED_MAX_HOSTS) refusedBy.clear();
      refusedBy.set(new URL(url).hostname, Date.now() + RELAY_REFUSED_REST_MS);
    },
  };
}

export type RelayBreaker = ReturnType<typeof createRelayBreaker>;

/** Isolate-local and deliberately un-synchronized: an approximate breaker that costs nothing beats an exact one that needs storage. */
export const isolateBreaker = createRelayBreaker();

/**
 * Just the bindings the relay reads. Narrower than `Env['Bindings']` on purpose:
 * this code has no business touching the database or the bucket, and saying so
 * in the type is what lets a test call it with three strings.
 */
export type RelaySettings = Pick<Env['Bindings'], 'FETCHER_URL' | 'FETCHER_TOKEN' | 'FETCHER_ENABLED'>;

/** The relay's coordinates, or `null` when it is off — the one authority for that. */
export function relayConfig(env: RelaySettings): { url: string; token: string } | null {
  const { FETCHER_URL, FETCHER_TOKEN, FETCHER_ENABLED } = env;
  // An explicit off switch that needs no redeploy and no secret deletion: set
  // FETCHER_ENABLED to "false" and the fallback stops, config intact.
  if (FETCHER_ENABLED === 'false' || FETCHER_ENABLED === '0') return null;
  return FETCHER_URL && FETCHER_TOKEN ? { url: FETCHER_URL.replace(/\/$/, ''), token: FETCHER_TOKEN } : null;
}

/**
 * Fetch through the fixed-IP relay, or `null` if it is off, tripped, or could
 * not answer. A relay-level failure is deliberately indistinguishable from
 * "not configured" here: either way the caller keeps whatever the direct fetch
 * gave it, which is never worse than what it had.
 */
export async function relayFetch({
  url,
  env,
  breaker,
}: {
  url: string;
  env: RelaySettings;
  breaker: RelayBreaker;
}): Promise<Response | null> {
  const relay = relayConfig(env);
  if (!relay || !breaker.admits(url)) return null;

  try {
    const resp = await fetchWithHeaderTimeout({
      url: relayFetchUrl({ base: relay.url, url }),
      init: { headers: { Authorization: `Bearer ${relay.token}` } },
      timeoutMs: RELAY_TIMEOUT_MS,
    });
    // A relay that answers at all is alive, even when it reports it could not
    // reach the target — that is the target's fault, not the relay's.
    breaker.answered();
    return resp.headers.get(RELAY_HEADERS.status) === RELAY_STATUS_OK ? resp : null;
  } catch {
    breaker.failed();
    return null;
  }
}

/** Ten minutes: one fetch per colo across viewers, still short enough to pick up a dev site's CSS edits. */
const RELAY_ASSET_TTL_S = 600;

/** A refused sub-resource via the relay, cached per colo so a busy page costs the host one burst, not one per viewer. */
export async function relaySubResource({
  url,
  accept,
  env,
  breaker,
  ctx,
  admit,
}: {
  url: string;
  accept: string | undefined;
  env: RelaySettings;
  breaker: RelayBreaker;
  ctx: WaitUntil;
  /** Asked on a cache miss only: a hit costs the relay nothing. */
  admit: () => Promise<boolean>;
}): Promise<Response | null> {
  // The off switch covers what the relay already fetched, not only new fetches.
  if (!relayConfig(env)) return null;
  // `caches` is the Workers runtime's; absent under `bun test`.
  const cache = typeof caches === 'undefined' ? null : await caches.open('relay-assets');
  const key = new Request(url);
  const hit = await cache?.match(key);
  if (hit) return hit;
  if (!(await admit())) return null;

  // A refusal here never rests the host: a 404 page for one stray image looks
  // just like a challenge to `isRefusedSubResource`. Only `fetchPage` judges that.
  const relayed = await relayFetch({ url, env, breaker });
  if (!relayed || isRefusedSubResource({ resp: relayed, accept })) return null;
  if (!cache || relayed.status !== 200) return relayed;

  const stored = new Response(relayed.body, relayed);
  stored.headers.delete('set-cookie');
  stored.headers.set('cache-control', `public, max-age=${RELAY_ASSET_TTL_S}`);
  ctx.waitUntil(cache.put(key, stored.clone()));
  return stored;
}
