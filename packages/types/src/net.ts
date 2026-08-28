/**
 * SSRF guards for anything that fetches a URL a stranger supplied.
 *
 * Shared because there are now two fetchers: the Worker's proxy, and the
 * fixed-IP relay it falls back to. The relay runs on an ordinary cloud host, so
 * it sits *closer* to things worth protecting than the Worker ever did — a
 * private subnet, a link-local metadata endpoint — and the two must not drift
 * into disagreeing about what "private" means.
 */

/** Hostnames that are never a legitimate annotation target. */
const BLOCKED_HOSTS = new Set(['localhost', 'metadata.google.internal', 'metadata.goog']);

/**
 * Reject a hostname on its literal text alone: a name we never fetch, or an
 * address literal inside a private range.
 *
 * Text is all a Worker gets — it cannot resolve DNS — so a hostname that passes
 * here can still resolve to a private address. Anywhere DNS *is* available,
 * follow this with `isPrivateAddress` on each resolved address.
 */
export function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (BLOCKED_HOSTS.has(h) || h.endsWith('.internal') || h.endsWith('.local')) return true;
  return isPrivateAddress(h);
}

// Hoisted, not inline: this runs once per sub-resource of every proxied page —
// hundreds of times per view — and per redirect hop in the relay.
const BRACKETS = /^\[|\]$/g;
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/;
/** `::`/`::1` unspecified + loopback, `fc00::/7` unique-local, `fe80::/10` link-local. */
const IPV6_PRIVATE = /^(::1?$|f[cd]|fe[89ab])/;

/**
 * Whether an IP address literal is one we refuse to connect to: loopback, any
 * RFC1918 range, link-local (which carries the cloud metadata endpoint), CGNAT,
 * and their IPv6 equivalents including v4-mapped forms like `::ffff:169.254.169.254`.
 */
export function isPrivateAddress(address: string): boolean {
  const a = address.toLowerCase().replace(BRACKETS, '');

  // An IPv4 address, or the v4 tail of a v4-mapped IPv6 address.
  const v4 = a.startsWith('::ffff:') ? a.slice(7) : a;
  const octets = IPV4.exec(v4);
  if (octets) {
    const p0 = Number(octets[1]);
    const p1 = Number(octets[2]);
    return (
      p0 === 0 ||
      p0 === 10 ||
      p0 === 127 ||
      (p0 === 100 && p1 >= 64 && p1 <= 127) || // CGNAT
      (p0 === 169 && p1 === 254) || // link-local: cloud metadata lives here
      (p0 === 172 && p1 >= 16 && p1 <= 31) ||
      (p0 === 192 && p1 === 168) ||
      p0 >= 224 // multicast + reserved
    );
  }

  if (!a.includes(':')) return false; // a name, not an address — nothing to judge here
  return IPV6_PRIVATE.test(a);
}

/** Why a URL is not fetchable — reported so callers can phrase their own error. */
export type UnfetchableReason = 'invalid' | 'scheme' | 'blocked';

export type FetchableUrl = { ok: true; url: URL } | { ok: false; reason: UnfetchableReason };

/**
 * The single gate every fetcher of a stranger-supplied URL passes through: it is
 * HTTP(S) and its host is not blocked outright. Returns the parsed URL so
 * callers do not parse it twice, and the failing check so they can distinguish
 * a typo from a blocked target without re-deriving the rules.
 */
export function parseFetchableUrl(raw: string | URL): FetchableUrl {
  let url: URL;
  // Accepts an already-parsed URL so a caller that had to resolve one (a
  // redirect against its base, say) does not serialize it just to reparse it.
  if (raw instanceof URL) {
    url = raw;
  } else {
    try {
      url = new URL(raw);
    } catch {
      return { ok: false, reason: 'invalid' };
    }
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false, reason: 'scheme' };
  if (isBlockedHost(url.hostname)) return { ok: false, reason: 'blocked' };
  return { ok: true, url };
}
