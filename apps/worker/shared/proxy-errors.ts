/**
 * The proxy's own plain-text error bodies, paired with the short label the
 * viewer reports as a failure reason.
 *
 * Both sides import this: the proxy routes serve `message`, and the viewer matches
 * it to recover `label` (`classifyProxyError` below, called from web/viewer/useRenderOutcome.ts). They used
 * to be two hand-synced copies of the same English prose, so rewording one
 * message silently degraded every proxy-failure metric to "unrecognized".
 *
 * Kept free of server imports so the client bundle can share it without
 * dragging Hono in.
 */
export const PROXY_ERRORS = {
  missingUrl: { message: 'Missing ?url= parameter', label: 'missing-url' },
  invalidUrl: { message: 'Invalid URL', label: 'invalid-url' },
  badScheme: { message: 'Only HTTP(S) URLs are allowed', label: 'bad-scheme' },
  blockedHost: { message: 'Blocked URL', label: 'blocked-host' },
  fetchThrew: { message: 'Proxy error: failed to fetch the requested URL', label: 'fetch-threw' },
  tooManyRequests: { message: 'Too many requests', label: 'too-many-requests' },
  missingHost: { message: 'Missing host', label: 'missing-host' },
  subProxy: { message: 'Sub-proxy error', label: 'sub-proxy' },
} as const;

export type ProxyErrorLabel = (typeof PROXY_ERRORS)[keyof typeof PROXY_ERRORS]['label'];

/**
 * Classify a proxy failure from the body it served. Bounded scan: an upstream
 * page that merely *contains* one of these phrases would be a false positive,
 * but the proxy's own errors are the whole body. The body itself is never
 * reported — on a private or staging URL that is somebody's confidential
 * content.
 */
export function classifyProxyError(body: string | null | undefined): ProxyErrorLabel | 'empty' | 'unrecognized' {
  if (!body) return 'empty';
  const head = body.slice(0, 200);
  for (const { message, label } of Object.values(PROXY_ERRORS)) {
    if (head.includes(message)) return label;
  }
  return 'unrecognized';
}

/**
 * Firewalls the viewer has host-specific advice for; `FIREWALL_ADVICE` in web/viewerFrame.ts is
 * keyed by `id`, so a row here without advice fails the type check. A firewall is only named when
 * its challenge says so. SiteGround is here because its owner can't disable or even see the
 * challenge, so the generic "ask your host" copy misleads.
 */
export const FIREWALLS = [{ id: 'siteground', header: 'sg-captcha', path: /\/\.well-known\/sgcaptcha/i }] as const;

export type Firewall = (typeof FIREWALLS)[number]['id'];

export const FIREWALL_IDS = FIREWALLS.map((firewall) => firewall.id);

export function identifyFirewall({ headers, head }: { headers: Headers; head: string }): Firewall | null {
  return FIREWALLS.find(({ header, path }) => headers.has(header) || path.test(head))?.id ?? null;
}
