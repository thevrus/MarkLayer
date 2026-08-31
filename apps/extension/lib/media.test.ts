import { describe, expect, test } from 'bun:test';
import { prefersReducedMotion } from './media';

const stubMatchMedia = (matches: boolean) => {
  const calls: string[] = [];
  Object.defineProperty(globalThis, 'matchMedia', {
    value: (query: string) => {
      calls.push(query);
      return { matches };
    },
    configurable: true,
    writable: true,
  });
  return calls;
};

describe('prefersReducedMotion', () => {
  test('asks for the reduce preference specifically', () => {
    // `(prefers-reduced-motion)` without the value matches on any setting,
    // including "no-preference", which would disable motion for everyone.
    const calls = stubMatchMedia(true);
    expect(prefersReducedMotion()).toBe(true);
    expect(calls).toEqual(['(prefers-reduced-motion: reduce)']);
  });

  test('is false when the user has expressed no such preference', () => {
    stubMatchMedia(false);
    expect(prefersReducedMotion()).toBe(false);
  });

  test('is false where matchMedia does not exist, rather than throwing', () => {
    // This module is shared into the extension content script, which runs on
    // any page and in contexts the web app never sees.
    const original = globalThis.matchMedia;
    Object.defineProperty(globalThis, 'matchMedia', { value: undefined, configurable: true, writable: true });
    try {
      expect(prefersReducedMotion()).toBe(false);
    } finally {
      Object.defineProperty(globalThis, 'matchMedia', { value: original, configurable: true, writable: true });
    }
  });
});
