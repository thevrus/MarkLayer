import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { DrawOp } from '@marklayer/types';
import { computed, signal } from '@preact/signals';

// No IndexedDB in the test DOM, and every write to `operations` schedules a draft save.
mock.module('idb-keyval', () => ({
  createStore: () => ({}),
  get: async () => undefined,
  set: async () => {},
  del: async () => {},
}));

const { onOpPushed, operations } = await import('./state');
const { connectRoom } = await import('./realtime');

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

/** Stands in for the browser socket: records what is sent, and the test plays the server. */
class FakeSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  static instances: FakeSocket[] = [];
  readyState = FakeSocket.CONNECTING;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    FakeSocket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  // A browser fires `close` on a later task, to whichever handler is set by then.
  close() {
    this.readyState = FakeSocket.CLOSED;
    queueMicrotask(() => this.onclose?.());
  }
  open() {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.();
  }
  receive(msg: unknown) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
}

function sentOpIds(socket: FakeSocket): string[] {
  return socket.sent.flatMap((frame) => {
    const msg: unknown = JSON.parse(frame);
    if (typeof msg !== 'object' || msg === null || !('type' in msg) || msg.type !== 'op' || !('op' in msg)) return [];
    const { op } = msg;
    return typeof op === 'object' && op !== null && 'id' in op && typeof op.id === 'string' ? [op.id] : [];
  });
}

const originals = { WebSocket: globalThis.WebSocket, fetch: globalThis.fetch };
const setGlobal = (key: 'WebSocket' | 'fetch', value: unknown) =>
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });

const canEditFromRoom = signal<boolean | undefined>(undefined);
const hooks = { canEditFromRoom, isReadonly: computed(() => canEditFromRoom.value === false) };

let teardown: (() => void) | null = null;
const connect = () => {
  teardown = connectRoom({ roomId: 'room-1', origin: 'https://marklayer.app', hooks });
  const socket = FakeSocket.instances.at(-1);
  if (!socket) throw new Error('connectRoom opened no socket');
  return socket;
};

describe('connectRoom', () => {
  beforeEach(() => {
    FakeSocket.instances = [];
    setGlobal('WebSocket', FakeSocket);
    // The offline REST fallback must never reach the network from a test.
    setGlobal('fetch', async () => new Response('{}'));
    operations.value = [];
  });

  afterEach(() => {
    teardown?.();
    teardown = null;
    operations.value = [];
  });

  afterAll(() => {
    setGlobal('WebSocket', originals.WebSocket);
    setGlobal('fetch', originals.fetch);
  });

  test('arrival keeps local work and flushes the offline queue in order', () => {
    operations.value = [op('L')];
    const socket = connect();
    onOpPushed.value?.(op('A'));
    onOpPushed.value?.(op('B'));
    expect(socket.sent).toEqual([]);

    socket.open();
    socket.receive({ type: 'init', ops: [op('R')], peers: [] });

    expect(sentOpIds(socket)).toEqual(['A', 'B']);
    expect(operations.value.map((o) => o.id)).toEqual(['R', 'L']);
  });

  test('a torn-down room cannot write ops', async () => {
    const socket = connect();
    socket.open();
    socket.receive({ type: 'init', ops: [op('R')], peers: [] });
    const before = operations.value;

    teardown?.();
    teardown = null;
    // Frames still in flight from the old room, delivered the way the browser would.
    socket.receive({ type: 'op', op: op('X') });
    socket.receive({ type: 'clear' });
    expect(operations.value).toBe(before);

    // The first reconnect backs off 1s; give it the chance to fire.
    await Bun.sleep(1100);
    expect(FakeSocket.instances).toHaveLength(1);
  });
});
