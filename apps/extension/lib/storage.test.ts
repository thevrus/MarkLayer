import { beforeEach, describe, expect, test } from 'bun:test';
import { lsGet, lsSet, persistedFlag } from './storage';

beforeEach(() => {
  localStorage.clear();
});

describe('lsGet and lsSet', () => {
  test('round-trip a value', () => {
    lsSet('k', 'v');
    expect(lsGet('k')).toBe('v');
  });

  test('report a missing key as null rather than undefined', () => {
    expect(lsGet('never-written')).toBeNull();
  });

  test('remove the key on a null write, instead of storing the string "null"', () => {
    lsSet('k', 'v');
    lsSet('k', null);
    expect(lsGet('k')).toBeNull();
    expect(localStorage.getItem('k')).toBeNull();
  });

  test('store an empty string as a value, distinct from removing it', () => {
    lsSet('k', '');
    expect(lsGet('k')).toBe('');
  });
});

describe('persistedFlag', () => {
  test('starts at its fallback when nothing is stored', () => {
    const [on] = persistedFlag({ key: 'f', fallback: true });
    const [off] = persistedFlag({ key: 'g', fallback: false });
    expect(on.value).toBe(true);
    expect(off.value).toBe(false);
  });

  test('writes nothing while the flag sits at its default', () => {
    // A missing key has to mean "as shipped" - that is what lets a default flip
    // in code carry over to everyone who never touched the setting.
    const [flag, toggle] = persistedFlag({ key: 'f', fallback: false });
    toggle();
    expect(localStorage.getItem('f')).toBe('1');
    toggle();
    expect(flag.value).toBe(false);
    expect(localStorage.getItem('f')).toBeNull();
  });

  test('stores the off state explicitly when the default is on', () => {
    const [flag, toggle] = persistedFlag({ key: 'f', fallback: true });
    toggle();
    expect(flag.value).toBe(false);
    expect(localStorage.getItem('f')).toBe('0');
  });

  test('restores a stored non-default value on the next load', () => {
    localStorage.setItem('f', '0');
    const [flag] = persistedFlag({ key: 'f', fallback: true });
    expect(flag.value).toBe(false);

    localStorage.setItem('g', '1');
    const [other] = persistedFlag({ key: 'g', fallback: false });
    expect(other.value).toBe(true);
  });

  test('carries a changed default to someone who never touched the setting', () => {
    // Ship with the flag off, user never toggles, a later release defaults it on.
    const [before, toggle] = persistedFlag({ key: 'f', fallback: false });
    toggle();
    toggle();
    expect(before.value).toBe(false);
    const [after] = persistedFlag({ key: 'f', fallback: true });
    expect(after.value).toBe(true);
  });

  test('reads any stored value that is not "1" as false', () => {
    localStorage.setItem('f', 'garbage');
    const [flag] = persistedFlag({ key: 'f', fallback: true });
    expect(flag.value).toBe(false);
  });
});
