import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';

const stored = new Map<string, string>();
const realStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (k: string) => stored.get(k) ?? null,
    setItem: (k: string, v: string) => stored.set(k, v),
    removeItem: (k: string) => stored.delete(k),
  },
  configurable: true,
});

const { readSupportRecord } = await import('./support');
const { watchUse } = await import('./support-ui');
const { canEditFromRoom } = await import('@ext/lib/realtime');

const daysUsed = () => readSupportRecord().days.length;

describe('B89: a day of use counts only once the room says this person can edit', () => {
  let stop = () => {};

  beforeEach(() => {
    stored.clear();
    canEditFromRoom.value = undefined;
    stop = watchUse();
  });

  afterEach(() => {
    stop();
    canEditFromRoom.value = undefined;
  });

  afterAll(() => {
    if (realStorage) Object.defineProperty(globalThis, 'localStorage', realStorage);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  });

  test('a guest the room makes read-only after mount is not a user', () => {
    canEditFromRoom.value = false;
    expect(daysUsed()).toBe(0);
  });

  test('an author counts once, however often the room repeats itself', () => {
    expect(daysUsed()).toBe(0);
    canEditFromRoom.value = true;
    expect(daysUsed()).toBe(1);
    canEditFromRoom.value = false;
    canEditFromRoom.value = true;
    expect(daysUsed()).toBe(1);
  });
});
