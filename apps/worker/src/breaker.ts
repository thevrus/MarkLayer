/**
 * Stops calling a destination after `trips` consecutive failures. With a
 * `cooldownMs` it lets one request re-test after the rest; without, it stays
 * open for the life of its owner.
 */
export function createBreaker({ trips, cooldownMs = Infinity }: { trips: number; cooldownMs?: number }) {
  let failures = 0;
  let openUntil = 0;
  return {
    admits(): boolean {
      return Date.now() >= openUntil;
    },
    succeeded(): void {
      failures = 0;
    },
    failed(): void {
      failures++;
      if (failures < trips) return;
      openUntil = Date.now() + cooldownMs;
      failures = 0;
    },
  };
}
