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
const IPV4_TAIL = /:(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const HEXTET = /^[0-9a-f]{1,4}$/;
/** `::`/`::1` unspecified + loopback, `fc00::/7` unique-local, `fe80::/10` link-local. */
const IPV6_PRIVATE = /^(::1?$|f[cd]|fe[89ab])/;

function isPrivateV4(p0: number, p1: number): boolean {
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

/** An IPv6 literal as its eight 16-bit groups, or null when it is not one. Accepts a dotted v4 tail. */
function hextets(a: string): number[] | null {
  const tail = IPV4_TAIL.exec(a);
  const pair = (hi: string | undefined, lo: string | undefined) => ((Number(hi) << 8) | Number(lo)).toString(16);
  const text = tail ? `${a.slice(0, tail.index)}:${pair(tail[1], tail[2])}:${pair(tail[3], tail[4])}` : a;
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = 8 - head.length - rest.length;
  if (halves.length === 2 ? fill < 1 : fill !== 0) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? fill : 0).fill('0'), ...rest];
  if (!groups.every((g) => HEXTET.test(g))) return null;
  return groups.map((g) => Number.parseInt(g, 16));
}

/**
 * The first two octets of an IPv4 address carried inside an IPv6 one — v4-mapped
 * `::ffff:0:0/96`, v4-compatible `::/96`, NAT64 `64:ff9b::/96`, 6to4 `2002::/16` —
 * since each of those reaches the v4 host, which is what has to be judged.
 */
function embeddedV4(a: string): [number, number] | null {
  const g = hextets(a);
  if (!g) return null;
  const zeroTo = (n: number) => g.slice(0, n).every((x) => x === 0);
  let hi: number | undefined;
  if (zeroTo(5) && (g[5] === 0xffff || g[5] === 0)) hi = g[6];
  else if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) hi = g[6];
  else if (g[0] === 0x2002) hi = g[1];
  return hi === undefined ? null : [hi >> 8, hi & 0xff];
}

/**
 * Whether an IP address literal is one we refuse to connect to: loopback, any
 * RFC1918 range, link-local (which carries the cloud metadata endpoint), CGNAT,
 * and their IPv6 equivalents, including IPv6 forms that embed a private IPv4.
 */
export function isPrivateAddress(address: string): boolean {
  const a = address.toLowerCase().replace(BRACKETS, '');

  const octets = IPV4.exec(a);
  if (octets) return isPrivateV4(Number(octets[1]), Number(octets[2]));

  if (!a.includes(':')) return false; // a name, not an address — nothing to judge here
  if (IPV6_PRIVATE.test(a)) return true;
  const v4 = embeddedV4(a);
  return v4 !== null && isPrivateV4(v4[0], v4[1]);
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

/**
 * Outlook rewrites every link in a message to `<region>.safelinks.protection.outlook.com/?url=<real>`,
 * so a link pasted from an email names the scanner, which challenges the proxy. Returns the real
 * target, or the input untouched when it is not a Safe Link or carries no http(s) target.
 */
export function unwrapSafeLink(raw: string): string {
  try {
    const u = new URL(raw);
    if (
      u.hostname !== 'safelinks.protection.outlook.com' &&
      !u.hostname.endsWith('.safelinks.protection.outlook.com')
    ) {
      return raw;
    }
    const target = u.searchParams.get('url');
    return target && /^https?:\/\//i.test(target) ? target : raw;
  } catch {
    return raw;
  }
}
