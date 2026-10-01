import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { DrawOp } from '@marklayer/types';

// No IndexedDB in the test DOM, and every write to `operations` schedules a draft save.
mock.module('idb-keyval', () => ({
  createStore: () => ({}),
  get: async () => undefined,
  set: async () => {},
  del: async () => {},
}));

const { operations } = await import('./state');
const { canPushSnapshot, getShareUrl, resetRoomIdentity } = await import('./share');
const { activeRoomId, joinRoom } = await import('./room');

const op = (id: string): DrawOp => ({
  id,
  color: '#000',
  lineWidth: 2,
  tool: 'text',
  text: id,
  x: 0,
  y: 0,
  fontSize: 14,
});

const originalFetch = globalThis.fetch;
const originalError = console.error;
const setFetch = (value: unknown) =>
  Object.defineProperty(globalThis, 'fetch', { value, configurable: true, writable: true });
const respondWith = (res: () => Response) => setFetch(async () => res());

describe('joinRoom', () => {
  beforeEach(() => {
    resetRoomIdentity();
    activeRoomId.value = null;
    operations.value = [op('L')];
    // loadAnnotations logs its failures; keep the run readable.
    console.error = () => {};
  });

  afterAll(() => {
    setFetch(originalFetch);
    console.error = originalError;
    operations.value = [];
    activeRoomId.value = null;
    resetRoomIdentity();
  });

  test('folds the room in beside local work and binds the canvas to it', async () => {
    respondWith(() => Response.json([op('R')]));
    expect(await joinRoom({ id: 'room-ok' })).toBe(true);
    expect(operations.value.map((o) => o.id)).toEqual(['R', 'L']);
    expect(activeRoomId.value).toBe('room-ok');
  });

  // A typo'd id used to stay as the room identity, so the next share pointed at it
  // and saveAnnotations refused it as a joined room.
  test('a room that does not exist leaves local work and the room identity alone', async () => {
    const before = getShareUrl();
    respondWith(() => new Response('not found', { status: 404 }));
    expect(await joinRoom({ id: 'room-typo' })).toBe(false);
    expect(operations.value).toEqual([op('L')]);
    expect(activeRoomId.value).toBeNull();
    expect(getShareUrl()).toBe(before);
    expect(canPushSnapshot()).toBe(true);
  });

  test('a body that is not an op list is a failed join', async () => {
    const before = getShareUrl();
    respondWith(() => Response.json({ error: 'nope' }));
    expect(await joinRoom({ id: 'room-odd' })).toBe(false);
    expect(operations.value).toEqual([op('L')]);
    expect(activeRoomId.value).toBeNull();
    expect(getShareUrl()).toBe(before);
  });
});
