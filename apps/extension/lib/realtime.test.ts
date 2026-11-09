import { afterAll, afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import type { DrawOp } from '@marklayer/types/ops';
import { signal } from '@preact/signals';
import type { ConnectRoomHooks } from './realtime';

// No IndexedDB in the test DOM, and every write to `operations` schedules a draft save.
mock.module('idb-keyval', () => ({
  createStore: () => ({}),
  get: async () => undefined,
  set: async () => {},
  del: async () => {},
}));

const { onChange, operations } = await import('./ops');
const { canEditFromRoom, connectRoom, execMode } = await import('./realtime');
const { resetRoomIdentity, setAnnotationId } = await import('./room-id');
const { toasts } = await import('./toasts');

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

let teardown: (() => void) | null = null;
const connect = (hooks?: ConnectRoomHooks) => {
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

  test('room execution mode follows init and live changes and resets on disconnect', () => {
    const socket = connect();
    socket.open();
    socket.receive({ type: 'init', ops: [], execMode: 'guide' });
    expect(execMode.value).toBe('guide');
    socket.receive({ type: 'exec_mode', execMode: 'solo' });
    expect(execMode.value).toBe('solo');
    teardown?.();
    teardown = null;
    expect(execMode.value).toBe('pair');
  });

  test('a presenter says nothing on a host with no follow to explain', () => {
    const socket = connect();
    socket.open();
    socket.receive({ type: 'flock', peerId: 'p1', name: 'Ana', on: true });
    expect(toasts.value.filter((t) => t.message.includes('presenting'))).toEqual([]);
  });

  test('a host-forced read-only session hears nothing of an access flip', () => {
    const accessToasts = () => toasts.value.filter((t) => t.message.includes('edit this link'));
    canEditFromRoom.value = false;
    connect({ forcedReadonly: signal(true) }).receive({ type: 'access', canEdit: true });
    expect(accessToasts()).toEqual([]);
    teardown?.();

    canEditFromRoom.value = false;
    connect().receive({ type: 'access', canEdit: true });
    expect(accessToasts()).toHaveLength(1);
    canEditFromRoom.value = undefined;
  });

  test('arrival keeps local work and flushes the offline queue in order', () => {
    operations.value = [op('L')];
    const socket = connect();
    onChange.value?.({ type: 'op', op: op('A') });
    onChange.value?.({ type: 'op', op: op('B') });
    expect(socket.sent).toEqual([]);

    socket.open();
    socket.receive({ type: 'init', ops: [op('R')], peers: [] });

    expect(sentOpIds(socket)).toEqual(['A', 'B']);
    expect(operations.value.map((o) => o.id)).toEqual(['R', 'L']);
  });

  test('a long offline queue drains in slices, in order, without dropping the tail', async () => {
    const socket = connect();
    for (let i = 0; i < 1000; i++) onChange.value?.({ type: 'op', op: op(`q${i}`) });
    socket.open();
    // Past the first burst the rest waits, and a live op queues behind it rather than overtaking.
    expect(sentOpIds(socket)).toHaveLength(800);
    onChange.value?.({ type: 'op', op: op('live') });
    expect(sentOpIds(socket)).toHaveLength(800);

    await Bun.sleep(2100);
    const ids = sentOpIds(socket);
    expect(ids).toHaveLength(1001);
    expect(ids.at(-2)).toBe('q999');
    expect(ids.at(-1)).toBe('live');
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

  test('X38 teardown leaves no interval running', () => {
    const isTimer = (handle: unknown): handle is ReturnType<typeof setInterval> => typeof handle === 'object';
    const started = spyOn(globalThis, 'setInterval');
    const cleared = spyOn(globalThis, 'clearInterval');
    const handles = () => started.mock.results.map((result) => result.value);
    try {
      connect().open();
      teardown?.();
      teardown = null;
      const stopped: unknown[] = cleared.mock.calls.map(([handle]) => handle);
      expect(handles().filter((handle) => !stopped.includes(handle))).toEqual([]);
    } finally {
      started.mockRestore();
      cleared.mockRestore();
      for (const handle of handles().filter(isTimer)) clearInterval(handle);
    }
  });

  test('a malformed iceServers in init costs the relay, not the room', () => {
    const socket = connect();
    socket.open();
    socket.receive({ type: 'init', ops: [op('R')], peers: [], iceServers: 'not-a-list' });
    expect(operations.value.map((o) => o.id)).toEqual(['R']);
  });

  test('a frame the wire schema refuses changes nothing', () => {
    const socket = connect();
    socket.open();
    socket.receive({ type: 'init', ops: [op('R')], peers: [] });
    socket.receive({ type: 'op', op: { id: 'no-tool' } });
    expect(operations.value.map((o) => o.id)).toEqual(['R']);
  });

  test('X30 a joined room gets no wholesale POST while its socket is down', async () => {
    const posts: string[] = [];
    setGlobal('fetch', async (url: string) => {
      posts.push(url);
      return new Response('{}');
    });
    setAnnotationId('room-1');
    try {
      const socket = connect();
      socket.open();
      socket.receive({ type: 'init', ops: [op('R')], peers: [] });

      // An abrupt drop: the base fake's `close()` carries no event, and the client reads its code.
      socket.readyState = FakeSocket.CLOSED;
      const onclose: unknown = socket.onclose;
      if (typeof onclose === 'function') onclose({ code: 1006 });

      onChange.value?.({ type: 'op', op: op('A') });
      await Bun.sleep(3100);
      expect(posts).toEqual([]);
    } finally {
      resetRoomIdentity();
    }
  });
});
