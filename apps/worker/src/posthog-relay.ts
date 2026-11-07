import { RELAY_PREFIX } from '../shared/posthog-relay-path';
import type { WaitUntil } from './env';

export const DEFAULT_POSTHOG_HOST = 'https://us.i.posthog.com';

/**
 * Where a relayed request goes. Cloud serves lazy bundles (`/static`, remote
 * config under `/array`) from a separate assets host; self-hosted serves both.
 */
export function relayTarget({ url, host }: { url: URL; host?: string }): URL {
  const api = new URL(host || DEFAULT_POSTHOG_HOST);
  const path = url.pathname.slice(RELAY_PREFIX.length) || '/';
  if (isAsset(path)) api.hostname = api.hostname.replace(/^(us|eu)\.i\.posthog\.com$/, '$1-assets.i.posthog.com');
  return new URL(path + url.search, api);
}

const isAsset = (path: string) => path.startsWith('/static/') || path.startsWith('/array/');

/** Follows PostHog's Cloudflare recipe: https://posthog.com/docs/advanced/proxy/cloudflare */
export async function relayToPosthog({
  req,
  host,
  ctx,
}: {
  req: Request;
  host?: string;
  ctx: WaitUntil;
}): Promise<Response> {
  const target = relayTarget({ url: new URL(req.url), host });

  if (req.method === 'GET' && isAsset(target.pathname)) {
    const cache = await caches.open('posthog-assets');
    const cached = await cache.match(req);
    if (cached) return cached;
    const res = await fetch(target);
    if (res.ok) ctx.waitUntil(cache.put(req, res.clone()));
    return res;
  }

  const headers = new Headers(req.headers);
  // Our own credentials (the sign-in session) have no business at PostHog.
  headers.delete('cookie');
  headers.delete('authorization');
  // Without it PostHog geolocates every visitor to the Cloudflare colo they came through.
  headers.set('x-forwarded-for', req.headers.get('cf-connecting-ip') ?? '');
  // Buffered, not streamed: PostHog's recipe notes streamed POST bodies failed to arrive.
  const body = req.method === 'GET' || req.method === 'HEAD' ? null : await req.arrayBuffer();
  return fetch(target, { method: req.method, headers, body, redirect: 'manual' });
}
