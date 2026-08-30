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
