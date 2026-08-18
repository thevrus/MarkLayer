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
