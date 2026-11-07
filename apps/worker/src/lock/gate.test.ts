import type { Database } from 'bun:sqlite';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { ROOM_EXPIRED_CLOSE_CODE, ROOM_GEN_HEADER, ROOM_LOCKED_CLOSE_CODE } from '@marklayer/types/wire';
import { api } from '../api';
import { hashToken } from '../auth/tokens';
import { rooms } from '../rooms';
import { nowInSeconds } from '../store';
import { fakeDb, insertRow, migratedSqlite, SqliteD1 } from '../test-d1';
import { FakeExecutionContext, fakeEnv } from '../test-env';
import { MAX_FAILURES } from './failures';
import { ogSubject, roomAccess } from './gate';
import { hashPassword, signUnlock, unlockCookieName, verifyPassword } from './password';

/** A real nanoid, so `getRoomStub` takes the id on shape alone and the queue below is only the gate's reads. */
const ID = 'dsWPMrdw6EZ8jkkhxvFKS';
const PASSWORD = 'correct horse';
let record = '';

beforeAll(async () => {
  record = await hashPassword(PASSWORD);
});

const lockRow = (over: Record<string, unknown> = {}) => ({
  password_hash: record,
  password_gen: 1,
  owner_id: 'owner',
  ...over,
});

const cookieFor = async ({ gen, signedWith = record }: { gen: number; signedWith?: string }) =>
  `${unlockCookieName(ID)}=${await signUnlock({ roomId: ID, gen, record: signedWith, expiresAt: nowInSeconds() + 60 })}`;

/** Past its deadline, with every column a door might read: the fake replays this row whatever the SELECT named. */
const expiredRow = () => ({
  ...lockRow({ password_hash: null, password_gen: 0, owner_id: null }),
  ops: '[]',
  url: null,
  width: null,
  created_at: 1,
  access: 'edit',
  expires_at: nowInSeconds() - 60,
  owner_expires_at: null,
});

/** A real schema holding the room, so a read's order and a guess's bookkeeping are the gate's own business. */
function lockedRoom(over: Record<string, string | number | null> = {}) {
  const sqlite = migratedSqlite();
  const row = { id: ID, ops: '[]', password_hash: record, password_gen: 1, owner_id: 'owner', ...over };
  insertRow({ sqlite, table: 'annotations', row });
  return { sqlite, db: new SqliteD1(sqlite) };
}

const failuresIn = (sqlite: Database) =>
  sqlite.query<{ failures: number }, []>('SELECT failures FROM unlock_failures').get()?.failures ?? 0;

const access = ({ db, headers }: { db: D1Database; headers?: Record<string, string> }) =>
  roomAccess({ db, id: ID, headers: new Headers(headers) });

describe('password record', () => {
  test('a wrong password does not verify, and the record holds no trace of the right one', async () => {
    expect(await verifyPassword({ password: 'correct horsf', record })).toBe(false);
    expect(await verifyPassword({ password: PASSWORD, record })).toBe(true);
    expect(record).not.toContain(PASSWORD);
    // Salted: the same password never stores the same record twice.
    expect(await hashPassword(PASSWORD)).not.toBe(record);
  });
});

describe('roomAccess', () => {
  test('a wrong password is refused and counted; the right one opens', async () => {
    const { sqlite, db } = lockedRoom();
    expect(await access({ db, headers: { Authorization: 'Bearer nope' } })).toEqual({ open: false, reason: 'wrong' });
    expect(failuresIn(sqlite)).toBe(1);

    expect(await access({ db, headers: { 'X-MarkLayer-Password': PASSWORD } })).toEqual({
      open: true,
      gen: 1,
      guarded: true,
    });
    expect(failuresIn(sqlite)).toBe(1);
  });

  test('a client over the limit is refused even with the right password', async () => {
    const { db } = lockedRoom();
    for (let i = 0; i < MAX_FAILURES; i++) await access({ db, headers: { Authorization: 'Bearer nope' } });
    expect(await access({ db, headers: { Authorization: `Bearer ${PASSWORD}` } })).toEqual({
      open: false,
      reason: 'throttled',
    });
  });

  test('no password and no cookie is locked, with nothing counted', async () => {
    const { sqlite, db } = lockedRoom({ owner_id: null });
    expect(await access({ db })).toEqual({ open: false, reason: 'locked' });
    expect(failuresIn(sqlite)).toBe(0);
  });

  test('an unlock cookie from before a password change is refused', async () => {
    const current = await cookieFor({ gen: 1 });
    expect((await access({ db: lockedRoom().db, headers: { Cookie: current } })).open).toBe(true);

    // Changed to the same password: only the generation moved, and that alone must void it.
    const moved = lockedRoom({ password_gen: 2, owner_id: null });
    expect(await access({ db: moved.db, headers: { Cookie: current } })).toEqual({ open: false, reason: 'locked' });

    // A cookie claiming the new generation but signed under the old record is forged as far as the room knows.
    const forged = await cookieFor({ gen: 2 });
    const rehashed = lockedRoom({ password_hash: await hashPassword(PASSWORD), password_gen: 2, owner_id: null });
    expect(await access({ db: rehashed.db, headers: { Cookie: forged } })).toEqual({ open: false, reason: 'locked' });
  });

  test('the owner skips the prompt; another signed-in user does not', async () => {
    const signedIn = async (userId: string) => {
      const { sqlite, db } = lockedRoom();
      insertRow({ sqlite, table: 'users', row: { id: userId, email: 'o@x.co' } });
      const session = { id: await hashToken('abc'), user_id: userId, expires_at: nowInSeconds() + 60 };
      insertRow({ sqlite, table: 'sessions', row: session });
      return access({ db, headers: { Cookie: 'ml_session=abc' } });
    };
    expect((await signedIn('owner')).open).toBe(true);
    expect((await signedIn('someone-else')).open).toBe(false);
  });
});

/** A room stub that records whether anything reached it. */
function roomEnv(db: ReturnType<typeof fakeDb>) {
  const reached: Request[] = [];
  const stub = {
    fetch: async (req: Request) => {
      reached.push(req);
      return new Response(null, { status: 204 });
    },
  };
  const env = { DB: db, ANNOTATION_ROOM: { idFromName: () => 'do', get: () => stub } };
  return { env, reached };
}

const testCtx = new FakeExecutionContext();

describe('GET /ws/:id', () => {
  const closes: number[] = [];
  const hadPair: unknown = Reflect.get(globalThis, 'WebSocketPair');
  beforeAll(() => {
    const end = () => ({ accept() {}, close: (code: number) => void closes.push(code) });
    Reflect.set(
      globalThis,
      'WebSocketPair',
      class {
        0 = end();
        1 = end();
      },
    );
  });
  afterAll(() => {
    Reflect.set(globalThis, 'WebSocketPair', hadPair);
  });

  const upgrade = (headers: Record<string, string> = {}) =>
    new Request(`https://marklayer.app/ws/${ID}`, { headers: { Upgrade: 'websocket', ...headers } });

  test('without an unlock the socket never reaches the room and is closed as locked', async () => {
    closes.length = 0;
    const { env, reached } = roomEnv(fakeDb({ firstQueue: [lockRow({ owner_id: null })] }));
    const res = await rooms.fetch(upgrade(), env, testCtx);
    expect(res.status).toBe(101);
    expect(reached).toHaveLength(0);
    expect(closes).toEqual([ROOM_LOCKED_CLOSE_CODE]);
  });

  test('an unlocked socket reaches the room stamped with the checked generation, whatever the client claimed', async () => {
    const { env, reached } = roomEnv(fakeDb({ firstQueue: [lockRow()] }));
    await rooms.fetch(upgrade({ Cookie: await cookieFor({ gen: 1 }), [ROOM_GEN_HEADER]: '999' }), env, testCtx);
    expect(reached).toHaveLength(1);
    expect(reached[0]?.headers.get(ROOM_GEN_HEADER)).toBe('1');
  });

  test('W11 an expired room is refused before the socket reaches it, with the expiry close code', async () => {
    closes.length = 0;
    const { env, reached } = roomEnv(fakeDb({ first: expiredRow() }));
    const res = await rooms.fetch(upgrade(), env, testCtx);
    expect(res.status).toBe(101);
    expect(reached).toHaveLength(0);
    expect(closes).toEqual([ROOM_EXPIRED_CLOSE_CODE]);
  });
});

describe('other room readers', () => {
  test('page.json, the remote MCP endpoint and the share API refuse a locked room', async () => {
    for (const path of [`/s/${ID}/page.json`, `/s/${ID}/mcp`]) {
      const { env, reached } = roomEnv(fakeDb({ firstQueue: [lockRow({ owner_id: null })] }));
      const res = await rooms.fetch(new Request(`https://marklayer.app${path}`), env, testCtx);
      expect(res.status).toBe(401);
      expect(reached).toHaveLength(0);
    }
    for (const path of [`/${ID}`, `/${ID}/integrations`, `/${ID}/versions`]) {
      const db = fakeDb({ firstQueue: [lockRow({ owner_id: null })] });
      const res = await api.request(path, {}, fakeEnv({ DB: db }), testCtx);
      expect(res.status).toBe(401);
      // The gate is the only read: no ops, no destinations.
      expect(db.calls).toHaveLength(1);
    }
  });

  test('W11 an expired room answers the remote MCP endpoint with 410', async () => {
    const heartbeats: unknown[] = [];
    const snapshot = { ops: [], url: null, width: null, createdAt: null, expiresAt: null, canEdit: true };
    const stub = {
      join: async (...call: unknown[]) => {
        heartbeats.push(call);
        return snapshot;
      },
      snapshot: async () => snapshot,
    };
    const env = { DB: fakeDb({ first: expiredRow() }), ANNOTATION_ROOM: { idFromName: () => 'do', get: () => stub } };
    const res = await rooms.fetch(
      new Request(`https://marklayer.app/s/${ID}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      }),
      env,
      testCtx,
    );
    expect(res.status).toBe(410);
    expect(heartbeats).toHaveLength(0);
  });

  // Chaining to a room is how its id reaches the next version's switcher, so naming a locked one must not be enough.
  test('a preview cannot chain onto a protected room it has not unlocked', async () => {
    const db = fakeDb({ firstQueue: [lockRow({ owner_id: null })] });
    const res = await api.request(
      '/newPreviewRoomIdLong21/preview',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: 'https://example.com', title: 'v2', repo: 'a/b', branch: 'main', previous: ID }),
      },
      fakeEnv({ DB: db }),
      testCtx,
    );
    expect(res.status).toBe(400);
    expect(db.calls).toHaveLength(1);
  });

  test("a project bundling someone's protected page gets it back empty", async () => {
    const page = {
      id: ID,
      ops: '[{"id":"secret"}]',
      url: 'https://internal.example',
      width: 1440,
      password_hash: record,
      password_gen: 1,
      owner_id: null,
    };
    const db = fakeDb({ first: { page_ids: JSON.stringify([ID]), created_at: 1, expires_at: null }, all: [page] });
    const res = await api.request('/p/someProjectIdThatIsLong', {}, fakeEnv({ DB: db }), testCtx);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain('internal.example');
    expect(JSON.stringify(body)).not.toContain('secret');
  });

  test('the OG card is withheld for a protected room and for a project led by one', async () => {
    expect(await ogSubject({ db: lockedRoom().db, id: ID })).toBeNull();
    expect(await ogSubject({ db: lockedRoom({ password_hash: null }).db, id: ID })).toBe(ID);
    // No room by that id: it is a project, whose first page is protected.
    const { sqlite, db } = lockedRoom();
    const project = { id: 'someProjectIdThatIsLong', page_ids: JSON.stringify([ID]) };
    insertRow({ sqlite, table: 'projects', row: project });
    expect(await ogSubject({ db, id: project.id })).toBeNull();
  });
});
