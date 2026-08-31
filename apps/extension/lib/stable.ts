import { computed, type ReadonlySignal } from '@preact/signals';

/**
 * A computed that keeps its previous value while the new one is equivalent.
 *
 * `peers` swaps its Map on every remote cursor frame and `operations` on every
 * stroke, so a plain computed over either changes identity many times a second
 * and re-renders every subscriber. Holding the old reference while `equals` says
 * nothing meaningful moved keeps those consumers off that path.
 *
 * The cache is boxed rather than compared against `undefined`, so a `T` that can
 * itself be undefined still works and nothing needs asserting.
 */
export function stableComputed<T>({
  compute,
  equals,
}: {
  compute: () => T;
  equals: (previous: T, next: T) => boolean;
}): ReadonlySignal<T> {
  let cache: { value: T } | null = null;
  return computed(() => {
    const next = compute();
    if (!cache || !equals(cache.value, next)) cache = { value: next };
    return cache.value;
  });
}
