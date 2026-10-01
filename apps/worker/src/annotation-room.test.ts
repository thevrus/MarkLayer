import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import type { DrawOp } from '@marklayer/types';
import { asDb, fakeDb } from './test-d1';

// The runtime module only exists inside workerd; the room needs nothing of it but a base class.
mock.module('cloudflare:workers', () => ({
  DurableObject: class {
    ctx: unknown;
    env: unknown;
    constructor(ctx: unknown, env: unknown) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));
const { AnnotationRoom } = await import('./annotation-room');

const ID = 'dsWPMrdw6EZ8jkkhxvFKS';
const op: DrawOp = {
  id: 'op-flush-1',
  tool: 'rectangle',
  color: '#000000',
  lineWidth: 2,
  startX: 0,
  startY: 0,
  endX: 10,
  endY: 10,
};
const editableRow = { ops: '[]', access: 'edit', owner_id: null, owner_expires_at: null };

const hadPair = 'WebSocketRequestResponsePair' in globalThis;
const originalPair: unknown = Reflect.get(globalThis, 'WebSocketRequestResponsePair');
beforeAll(() => {
  Reflect.set(globalThis, 'WebSocketRequestResponsePair', class {});
});
afterAll(() => {
  if (hadPair) Reflect.set(globalThis, 'WebSocketRequestResponsePair', originalPair);
  else Reflect.deleteProperty(globalThis, 'WebSocketRequestResponsePair');
});

// biome-ignore lint/suspicious/noExplicitAny: the fakes implement only the slice of the DO runtime the room touches.
const loose = (value: unknown): any => value;

function fakeSocket(attachment: unknown) {
  let stored = attachment;
  const sent: unknown[] = [];
  return {
    sent,
    readyState: 1,
    send: (msg: string) => sent.push(JSON.parse(msg)),
    close() {},
    serializeAttachment: (value: unknown) => {
      stored = value;
    },
    deserializeAttachment: () => stored,
  };
}

function makeRoom({ db, sockets = [] }: { db: ReturnType<typeof fakeDb>; sockets?: ReturnType<typeof fakeSocket>[] }) {
  const alarms: number[] = [];
  const ctx = {
    setWebSocketAutoResponse() {},
    getWebSockets: () => sockets,
    getTags: () => [ID],
    waitUntil() {},
    storage: {
      setAlarm: async (at: number) => {
        alarms.push(at);
      },
    },
  };
  return { room: new AnnotationRoom(loose(ctx), loose({ DB: asDb(db) })), alarms };
}

/** A D1 whose annotation writes reject until `heal()` is called. */
function flakyDb() {
  const db = fakeDb({ first: editableRow });
  const isWrite = (sql: string) => /INSERT INTO annotations|UPDATE annotations SET ops/.test(sql);
  let failing = true;
  const prepare = db.prepare;
  db.prepare = (sql: string) => {
    const stmt = prepare(sql);
    if (failing && isWrite(sql)) {
      stmt.run = async () => {
        throw new Error('D1_ERROR: network connection lost');
      };
    }
    return stmt;
  };
  const writes = () => db.calls.filter((c) => isWrite(c.sql));
  return {
    db,
    writes,
    heal: () => {
      failing = false;
    },
  };
}

describe('AnnotationRoom flush', () => {
  test('an op whose flush failed is written by the next flush', async () => {
    const { db, writes, heal } = flakyDb();
    const { room } = makeRoom({ db });
    expect(await room.agentPushOp(ID, op)).toBe(true);

    await room.alarm().catch(() => {});
    heal();
    const before = writes().length;
    await room.alarm();

    const retried = writes().slice(before);
    expect(retried.length).toBeGreaterThan(0);
    expect(retried.some((c) => c.bindings.some((b) => typeof b === 'string' && b.includes(op.id)))).toBe(true);
  });

  test('the last peer leaving during an outage closes cleanly and leaves the op for a later flush', async () => {
    const { db, writes, heal } = flakyDb();
    const peer = fakeSocket({ id: 'p1', name: 'A', color: '#8b5cf6' });
    const { room } = makeRoom({ db, sockets: [peer] });
    expect(await room.agentPushOp(ID, op)).toBe(true);

    await expect(room.webSocketClose(loose(peer))).resolves.toBeUndefined();
    heal();
    const before = writes().length;
    await room.alarm();

    const retried = writes().slice(before);
    expect(retried.some((c) => c.bindings.some((b) => typeof b === 'string' && b.includes(op.id)))).toBe(true);
  });
});

describe('AnnotationRoom view-only enforcement', () => {
  test('a read-only peer is refused every mutation and nothing reaches the room', async () => {
    const db = fakeDb({ first: editableRow });
    const viewer = fakeSocket({ id: 'viewer', name: 'V', color: '#8b5cf6', canEdit: false });
    const other = fakeSocket({ id: 'editor', name: 'E', color: '#8b5cf6', canEdit: true });
    const { room, alarms } = makeRoom({ db, sockets: [viewer, other] });

    for (const msg of [{ type: 'clear' }, { type: 'undo', opId: op.id }, { type: 'op', op }]) {
      viewer.sent.length = 0;
      await room.webSocketMessage(loose(viewer), JSON.stringify(msg));
      expect(viewer.sent).toEqual([{ type: 'error', code: 'read_only' }]);
    }
    expect(other.sent).toEqual([]);
    expect(alarms).toEqual([]);
    expect(db.calls.filter((c) => /INSERT|UPDATE annotations SET ops/.test(c.sql))).toEqual([]);
  });

  test('flipping a warm room to view-only reaches open sockets and HTTP agents', async () => {
    const viewRow = { access: 'view', owner_id: 'u1', owner_expires_at: null };
    // Order: the refresh's access read, then the agent's first load (still 'edit'), then its own access read.
    const db = fakeDb({ firstQueue: [viewRow, editableRow], first: viewRow });
    const peer = fakeSocket({ id: 'p1', name: 'A', color: '#8b5cf6', canEdit: true, userId: 'u2' });
    const { room, alarms } = makeRoom({ db, sockets: [peer] });

    const res = await room.fetch(new Request(`https://room/refresh-access?id=${ID}`, { method: 'POST' }));
    expect(res.status).toBe(204);
    expect(peer.sent).toEqual([{ type: 'access', canEdit: false }]);

    expect(await room.agentPushOp(ID, op)).toBe(false);
    expect(peer.sent).toEqual([{ type: 'access', canEdit: false }]);
    expect(alarms).toEqual([]);
  });
});
