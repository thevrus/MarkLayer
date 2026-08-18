/**
 * The proxy's own plain-text error bodies, paired with the short label the
 * viewer reports as a failure reason.
 *
 * Both sides import this: `proxy.ts` serves `message`, and the viewer matches
 * it to recover `label` (see `classifyProxyError` in web/Viewer.tsx). They used
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
