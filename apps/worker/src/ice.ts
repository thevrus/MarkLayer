export const STUN_ONLY: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

// Cloudflare's response includes :53 URLs that Chrome and Firefox silently block.
// Leaving them in the iceServers list causes wasted candidate-pair churn and can
// mask working relays. https://developers.cloudflare.com/realtime/turn/ #gotchas.
//
// Anchored to the end of the port on purpose: a plain `includes(':53')` also ate
// `turns:…:5349`, the TLS relay in the same response, which is the candidate that
// survives a firewall passing nothing but TLS.
const PORT_53 = /:53(?:\?|$)/;

export function stripPort53(server: RTCIceServer): RTCIceServer | null {
  const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
  const kept = urls.filter((u) => typeof u === 'string' && !PORT_53.test(u));
  if (kept.length === 0) return null;
  return { ...server, urls: kept };
}

interface TurnEnv {
  TURN_KEY_ID?: string;
  TURN_KEY_TOKEN?: string;
}

// TURN creds are tied to the worker's key (not per-room), so a module-level
// cache works for all DO instances on this isolate. `turnPromise` coalesces
// concurrent first-time fetches.
const TURN_TTL_SECONDS = 3600;
const STUN_FALLBACK_TTL_MS = 60_000;
let turnCache: { iceServers: RTCIceServer[]; expiresAt: number } | null = null;
let turnPromise: Promise<{ iceServers: RTCIceServer[]; ttlMs: number }> | null = null;

async function fetchIceServers(env: TurnEnv): Promise<{ iceServers: RTCIceServer[]; ttlMs: number }> {
  if (!env.TURN_KEY_ID || !env.TURN_KEY_TOKEN) return { iceServers: STUN_ONLY, ttlMs: STUN_FALLBACK_TTL_MS };
  try {
    const res = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.TURN_KEY_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ttl: TURN_TTL_SECONDS }),
      },
    );
    if (!res.ok) return { iceServers: STUN_ONLY, ttlMs: STUN_FALLBACK_TTL_MS };
    const data: unknown = await res.json();
    const servers =
      typeof data === 'object' && data !== null && 'iceServers' in data && Array.isArray(data.iceServers)
        ? data.iceServers
        : [];
    const cleaned = servers
      .map((s) => (typeof s === 'object' && s !== null && 'urls' in s ? stripPort53(s) : null))
      .filter((s): s is RTCIceServer => s !== null);
    if (cleaned.length === 0) return { iceServers: STUN_ONLY, ttlMs: STUN_FALLBACK_TTL_MS };
    return { iceServers: cleaned, ttlMs: (TURN_TTL_SECONDS * 1000) / 2 };
  } catch {
    return { iceServers: STUN_ONLY, ttlMs: STUN_FALLBACK_TTL_MS };
  }
}

export async function getIceServers(env: TurnEnv): Promise<RTCIceServer[]> {
  if (turnCache && turnCache.expiresAt > Date.now()) return turnCache.iceServers;
  if (turnPromise) return (await turnPromise).iceServers;
  // Set the cache inside the awaited promise so a caller arriving between
  // promise-settle and the next microtask still sees the result without
  // starting a duplicate fetch.
  turnPromise = fetchIceServers(env).then((result) => {
    turnCache = { iceServers: result.iceServers, expiresAt: Date.now() + result.ttlMs };
    return result;
  });
  try {
    return (await turnPromise).iceServers;
  } finally {
    turnPromise = null;
  }
}
