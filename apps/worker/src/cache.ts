import type { WaitUntil } from './env';

// Refresh pre-rebrand images in place, without changing room or object keys.
const OG_ARTWORK_VERSION = 'visual-collaboration-1';
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
  admit,
}: {
  bucket: R2Bucket;
  key: string;
  ctx: WaitUntil;
  render: () => Promise<ArrayBuffer>;
  /** Asked on a miss only, so a rate limit spends nothing on a card already in R2. */
  admit?: () => Promise<boolean>;
}): Promise<Response> {
  const cached = await bucket.get(key);
  if (cached?.customMetadata?.artwork === OG_ARTWORK_VERSION) {
    return new Response(cached.body, { headers: dayCached('image/png') });
  }
  if (admit && !(await admit())) return new Response('Too many requests', { status: 429 });

  const png = await render();
  ctx.waitUntil(
    bucket.put(key, png, {
      httpMetadata: { contentType: 'image/png' },
      customMetadata: { artwork: OG_ARTWORK_VERSION },
    }),
  );
  return new Response(png, { headers: dayCached('image/png') });
}
