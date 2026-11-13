import type { Database } from 'bun:sqlite';
import { afterAll, beforeAll, describe, expect, mock, setSystemTime, test } from 'bun:test';
import type { DrawOp } from '@marklayer/types/ops';
import { ROOM_EXPIRED_CLOSE_CODE, ROOM_GEN_HEADER, ROOM_LOCKED_CLOSE_CODE } from '@marklayer/types/wire';
import { z } from 'zod/mini';
import { api } from './api';
import { hashToken } from './auth/tokens';
import { collaborationStore } from './collaboration-store';
import { rooms } from './rooms';
import { saveRoom } from './rooms-lifecycle';
import { annotationStore, nowInSeconds } from './store';
import { fakeDb, insertRow, migratedSqlite, SqliteD1 } from './test-d1';
import { FakeDurableObjectState, FakeExecutionContext, FakeWebSocket, fakeEnv } from './test-env';

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
const { AnnotationRoom, SOCKET_BURST, SOCKET_RATE_LIMITED_CLOSE_CODE } = await import('./annotation-room');

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

function makeRoom({ db, sockets = [] }: { db: ReturnType<typeof fakeDb>; sockets?: FakeWebSocket[] }) {
  const ctx = new FakeDurableObjectState({ sockets, tags: [ID], name: ID });
  return { room: new AnnotationRoom(ctx, fakeEnv({ DB: db })), alarms: ctx.alarms };
}

/** A D1 whose annotation writes reject until `heal()` is called. */
function flakyDb() {
  const db = fakeDb({ first: editableRow });
  const isWrite = (sql: string) => /INSERT INTO annotations|UPDATE annotations SET ops/.test(sql);
  let failing = true;
  const { prepare } = db;
  db.prepare = (sql) => {
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
    expect(await room.send({ type: 'op', op })).toBe(true);

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
    const peer = new FakeWebSocket({ id: 'p1', name: 'A', color: '#8b5cf6' });
    const { room } = makeRoom({ db, sockets: [peer] });
    expect(await room.send({ type: 'op', op })).toBe(true);

    await expect(room.webSocketClose(peer)).resolves.toBeUndefined();
    heal();
    const before = writes().length;
    await room.alarm();

    const retried = writes().slice(before);
    expect(retried.some((c) => c.bindings.some((b) => typeof b === 'string' && b.includes(op.id)))).toBe(true);
  });
});

describe('AnnotationRoom view-only enforcement', () => {
  test('a read-only participant can send teaching controls to peers and watching agents without a write', async () => {
    const db = fakeDb({ first: editableRow });
    const viewer = new FakeWebSocket({ id: 'viewer', name: 'V', color: '#8b5cf6', canEdit: false });
    const other = new FakeWebSocket({ id: 'editor', name: 'E', color: '#000', canEdit: true });
    const { room, alarms } = makeRoom({ db, sockets: [viewer, other] });
    const { cursor } = await room.snapshot();
    const waiting = room.watch({ timeoutMs: 1000, since: cursor, peerId: 'agent' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await room.webSocketMessage(
      viewer,
      JSON.stringify({ type: 'teach_control', presentationId: 'p1', action: 'next' }),
    );
    const event = {
      type: 'teach_control',
      presentationId: 'p1',
      action: 'next',
      peerId: 'viewer',
      color: '#8b5cf6',
    } as const;
    expect(other.sent).toContainEqual(event);
    expect((await waiting).messages).toContainEqual(event);
    expect(alarms).toEqual([]);
    expect(db.calls.filter((c) => /INSERT|UPDATE annotations SET ops/.test(c.sql))).toEqual([]);
  });

  test('an HTTP agent can broadcast a transient teaching caption with its own peer identity', async () => {
    const db = fakeDb({ first: editableRow });
    const viewer = new FakeWebSocket({ id: 'viewer', name: 'V', color: '#8b5cf6', canEdit: false });
    const { room, alarms } = makeRoom({ db, sockets: [viewer] });
    expect(await room.send({ type: 'teach_caption', presentationId: 'p1', text: '下一步' }, 'agent-1')).toBe(true);
    expect(viewer.sent).toContainEqual({
      type: 'teach_caption',
      presentationId: 'p1',
      text: '下一步',
      peerId: 'agent-1',
    });
    expect(alarms).toEqual([]);
  });

  test('a read-only peer is refused every mutation and nothing reaches the room', async () => {
    const db = fakeDb({ first: editableRow });
    const viewer = new FakeWebSocket({ id: 'viewer', name: 'V', color: '#8b5cf6', canEdit: false });
    const other = new FakeWebSocket({ id: 'editor', name: 'E', color: '#8b5cf6', canEdit: true });
    const { room, alarms } = makeRoom({ db, sockets: [viewer, other] });

    for (const msg of [{ type: 'clear' }, { type: 'undo', opId: op.id }, { type: 'op', op }]) {
      viewer.sent.length = 0;
      await room.webSocketMessage(viewer, JSON.stringify(msg));
      expect(viewer.sent).toContainEqual({ type: 'error', code: 'read_only' });
      expect(
        viewer.sent.some(
          (receipt) => typeof receipt === 'object' && receipt !== null && 'type' in receipt && receipt.type === 'nack',
        ),
      ).toBe(true);
    }
    expect(other.sent).toEqual([]);
    expect(alarms).toEqual([]);
    expect(db.calls.filter((c) => /INSERT|UPDATE annotations SET ops/.test(c.sql))).toEqual([]);
  });

  test('flipping a warm room to view-only reaches open sockets and HTTP agents', async () => {
    const viewRow = { access: 'view', owner_id: 'u1', owner_expires_at: null };
    // Order: the refresh loads the room (one full row), then re-reads access; every later read sees 'view'.
    const db = fakeDb({ firstQueue: [{ ...editableRow, ...viewRow }], first: viewRow });
    const peer = new FakeWebSocket({ id: 'p1', name: 'A', color: '#8b5cf6', canEdit: true, userId: 'u2' });
    const { room, alarms } = makeRoom({ db, sockets: [peer] });

    await room.refreshAccess();
    expect(peer.sent).toEqual([{ type: 'access', canEdit: false }]);

    expect(await room.send({ type: 'op', op })).toBe(false);
    expect(peer.sent).toEqual([{ type: 'access', canEdit: false }]);
    expect(alarms).toEqual([]);
  });
});

describe('AnnotationRoom password revoke', () => {
  test('a password change closes every session but the owner, and refuses a socket admitted before it', async () => {
    const db = fakeDb({ first: { access: 'edit', owner_id: 'owner', owner_expires_at: null } });
    const guest = new FakeWebSocket({ id: 'g', name: 'G', color: '#8b5cf6', userId: 'someone-else' });
    const anon = new FakeWebSocket({ id: 'a', name: 'A', color: '#8b5cf6' });
    const owner = new FakeWebSocket({ id: 'o', name: 'O', color: '#8b5cf6', userId: 'owner' });
    const { room } = makeRoom({ db, sockets: [guest, anon, owner] });
    await room.refreshAccess();

    const parked = room.watch({ timeoutMs: 60_000, since: 0, peerId: 'p' });
    // Let the watch finish loading the room and park before the change lands.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await room.revoke(2);
    expect(guest.closes).toEqual([ROOM_LOCKED_CLOSE_CODE]);
    expect(anon.closes).toEqual([ROOM_LOCKED_CLOSE_CODE]);
    expect(owner.closes).toEqual([]);
    // A watching agent wakes empty-handed rather than receiving what lands after the change.
    expect((await parked).messages).toEqual([]);

    // Admitted by the Worker at generation 1, just before the change reached the room. The
    // ctx has no `acceptWebSocket`, so letting it in would throw rather than return.
    const hadPairClass = Reflect.get(globalThis, 'WebSocketPair');
    Reflect.set(globalThis, 'WebSocketPair', fakePairClass());
    try {
      const late = await room.fetch(new Request(`https://room/?id=${ID}`, { headers: { [ROOM_GEN_HEADER]: '1' } }));
      expect(late.status).toBe(101);
    } finally {
      Reflect.set(globalThis, 'WebSocketPair', hadPairClass);
    }
  });
});

describe('AnnotationRoom per-socket message cap', () => {
  function pair() {
    const sender = new FakeWebSocket({ id: 's', name: 'S', color: '#8b5cf6' });
    const peer = new FakeWebSocket({ id: 'p', name: 'P', color: '#8b5cf6' });
    const { room } = makeRoom({ db: fakeDb({ first: editableRow }), sockets: [sender, peer] });
    const send = () => room.webSocketMessage(sender, JSON.stringify({ type: 'cursor', x: 1, y: 2 }));
    return { codes: sender.closes, peer, send };
  }

  test('a reconnect flush followed by a long drag at display rate is never cut off', async () => {
    const { codes, peer, send } = pair();
    let now = 1_000_000;
    setSystemTime(new Date(now));
    try {
      for (let i = 0; i < 800; i++) await send();
      // 20 s at 150 messages a second: a 120 Hz guide drag plus 20 Hz cursors and change.
      for (let i = 0; i < 3000; i++) {
        now += 1000 / 150;
        setSystemTime(new Date(now));
        await send();
      }
    } finally {
      setSystemTime();
    }
    expect(codes).toEqual([]);
    expect(peer.sent).toHaveLength(3800);
  });

  test('a flood closes the socket and stops reaching peers', async () => {
    const { codes, peer, send } = pair();
    setSystemTime(new Date(1_000_000));
    try {
      for (let i = 0; i < SOCKET_BURST * 3; i++) await send();
    } finally {
      setSystemTime();
    }
    expect(codes[0]).toBe(SOCKET_RATE_LIMITED_CLOSE_CODE);
    expect(peer.sent).toHaveLength(SOCKET_BURST);
  });
});

function fakePairClass() {
  const end = () => ({ accept() {}, close() {} });
  return class {
    0 = end();
    1 = end();
  };
}

/** A room over real SQL with one person connected: a deleted row and an unknown assignee only mean anything to a real schema. */
function liveRoom({ ops = [], kv }: { ops?: DrawOp[]; kv?: Map<string, unknown> } = {}) {
  const sqlite = migratedSqlite();
  sqlite.query('INSERT INTO annotations (id, ops) VALUES (?, ?)').run(ID, JSON.stringify(ops));
  const db = new SqliteD1(sqlite);
  const human = new FakeWebSocket({ id: 'p1', name: 'Ana', color: '#8b5cf6' });
  const ctx = new FakeDurableObjectState({ sockets: [human], tags: [ID], name: ID, kv });
  return { sqlite, db, human, ctx, room: new AnnotationRoom(ctx, fakeEnv({ DB: db })) };
}

type Room = InstanceType<typeof AnnotationRoom>;

const opsColumn = (sqlite: Database) =>
  sqlite.query<{ ops: string }, [string]>('SELECT ops FROM annotations WHERE id = ?').get(ID)?.ops;

describe('one mutation core', () => {
  // The property the refactor exists for: however a save arrives, the row and what peers see are the same bytes.
  test('a socket, an RPC and a REST save produce byte-identical rows and broadcasts', async () => {
    const viaSocket = liveRoom();
    const sender = new FakeWebSocket({ id: 'p2', name: 'Bo', color: '#8b5cf6' });
    viaSocket.ctx.getWebSockets().push(sender);
    await viaSocket.room.webSocketMessage(sender, JSON.stringify({ type: 'op', op }));
    await viaSocket.room.alarm();

    const viaRpc = liveRoom();
    expect(await viaRpc.room.send({ type: 'op', op })).toBe(true);
    await viaRpc.room.alarm();

    const viaRest = liveRoom();
    const env = {
      DB: viaRest.db,
      ANNOTATION_ROOM: { idFromName: () => viaRest.ctx.id, get: () => viaRest.room },
    };
    const save = {
      env,
      id: ID,
      exists: true,
      userId: undefined,
      mode: 'replace' as const,
      url: null,
      width: null,
      expiresIn: undefined,
    };
    expect(await saveRoom({ ...save, ops: [op] })).toBe('saved');
    await viaRest.room.alarm();

    const rows = [viaSocket, viaRpc, viaRest].map((r) => opsColumn(r.sqlite));
    expect(JSON.parse(rows[0] ?? 'null')).toEqual([op]);
    expect(new Set(rows).size).toBe(1);
    const seen = [viaSocket, viaRpc, viaRest].map((r) => JSON.stringify(r.human.sent));
    expect(viaSocket.human.sent).toEqual([{ type: 'op', op }]);
    expect(new Set(seen).size).toBe(1);
  });

  test('a REST replace tells peers exactly what changed, as the messages they already understand', async () => {
    const other: DrawOp = { ...op, id: 'op-2' };
    const { room, human, ctx, db } = liveRoom({ ops: [op, other] });
    const env = { DB: db, ANNOTATION_ROOM: { idFromName: () => ctx.id, get: () => room } };
    const changed: DrawOp = { ...other, endX: 99 };
    const save = {
      env,
      id: ID,
      exists: true,
      userId: undefined,
      mode: 'replace' as const,
      url: null,
      width: null,
      expiresIn: undefined,
    };
    await saveRoom({ ...save, ops: [changed] });
    expect(human.sent).toEqual([
      { type: 'undo', opId: op.id },
      { type: 'undo', opId: other.id },
      { type: 'op', op: changed },
    ]);
  });

  test('a message from an older client is applied: unknown fields and a missing optional are tolerated', async () => {
    const { room, human, sqlite } = liveRoom();
    const sender = new FakeWebSocket({ id: 'p2', name: 'Bo', color: '#8b5cf6' });
    await room.webSocketMessage(sender, JSON.stringify({ type: 'op', op, clientVersion: '0.1.0', legacy: true }));
    expect(sender.sent[0]).toMatchObject({ type: 'ack', status: 'applied', seq: expect.any(Number) });
    expect((sender.sent[0] as { opId: string }).opId).toBeTruthy();
    await room.webSocketMessage(sender, JSON.stringify({ type: 'cursor', x: 1, y: 2 }));
    await room.webSocketMessage(sender, JSON.stringify({ type: 'not_a_thing', op }));
    await room.alarm();
    expect(human.sent.map((m) => (typeof m === 'object' && m !== null && 'type' in m ? m.type : null))).toEqual([
      'op',
      'cursor',
    ]);
    expect(JSON.parse(opsColumn(sqlite) ?? 'null')).toEqual([op]);
  });

  test('socket mutations return correlated applied, noop and refused receipts without broadcasting a refusal', async () => {
    const { room, human } = liveRoom();
    const sender = new FakeWebSocket({ id: 'sender', name: 'Bo', color: '#8b5cf6' });
    const readonly = new FakeWebSocket({ id: 'readonly', name: 'View', color: '#000000', canEdit: false });

    await room.webSocketMessage(sender, JSON.stringify({ type: 'op', op, clientOpId: 'client-1', seq: 1 }));
    expect(sender.sent).toContainEqual({ type: 'ack', opId: 'client-1', status: 'applied', seq: 1, rev: 1 });
    expect(human.sent).toContainEqual({ type: 'op', op });

    sender.sent.length = 0;
    await room.webSocketMessage(sender, JSON.stringify({ type: 'op', op, clientOpId: 'client-2', seq: 2 }));
    expect(sender.sent).toContainEqual({ type: 'ack', opId: 'client-2', status: 'noop', seq: 2, rev: 1 });

    human.sent.length = 0;
    await room.webSocketMessage(
      readonly,
      JSON.stringify({ type: 'op', op: { ...op, id: 'refused' }, clientOpId: 'client-3' }),
    );
    expect(readonly.sent).toContainEqual({
      type: 'nack',
      opId: 'client-3',
      status: 'refused',
      seq: 3,
      code: 'read_only',
      reason: '当前房间不允许编辑',
    });
    // The legacy frame a view-only peer always got: back then it said read_only, and it still does.
    expect(readonly.sent).toContainEqual({ type: 'error', code: 'read_only' });
    expect(human.sent).toEqual([]);
    expect((await room.snapshot()).ops.map((item) => item.id)).toEqual([op.id]);
  });
});

describe('the REST save against a live room', () => {
  const post = ({ room, db, body, cookie }: { room: Room; db: D1Database; body: unknown; cookie?: string }) =>
    api.request(
      `/${ID}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
        body: JSON.stringify(body),
      },
      fakeEnv({
        DB: db,
        ANNOTATION_ROOM: {
          idFromName: (name) => new FakeDurableObjectState({ sockets: [], tags: [], name }).id,
          get: () => room,
        },
      }),
      new FakeExecutionContext(),
    );

  function viewOnly() {
    const live = liveRoom();
    insertRow({ sqlite: live.sqlite, table: 'users', row: { id: 'u1', email: 'o@x' } });
    live.sqlite.query("UPDATE annotations SET access = 'view', owner_id = 'u1' WHERE id = ?").run(ID);
    return live;
  }

  test("the owner's save on a view-only link reaches the room", async () => {
    const { sqlite, db, room } = viewOnly();
    const session = { id: await hashToken('tok'), user_id: 'u1', expires_at: nowInSeconds() + 1000 };
    insertRow({ sqlite, table: 'sessions', row: session });
    const res = await post({ room, db, body: { ops: [op] }, cookie: 'ml_session=tok' });
    expect(res.status).toBe(200);
    expect((await room.snapshot()).ops).toEqual([op]);
  });

  test("a stranger's save on a view-only link is 403 and changes nothing, metadata included", async () => {
    const { sqlite, db, room } = viewOnly();
    const res = await post({ room, db, body: { ops: [op], url: 'https://evil.example/', expires_in: 60 } });
    expect(res.status).toBe(403);
    expect((await room.snapshot()).ops).toEqual([]);
    expect(sqlite.query('SELECT url, expires_at FROM annotations').get()).toEqual({ url: null, expires_at: null });
  });

  // Installed extensions before the room became sole writer POST their whole local list after every offline op.
  test("a stale client's bare-array autosave never erases or reverts a peer's work", async () => {
    const { sqlite, db, room, human } = liveRoom({ ops: [op] });
    const peer = new FakeWebSocket({ id: 'p2', name: 'Bo', color: '#8b5cf6' });
    const theirs: DrawOp = { ...op, id: 'op-peer' };
    const mine: DrawOp = { ...op, id: 'op-stale-client' };
    await room.webSocketMessage(peer, JSON.stringify({ type: 'op', op: theirs }));
    await room.webSocketMessage(peer, JSON.stringify({ type: 'update_op', opId: op.id, patch: { endX: 50 } }));
    human.sent.length = 0;

    const res = await post({ room, db, body: [op, mine] });
    expect(res.status).toBe(200);
    await room.alarm();

    const kept = [{ ...op, endX: 50 }, theirs, mine];
    expect((await room.snapshot()).ops).toEqual(kept);
    expect(JSON.parse(opsColumn(sqlite) ?? 'null')).toEqual(kept);
    expect(human.sent).toEqual([{ type: 'op', op: mine }]);
  });

  test('the explicit publish still replaces the room wholesale', async () => {
    const { db, room } = liveRoom({ ops: [op] });
    const res = await post({ room, db, body: { ops: [] } });
    expect(res.status).toBe(200);
    expect((await room.snapshot()).ops).toEqual([]);
  });

  test('an expiry saved on a warm room is the one it reports', async () => {
    const { db, room } = liveRoom();
    await room.snapshot();
    const res = await post({ room, db, body: { ops: [], expires_in: 3600, url: 'https://a.example/' } });
    expect(res.status).toBe(200);
    const { expiresAt, url } = await room.snapshot();
    expect(expiresAt).toBeGreaterThan(nowInSeconds());
    expect(url).toBe('https://a.example/');
  });

  test('a room first saved while warm learns its row', async () => {
    const { sqlite, db } = liveRoom();
    sqlite.query('DELETE FROM annotations').run();
    const empty = new AnnotationRoom(
      new FakeDurableObjectState({ sockets: [], tags: [ID], name: ID }),
      fakeEnv({ DB: db }),
    );
    await empty.snapshot();
    const res = await post({ room: empty, db, body: { ops: [], expires_in: 3600 } });
    expect(res.status).toBe(200);
    const { createdAt, expiresAt } = await empty.snapshot();
    expect(createdAt).not.toBeNull();
    expect(expiresAt).not.toBeNull();
  });
});

describe('a deadline passing with a socket inside', () => {
  const DEADLINE = 2_000_000_000;
  const expiring = () => {
    const live = liveRoom();
    live.sqlite.query('UPDATE annotations SET expires_at = ?').run(DEADLINE);
    return live;
  };
  afterAll(() => setSystemTime());
  const at = (seconds: number) => setSystemTime(new Date(seconds * 1000));

  test('a write after it is refused and the socket closed', async () => {
    at(DEADLINE - 10);
    const { room, human } = expiring();
    await room.snapshot();
    at(DEADLINE + 10);
    await room.webSocketMessage(human, JSON.stringify({ type: 'op', op }));
    expect(human.closes).toEqual([ROOM_EXPIRED_CLOSE_CODE]);
    expect(await room.send({ type: 'op', op })).toBe(false);
  });

  test('an owner extending it keeps the socket', async () => {
    at(DEADLINE - 10);
    const { room, human, sqlite } = expiring();
    await room.snapshot();
    sqlite.query('UPDATE annotations SET expires_at = ?').run(DEADLINE + 1000);
    at(DEADLINE + 10);
    await room.webSocketMessage(human, JSON.stringify({ type: 'op', op }));
    expect(human.closes).toEqual([]);
    expect((await room.snapshot()).ops).toEqual([op]);
  });

  test('the alarm closes a socket that never writes, even in a room evicted since', async () => {
    at(DEADLINE - 10);
    const { room, ctx, db, human } = expiring();
    await room.snapshot();
    expect(ctx.alarms).toContain((DEADLINE + 1) * 1000);
    at(DEADLINE + 1);
    await new AnnotationRoom(ctx, fakeEnv({ DB: db })).alarm();
    expect(human.closes).toEqual([ROOM_EXPIRED_CLOSE_CODE]);
  });

  test('a flush alarm before it re-arms the deadline it replaced', async () => {
    at(DEADLINE - 10);
    const { room, ctx } = expiring();
    await room.send({ type: 'op', op });
    ctx.alarms.length = 0; // It fired: nothing is pending while the handler runs.
    await room.alarm();
    expect(ctx.alarms).toEqual([(DEADLINE + 1) * 1000]);
  });
});

describe('a room with both the Slack app and a Slack webhook', () => {
  const realFetch = globalThis.fetch;
  const reply: DrawOp = {
    id: 'slack-C1-111_1',
    tool: 'comment',
    num: 1,
    text: 'from Slack',
    x: 1,
    y: 2,
    color: '#000000',
    lineWidth: 2,
    ts: 1,
  };
  const comment: DrawOp = { ...reply, id: 'c1', text: 'from the room' };
  const KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
  const webhooks: string[] = [];
  beforeAll(() => {
    globalThis.fetch = Object.assign(
      async (input: string | URL | Request) => {
        webhooks.push(String(input));
        return new Response('ok');
      },
      { preconnect: realFetch.preconnect },
    );
  });
  afterAll(() => {
    globalThis.fetch = realFetch;
  });

  /** The sealed token is junk, so every post to the app fails and the room's breaker can be walked open. */
  function slackRoom() {
    webhooks.length = 0;
    const { sqlite, db, ctx } = liveRoom();
    const integrations = [{ provider: 'slack', config: { url: 'https://hooks.slack.com/services/T/B/x' } }];
    sqlite.query('UPDATE annotations SET integrations = ?').run(JSON.stringify(integrations));
    const install = { room_id: ID, team_id: 'T', channel_id: 'C', bot_user_id: 'U', bot_token: btoa('junk') };
    insertRow({ sqlite, table: 'slack_installs', row: install });
    const env = { SLACK_CLIENT_ID: 'i', SLACK_CLIENT_SECRET: 's', SLACK_SIGNING_SECRET: 'g', SLACK_TOKEN_KEY: KEY };
    return new AnnotationRoom(ctx, fakeEnv({ DB: db, ...env }));
  }

  test('a batch of only Slack-born ops does not go back to Slack by webhook', async () => {
    const room = slackRoom();
    await room.send({ type: 'op', op: reply });
    await room.alarm();
    expect(webhooks).toEqual([]);
  });

  test('an open Slack breaker does not bring the webhook back: one post per channel', async () => {
    const room = slackRoom();
    for (let i = 0; i < 4; i++) {
      await room.send({ type: 'op', op: { ...comment, id: `c${i}` } });
      await room.alarm();
    }
    expect(webhooks).toEqual([]);
  });
});

describe('the message log behind a watch', () => {
  const comment: DrawOp = {
    id: 'c-log',
    tool: 'comment',
    num: 1,
    text: 'hi',
    x: 1,
    y: 2,
    color: '#000000',
    lineWidth: 2,
    ts: 1,
  };

  test('what lands between a snapshot and its watch is delivered, patches included', async () => {
    const { room, human } = liveRoom({ ops: [comment] });
    const { cursor } = await room.snapshot();
    await room.webSocketMessage(
      human,
      JSON.stringify({ type: 'update_op', opId: comment.id, patch: { assignee: 'claude-code' } }),
    );
    const result = await room.watch({ timeoutMs: 1000, since: cursor, peerId: 'p' });
    expect(result.messages).toEqual([{ type: 'update_op', opId: comment.id, patch: { assignee: 'claude-code' } }]);
    expect(result.cursor).toBe(cursor + 1);
    // Caught up: the next watch parks until the timeout rather than answering at once.
    const started = Date.now();
    expect((await room.watch({ timeoutMs: 50, since: result.cursor, peerId: 'p' })).messages).toEqual([]);
    expect(Date.now() - started).toBeGreaterThanOrEqual(45);
  });

  test('a parked watch wakes on an op from any source', async () => {
    const { room } = liveRoom();
    const { cursor } = await room.snapshot();
    const parked = room.watch({ timeoutMs: 5000, since: cursor, peerId: 'p' });
    await Bun.sleep(10);
    await room.send({ type: 'op', op });
    expect((await parked).messages).toEqual([{ type: 'op', op }]);
  });
});

describe('what survives eviction', () => {
  test('a re-created room knows its name from storage even when the runtime does not say it', async () => {
    const kv = new Map<string, unknown>();
    const first = liveRoom({ ops: [op], kv });
    await first.room.snapshot();

    const nameless = new FakeDurableObjectState({ sockets: [], tags: [], kv });
    const again = new AnnotationRoom(nameless, fakeEnv({ DB: first.db }));
    expect((await again.snapshot()).ops).toEqual([op]);
  });

  test('W9 a room whose row was deleted while it hibernated closes its sockets and writes nothing back', async () => {
    const kv = new Map<string, unknown>();
    const first = liveRoom({ kv });
    await first.room.webSocketMessage(first.human, JSON.stringify({ type: 'op', op }));
    await first.room.alarm();
    expect(kv.get('rowExisted')).toBe(true);
    await annotationStore(first.db).remove(ID);

    const woken = new FakeWebSocket({ id: 'p1', name: 'Ana', color: '#8b5cf6' });
    const state = new FakeDurableObjectState({ sockets: [woken], tags: [ID], name: ID, kv });
    const again = new AnnotationRoom(state, fakeEnv({ DB: first.db }));
    await again.webSocketMessage(woken, JSON.stringify({ type: 'op', op: { ...op, id: 'late' } }));
    await again.alarm();
    expect(woken.closes).toEqual([ROOM_EXPIRED_CLOSE_CODE]);
    expect(first.sqlite.query('SELECT count(*) AS n FROM annotations').get()).toEqual({ n: 0 });
  });
});

describe('AnnotationRoom flush after the row is gone', () => {
  test('W9 a warm room does not recreate a row deleted behind it', async () => {
    const { sqlite, db, human, room } = liveRoom();
    await room.webSocketMessage(human, JSON.stringify({ type: 'op', op }));
    await annotationStore(db).remove(ID);

    await room.alarm();

    const rows = sqlite.query<{ n: number }, [string]>('SELECT count(*) AS n FROM annotations WHERE id = ?').get(ID);
    expect(rows?.n).toBe(0);
  });

  test('a warm room that rereads its row and finds none is gone, not reset to an open link', async () => {
    const { db, human, room } = liveRoom({ ops: [op] });
    await room.snapshot();
    await annotationStore(db).remove(ID);

    expect(await room.send({ type: 'op', op: { ...op, id: 'late' } })).toBe(false);
    expect(human.closes).toEqual([ROOM_EXPIRED_CLOSE_CODE]);
  });
});

describe('remote MCP endpoint against a live room', () => {
  const AGENT = 'claude-code';
  const comment: DrawOp = {
    id: 'c1',
    tool: 'comment',
    num: 1,
    text: 'the label is vague',
    x: 1,
    y: 2,
    color: '#000000',
    lineWidth: 2,
    ts: 1_700_000_000_000,
  };
  const landed: DrawOp = { ...comment, id: 'c2', num: 2 };

  const toolResult = z.object({ result: z.object({ content: z.array(z.object({ text: z.string() })) }) });
  const watchBody = z.object({
    events: z.array(z.object({ kind: z.string(), annotation: z.object({ id: z.string() }) })),
  });
  const peerJoin = z.object({
    type: z.literal('peer_join'),
    peer: z.object({ name: z.string(), uid: z.optional(z.string()) }),
  });

  function callTool({
    room,
    db,
    agent,
    name,
    args,
  }: {
    room: InstanceType<typeof AnnotationRoom>;
    db: D1Database;
    agent: string;
    name: string;
    args: Record<string, unknown>;
  }) {
    return rooms.fetch(
      new Request(`https://marklayer.app/s/${ID}/mcp?agent=${agent}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
      }),
      { DB: db, ANNOTATION_ROOM: { idFromName: () => 'do', get: () => room } },
      new FakeExecutionContext(),
    );
  }

  /** What one bounded watch reported. The answer is a single server-sent `data:` line wrapping the tool's JSON. */
  async function watchEvents({ room, db }: Pick<Parameters<typeof callTool>[0], 'room' | 'db'>) {
    const res = await callTool({
      room,
      db,
      agent: AGENT,
      name: 'marklayer_watch_annotations',
      args: { timeoutSeconds: 1 },
    });
    const frame = (await res.text()).split('\n').find((line) => line.startsWith('data: {'));
    const text = toolResult.parse(JSON.parse(frame?.slice('data: '.length) ?? 'null')).result.content[0]?.text;
    return watchBody.parse(JSON.parse(text ?? 'null')).events.map((e) => `${e.kind}:${e.annotation.id}`);
  }

  /** Runs `land` at the instant the watch reaches the room: past the snapshot, not yet parked. */
  function landBeforeWatch({
    room,
    land,
  }: {
    room: InstanceType<typeof AnnotationRoom>;
    land: () => Promise<unknown>;
  }) {
    const watch = room.watch.bind(room);
    room.watch = async (req) => {
      await land();
      return watch(req);
    };
  }

  const assign = (id: string) => JSON.stringify({ type: 'update_op', opId: id, patch: { assignee: AGENT } });

  test('an MCP client can take an explicitly queued task', async () => {
    const live = liveRoom({ ops: [comment] });
    const person = new FakeWebSocket({ id: 'task-person', uid: 'requester', name: 'Requester', color: '#000000' });
    live.ctx.getWebSockets().push(person);
    await (
      await callTool({ room: live.room, db: live.db, agent: AGENT, name: 'marklayer_task', args: { action: 'list' } })
    ).text();
    await live.room.webSocketMessage(
      person,
      JSON.stringify({
        type: 'task_submit',
        taskId: 'task-from-mcp',
        agentId: AGENT,
        annotationId: comment.id,
        sourceId: comment.id,
        layerId: 'default',
      }),
    );
    const response = await callTool({
      room: live.room,
      db: live.db,
      agent: AGENT,
      name: 'marklayer_task',
      args: { action: 'take' },
    });
    expect(await response.text()).toContain('running');
  });

  test('a remote MCP watch wakes for a plain reply to its waiting task', async () => {
    const { db, human, room } = liveRoom({ ops: [comment] });
    const store = collaborationStore(db);
    await store.enqueue({
      id: 'waiting-task',
      room_id: ID,
      agent_id: AGENT,
      requester_id: 'u1',
      requester_name: 'Ada',
      layer_id: 'default',
      annotation_id: 'c1',
      source_id: 'c1',
    });
    expect(await store.takeNext(ID, AGENT)).not.toBeNull();
    expect(await store.waitFor(ID, AGENT, 'waiting-task', 'Ada')).toBe(true);
    const watching = watchEvents({ room, db });
    await Bun.sleep(100);
    await room.webSocketMessage(
      human,
      JSON.stringify({ type: 'op', op: { ...comment, id: 'answer', parentId: 'c1', text: '确认继续', author: 'Ada' } }),
    );
    expect(await watching).toEqual(['handoff:c1']);
  });

  test('P4 a parked watch returns a handoff when a person assigns the agent', async () => {
    const { db, human, room } = liveRoom({ ops: [comment] });
    const watching = watchEvents({ room, db });
    await Bun.sleep(100);
    await room.webSocketMessage(human, assign(comment.id));
    expect(await watching).toEqual([`handoff:${comment.id}`]);
  });

  async function list({ room, db }: { room: Room; db: D1Database }) {
    const res = await callTool({ room, db, agent: AGENT, name: 'marklayer_list_annotations', args: {} });
    return res.text();
  }

  test('an annotation landing between two tool calls reaches the next watch, once', async () => {
    const { db, human, room } = liveRoom({ ops: [comment] });
    await list({ room, db });
    await room.webSocketMessage(human, JSON.stringify({ type: 'op', op: landed }));
    expect(await watchEvents({ room, db })).toEqual([`new:${landed.id}`]);
    expect(await watchEvents({ room, db })).toEqual([]);
  });

  test('a handoff between two tool calls reaches the next watch', async () => {
    const { db, human, room } = liveRoom({ ops: [comment] });
    await list({ room, db });
    await room.webSocketMessage(human, assign(comment.id));
    expect(await watchEvents({ room, db })).toEqual([`handoff:${comment.id}`]);
  });

  test('a read between the work and the watch does not use it up', async () => {
    const { db, human, room } = liveRoom({ ops: [comment] });
    await list({ room, db });
    await room.webSocketMessage(human, JSON.stringify({ type: 'op', op: landed }));
    expect(await list({ room, db })).toContain(landed.id);
    expect(await watchEvents({ room, db })).toEqual([`new:${landed.id}`]);
  });

  test("the agent's own write between two calls is not new work", async () => {
    const { db, room } = liveRoom({ ops: [comment] });
    const args = { text: 'mine', x: 1, y: 2 };
    await (await callTool({ room, db, agent: AGENT, name: 'marklayer_create_annotation', args })).text();
    expect((await room.snapshot()).ops).toHaveLength(2);
    expect(await watchEvents({ room, db })).toEqual([]);
  });

  test('a person can @mention an agent that has only just joined', async () => {
    const { db, human, room } = liveRoom({ ops: [comment] });
    await list({ room, db });
    expect(peerJoin.parse(human.sent[0]).peer.uid).toBe(AGENT);
  });

  test('P99 an assignment landing between snapshot and watch is still a handoff', async () => {
    const { db, human, room } = liveRoom({ ops: [comment] });
    landBeforeWatch({ room, land: () => room.webSocketMessage(human, assign(comment.id)) });
    expect(await watchEvents({ room, db })).toEqual([`handoff:${comment.id}`]);
  });

  test('P99 an annotation landing between snapshot and watch is not lost', async () => {
    const { db, human, room } = liveRoom({ ops: [comment] });
    landBeforeWatch({ room, land: () => room.webSocketMessage(human, JSON.stringify({ type: 'op', op: landed })) });
    expect(await watchEvents({ room, db })).toEqual([`new:${landed.id}`]);
  });

  test('W45 an overlong ?agent= is clamped before anyone in the room sees it', async () => {
    const { db, human, room } = liveRoom();
    const res = await callTool({ room, db, agent: 'a'.repeat(200), name: 'marklayer_room_info', args: {} });
    await res.text();
    const names = human.sent.flatMap((msg) => {
      const join = peerJoin.safeParse(msg);
      return join.success ? [join.data.peer.name] : [];
    });
    // peers.ts caps a socket peer's name at 64; the literal holds because MAX_NAME_LEN is not exported.
    expect(names).toEqual(['a'.repeat(64)]);
  });
});

describe('execution mode enforcement', () => {
  test('Guide refuses agent resolution and approval while Pair permits resolution', async () => {
    const comment = {
      id: 'c1',
      tool: 'comment',
      x: 1,
      y: 1,
      num: 1,
      text: 'Question',
      color: '#333333',
      lineWidth: 2,
      ts: 1,
    } as const;
    const live = liveRoom({ ops: [comment] });
    live.sqlite.query("UPDATE annotations SET exec_mode = 'guide' WHERE id = ?").run(ID);
    const agent = 'mcp-codex-session';
    expect(await live.room.send({ type: 'update_op', opId: 'c1', patch: { status: 'resolved' } }, agent)).toBe(false);
    expect(await live.room.send({ type: 'update_op', opId: 'c1', patch: { status: 'approved' } }, agent)).toBe(false);
    expect(await live.room.send({ type: 'update_op', opId: 'c1', patch: { status: 'dismissed' } }, agent)).toBe(false);
    const suggestion = {
      id: 's1',
      tool: 'selection',
      text: 'old',
      suggestion: 'new',
      rects: [],
      color: '#333333',
      lineWidth: 2,
      ts: 1,
    } satisfies DrawOp;
    expect(await live.room.send({ type: 'op', op: suggestion }, agent)).toBe(false);
    const socketAgent = new FakeWebSocket({ id: agent, name: 'Agent', color: '#333333' });
    await live.room.webSocketMessage(
      socketAgent,
      JSON.stringify({ type: 'update_op', opId: 'c1', patch: { status: 'resolved' } }),
    );
    expect(live.human.sent).toEqual([]);
    expect(await live.room.send({ type: 'update_op', opId: 'c1', patch: { status: 'in_progress' } }, agent)).toBe(true);
    live.sqlite.query("UPDATE annotations SET exec_mode = 'pair' WHERE id = ?").run(ID);
    expect(await live.room.send({ type: 'update_op', opId: 'c1', patch: { status: 'resolved' } }, agent)).toBe(true);
    expect(await live.room.send({ type: 'update_op', opId: 'c1', patch: { status: 'approved' } }, agent)).toBe(false);
  });
});

test('human mode changes persist and broadcast, while an agent cannot change the mode', async () => {
  const live = liveRoom();
  expect((await live.room.snapshot()).execMode).toBe('pair');
  await live.room.webSocketMessage(live.human, JSON.stringify({ type: 'set_exec_mode', execMode: 'guide' }));
  expect((await live.room.snapshot()).execMode).toBe('guide');
  expect(live.human.sent).toContainEqual({ type: 'exec_mode', execMode: 'guide' });
  const agent = new FakeWebSocket({ id: 'mcp-codex-session', name: 'Agent', color: '#333333' });
  await live.room.webSocketMessage(agent, JSON.stringify({ type: 'set_exec_mode', execMode: 'solo' }));
  expect((await live.room.snapshot()).execMode).toBe('guide');
});

test('room layers broadcast and an occupied layer cannot be deleted while operations are unflushed', async () => {
  const live = liveRoom();
  const send = (message: unknown) => live.room.webSocketMessage(live.human, JSON.stringify(message));
  await send({ type: 'layer_create', id: 'review', name: '页面问题' });
  expect(live.human.sent).toContainEqual({
    type: 'layers',
    layers: expect.arrayContaining([expect.objectContaining({ id: 'review', name: '页面问题' })]),
  });
  const comment: DrawOp = {
    id: 'layer-comment',
    layerId: 'review',
    tool: 'comment',
    num: 1,
    text: '问题',
    x: 1,
    y: 2,
    color: '#000',
    lineWidth: 2,
    ts: 1,
  };
  await send({ type: 'op', op: comment });
  await send({ type: 'layer_delete', id: 'review' });
  expect(live.human.sent).toContainEqual({ type: 'error', code: 'layer_change_refused' });
  expect(live.sqlite.query("SELECT id FROM room_layers WHERE id = 'review'").get()).toEqual({ id: 'review' });
  const reply = { ...comment, id: 'reply', parentId: 'layer-comment', layerId: 'default' };
  await send({ type: 'op', op: reply });
  await live.room.alarm();
  expect(JSON.parse(opsColumn(live.sqlite) ?? '[]').map((op: { id: string }) => op.id)).toEqual(['layer-comment']);
});

test('moving a root annotation moves its replies and forbids moving a reply separately', async () => {
  const root: DrawOp = {
    id: 'root',
    tool: 'comment',
    num: 1,
    text: '问题',
    x: 1,
    y: 2,
    color: '#000',
    lineWidth: 2,
    ts: 1,
  };
  const reply: DrawOp = { ...root, id: 'reply', parentId: 'root', text: '回复' };
  const live = liveRoom({ ops: [root, reply] });
  const send = (message: unknown) => live.room.webSocketMessage(live.human, JSON.stringify(message));
  await send({ type: 'layer_create', id: 'review', name: '页面问题' });
  await send({ type: 'update_op', opId: 'reply', patch: { layerId: 'review' } });
  await send({ type: 'update_op', opId: 'root', patch: { layerId: 'review' } });
  await live.room.alarm();
  expect(JSON.parse(opsColumn(live.sqlite) ?? '[]')).toEqual([
    expect.objectContaining({ id: 'root', layerId: 'review' }),
    expect.objectContaining({ id: 'reply', layerId: 'review' }),
  ]);
});

test('room members claim an agent and queue an explicit assignment without losing the chosen layer', async () => {
  const root: DrawOp = {
    id: 'root',
    tool: 'comment',
    num: 1,
    text: '问题',
    x: 1,
    y: 2,
    color: '#000',
    lineWidth: 2,
    ts: 1,
  };
  const live = liveRoom({ ops: [root] });
  const person = new FakeWebSocket({ id: 'p2', uid: 'user-1', name: 'Alice', color: '#000000' });
  const agent = new FakeWebSocket({ id: 'mcp-codex-session', uid: 'codex', name: 'Codex', color: '#000000' });
  live.ctx.getWebSockets().push(person, agent);
  const send = (message: unknown) => live.room.webSocketMessage(person, JSON.stringify(message));
  await send({ type: 'layer_create', id: 'review', name: '审查' });
  await send({ type: 'agent_claim', agentId: 'codex' });
  await send({
    type: 'task_submit',
    taskId: 't1',
    agentId: 'codex',
    annotationId: 'root',
    sourceId: 'root',
    layerId: 'review',
  });
  const snapshot = await live.room.snapshot();
  expect(snapshot.claims).toContainEqual({ agent_id: 'codex', owner_id: 'user-1', owner_name: 'Alice' });
  expect(snapshot.tasks).toEqual([
    expect.objectContaining({ id: 't1', requester_id: 'user-1', layer_id: 'review', status: 'queued' }),
  ]);
  await send({ type: 'task_cancel', taskId: 't1' });
  expect((await live.room.snapshot()).tasks?.[0]?.status).toBe('cancelled');
});

test('agent task transitions keep waiting and cancellation requests ahead of the queue', async () => {
  const root: DrawOp = {
    id: 'root',
    tool: 'comment',
    num: 1,
    text: '问题',
    x: 1,
    y: 2,
    color: '#000',
    lineWidth: 2,
    ts: 1,
  };
  const live = liveRoom({ ops: [root] });
  const person = new FakeWebSocket({ id: 'p2', uid: 'user-1', name: 'Alice', color: '#000000' });
  live.ctx.getWebSockets().push(person);
  const peer = { id: 'mcp-codex-session', uid: 'codex', name: 'Codex', color: '#000000' };
  await live.room.join(peer);
  const send = (message: unknown) => live.room.webSocketMessage(person, JSON.stringify(message));
  await send({ type: 'layer_create', id: 'review', name: '审查' });
  await send({
    type: 'task_submit',
    taskId: 't1',
    agentId: 'codex',
    annotationId: 'root',
    sourceId: 'root',
    layerId: 'review',
  });
  expect((await live.room.agentTaskCommand(peer.id, { action: 'take' })).tasks[0]?.status).toBe('running');
  expect(await live.room.send({ type: 'op', op: { ...root, id: 'created-by-agent' } }, peer.id)).toBe(true);
  expect((await live.room.snapshot()).ops).toContainEqual(
    expect.objectContaining({ id: 'created-by-agent', layerId: 'review' }),
  );
  expect(
    (await live.room.agentTaskCommand(peer.id, { action: 'wait', taskId: 't1', waitingFor: 'Alice' })).tasks[0]?.status,
  ).toBe('waiting');
  expect((await live.room.agentTaskCommand(peer.id, { action: 'take' })).ok).toBe(false);
  await send({ type: 'task_cancel', taskId: 't1' });
  expect((await live.room.agentTaskCommand(peer.id, { action: 'complete', taskId: 't1' })).ok).toBe(false);
  expect((await live.room.agentTaskCommand(peer.id, { action: 'confirm_cancel', taskId: 't1' })).tasks[0]?.status).toBe(
    'cancelled',
  );
  expect((await live.room.agentTaskCommand('mcp-unknown-session', { action: 'list' })).ok).toBe(false);
});

test('a layer can be deleted immediately after its persisted content is moved', async () => {
  const live = liveRoom();
  const send = (message: unknown) => live.room.webSocketMessage(live.human, JSON.stringify(message));
  await send({ type: 'layer_create', id: 'review', name: '审查' });
  await send({
    type: 'op',
    op: {
      id: 'm',
      layerId: 'review',
      tool: 'comment',
      num: 1,
      text: '问题',
      x: 1,
      y: 2,
      color: '#000',
      lineWidth: 2,
      ts: 1,
    },
  });
  await live.room.alarm();
  await send({ type: 'update_op', opId: 'm', patch: { layerId: 'default' } });
  await send({ type: 'layer_delete', id: 'review' });
  expect((await live.room.snapshot()).layers?.some((layer) => layer.id === 'review')).toBe(false);
  expect(JSON.parse(opsColumn(live.sqlite) ?? '[]')[0].layerId).toBe('default');
});
