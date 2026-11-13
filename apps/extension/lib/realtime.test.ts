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

const { applyChange, onChange, operations } = await import('./ops');
const { selectLayer } = await import('./layers');
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

  test('an explicit AI mention queues a task in the current working layer', () => {
    const socket = connect();
    socket.open();
    socket.receive({
      type: 'init',
      ops: [],
      layers: [
        { id: 'default', name: '默认图层', created_at: 0 },
        { id: 'review', name: '审查', created_at: 1 },
      ],
      peers: [{ id: 'mcp-codex-a', uid: 'codex', name: 'Codex', color: '#000000' }],
    });
    selectLayer('review');
    const comment: DrawOp = {
      id: 'reply',
      tool: 'comment',
      num: 1,
      text: '@Codex',
      parentId: 'root',
      x: 0,
      y: 0,
      color: '#000000',
      lineWidth: 2,
      ts: 1,
      mentions: [{ id: 'codex', name: 'Codex' }],
    };
    onChange.value?.({ type: 'op', op: comment });
    const frames = socket.sent.map((frame) => JSON.parse(frame));
    expect(frames).toContainEqual(
      expect.objectContaining({
        type: 'task_submit',
        agentId: 'codex',
        annotationId: 'root',
        sourceId: 'reply',
        layerId: 'review',
      }),
    );
  });

  test('a mention can be queued for a claimed AI after it disconnects', () => {
    const socket = connect();
    socket.open();
    socket.receive({
      type: 'init',
      ops: [],
      peers: [],
      claims: [{ agent_id: 'codex', owner_id: 'u1', owner_name: 'User' }],
    });
    const comment: DrawOp = {
      id: 'offline',
      tool: 'comment',
      num: 1,
      text: '@Codex',
      x: 0,
      y: 0,
      color: '#000000',
      lineWidth: 2,
      ts: 1,
      mentions: [{ id: 'codex', name: 'Codex' }],
    };
    onChange.value?.({ type: 'op', op: comment });
    expect(socket.sent.map((frame) => JSON.parse(frame))).toContainEqual(
      expect.objectContaining({ type: 'task_submit', agentId: 'codex', sourceId: 'offline' }),
    );
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

  test('a nack rolls back the matching optimistic op and shows its reason', () => {
    const socket = connect();
    socket.open();
    socket.receive({ type: 'init', ops: [] });
    const optimistic = op('nack-op');
    applyChange({ type: 'op', op: optimistic }, { origin: 'local' });
    const sent = JSON.parse(socket.sent[0] ?? 'null') as { clientOpId: string };
    expect(operations.value).toContainEqual(optimistic);

    socket.receive({
      type: 'nack',
      opId: sent.clientOpId,
      status: 'refused',
      code: 'layer_unavailable',
      reason: '目标图层不存在',
    });
    expect(operations.value).toEqual([]);
    expect(toasts.value.some((item) => item.message.includes('目标图层不存在'))).toBe(true);
  });

  test('a noop ack confirms the local op and clears its pending rollback', () => {
    const socket = connect();
    socket.open();
    socket.receive({ type: 'init', ops: [] });
    const optimistic = op('noop-op');
    applyChange({ type: 'op', op: optimistic }, { origin: 'local' });
    const sent = JSON.parse(socket.sent[0] ?? 'null') as { clientOpId: string };

    socket.receive({ type: 'ack', opId: sent.clientOpId, status: 'noop', rev: 1 });
    socket.receive({
      type: 'nack',
      opId: sent.clientOpId,
      status: 'refused',
      code: 'read_only',
      reason: 'stale receipt',
    });
    expect(operations.value).toEqual([optimistic]);
    expect(toasts.value.some((item) => item.message.includes('stale receipt'))).toBe(false);
  });

  test('pending changes unwind in reverse, so a create and its undo leave nothing behind', async () => {
    const socket = connect();
    socket.open();
    socket.receive({ type: 'init', ops: [] });
    applyChange({ type: 'op', op: op('phantom') }, { origin: 'local' });
    applyChange({ type: 'undo', opId: 'phantom' }, { origin: 'local' });
    expect(operations.value).toEqual([]);

    // The socket dies before either change is answered: undoing the undo first (it re-inserts the
    // op) and then the create (it removes that id again) is what leaves the board empty. Insertion
    // order resurrects the op the room never received.
    socket.close();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(operations.value).toEqual([]);
  });

  test('a rolled-back patch leaves a newer peer edit of the same field alone', () => {
    const socket = connect();
    socket.open();
    socket.receive({ type: 'init', ops: [op('shared')] });
    applyChange({ type: 'update_op', opId: 'shared', patch: { text: 'mine' } }, { origin: 'local' });
    // A peer's accepted edit to the same field lands while ours waits for its receipt.
    socket.receive({ type: 'update_op', opId: 'shared', patch: { text: 'theirs' } });
    const frame = socket.sent
      .map((raw) => JSON.parse(raw) as { clientOpId?: string })
      .find((msg) => typeof msg.clientOpId === 'string');
    socket.receive({
      type: 'nack',
      opId: frame?.clientOpId,
      status: 'refused',
      code: 'read_only',
      reason: '只读',
    });
    expect((operations.value[0] as Extract<DrawOp, { tool: 'text' }> | undefined)?.text).toBe('theirs');
  });
  test('an unacknowledged optimistic op rolls back after the receipt timeout', async () => {
    const socket = connect();
    socket.open();
    socket.receive({ type: 'init', ops: [] });
    applyChange({ type: 'op', op: op('timeout-op') }, { origin: 'local' });
    expect(operations.value).toHaveLength(1);
    await new Promise((resolve) => setTimeout(resolve, 15_050));
    expect(operations.value).toEqual([]);
    expect(toasts.value.some((item) => item.message.includes('连接不稳，改动没同步上'))).toBe(true);
    // The receipt window is 15s of real time; bun test's default 5s cap would cut it short.
  }, 20_000);

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
