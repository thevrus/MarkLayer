import type { HonoRequest } from 'hono';

/** True when this client is over `limiter`'s budget. No binding (dev, tests) never limits. */
export async function overRateLimit({ limiter, req }: { limiter?: RateLimit; req: HonoRequest }): Promise<boolean> {
  if (!limiter) return false;
  const { success } = await limiter.limit({ key: req.header('cf-connecting-ip') ?? 'unknown' });
  return !success;
}
