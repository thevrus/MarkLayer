/**
 * Memoize a zero-arg factory for the life of the isolate.
 *
 * Used for values that must be computed at request time rather than in module
 * scope (`Date.now()` is unreliable during Worker startup) but should not be
 * recomputed on every request. Memoizing an async factory caches the promise,
 * so concurrent first requests share one computation instead of racing.
 *
 * The result is boxed rather than kept as a `value`/`called` pair so the memo
 * needs no cast to convince the checker the value exists once it is built.
 */
export function once<T>(factory: () => T): () => T {
  let cached: { value: T } | null = null;
  return () => {
    cached ??= { value: factory() };
    return cached.value;
  };
}

/**
 * Response headers for a static, immutable-per-deploy document — the agent-facing
 * files (robots, llms.txt, security.txt, the skill and MCP cards), the OpenAPI
 * spec and rendered OG cards. One definition so the TTL can't drift apart
 * across a dozen routes.
 */
export function dayCached(contentType: string): Record<string, string> {
  return { 'Content-Type': contentType, 'Cache-Control': 'public, max-age=86400' };
}

/**
 * Serve a PNG from R2, rendering it only on a miss. Both OG routes are the same
 * read-through cache over different composers, so the store-and-header half is
 * written once and `render` is lazy — a hit never touches D1 or the rasterizer.
 *
 * The put rides `waitUntil` on purpose: the image is already in hand, so the
 * response should not wait on the write.
 */
export async function cachedPng({
  bucket,
  key,
  ctx,
  render,
}: {
  bucket: R2Bucket;
  key: string;
  ctx: { waitUntil(promise: Promise<unknown>): void };
  render: () => Promise<ArrayBuffer>;
}): Promise<Response> {
  const cached = await bucket.get(key);
  if (cached) return new Response(cached.body, { headers: dayCached('image/png') });

  const png = await render();
  ctx.waitUntil(bucket.put(key, png, { httpMetadata: { contentType: 'image/png' } }));
  return new Response(png, { headers: dayCached('image/png') });
}

/**
 * `btoa` throws on any code point over 255, so the bytes become a binary string
 * first. One definition for the MIME encoder, integration basic-auth and tokens.
 */
export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** UTF-8 text as base64. */
export function base64Utf8(value: string): string {
  return toBase64(new TextEncoder().encode(value));
}

/** URL- and cookie-safe base64: no padding, no `+`, no `/`. */
export function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

/** Lowercase hex SHA-256 of UTF-8 text. */
export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
