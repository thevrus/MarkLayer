import { describe, expect, test } from 'bun:test';
import { effect, signal } from '@preact/signals';
import { stableComputed } from './stable';

describe('stableComputed', () => {
  test('holds its previous value while the new one is equivalent', () => {
    const source = signal([1, 2, 3]);
    const view = stableComputed({
      compute: () => source.value.map((n) => n * 2),
      equals: (a, b) => a.length === b.length && a.every((n, i) => n === b[i]),
    });

    const first = view.value;
    // A fresh array with the same contents: the source identity moved, the
    // meaning did not.
    source.value = [1, 2, 3];
    expect(view.value).toBe(first);
  });

  test('produces a new value once something meaningful moves', () => {
    const source = signal([1, 2, 3]);
    const view = stableComputed({
      compute: () => source.value.slice(),
      equals: (a, b) => a.length === b.length && a.every((n, i) => n === b[i]),
    });

    const first = view.value;
    source.value = [1, 2, 4];
    expect(view.value).not.toBe(first);
    expect(view.value).toEqual([1, 2, 4]);
  });

  test('keeps subscribers off the path when the value is equivalent', () => {
    const source = signal(0);
    const view = stableComputed({
      compute: () => ({ bucket: source.value < 10 ? 'low' : 'high' }),
      equals: (a, b) => a.bucket === b.bucket,
    });

    const seen: string[] = [];
    effect(() => {
      seen.push(view.value.bucket);
    });

    source.value = 1;
    source.value = 5;
    expect(seen).toEqual(['low']);

    source.value = 50;
    expect(seen).toEqual(['low', 'high']);
  });

  test('works for a value that is itself undefined', () => {
    // The cache is boxed rather than compared against undefined, so this must
    // not re-compute forever or hand back a stale box.
    const source = signal(0);
    let computes = 0;
    const view = stableComputed<number | undefined>({
      compute: () => {
        computes++;
        return source.value === 0 ? undefined : source.value;
      },
      equals: (a, b) => a === b,
    });

    expect(view.value).toBeUndefined();
    const after = computes;
    expect(view.value).toBeUndefined();
    // A cached read does not recompute.
    expect(computes).toBe(after);

    source.value = 7;
    expect(view.value).toBe(7);
  });

  test('does not call equals before there is a previous value to compare', () => {
    let calls = 0;
    const source = signal(1);
    const view = stableComputed({
      compute: () => source.value,
      equals: (a, b) => {
        calls++;
        return a === b;
      },
    });
    expect(view.value).toBe(1);
    expect(calls).toBe(0);
  });
});
