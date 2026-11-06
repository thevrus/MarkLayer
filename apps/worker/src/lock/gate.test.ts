import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { ROOM_LOCKED_CLOSE_CODE } from '@marklayer/types';
import { api } from '../api';
import { ogLocked, rooms } from '../rooms';
import { nowInSeconds } from '../store';
import { fakeDb } from '../test-d1';
import { FakeExecutionContext, fakeEnv } from '../test-env';
import { MAX_FAILURES, ROOM_GEN_HEADER, roomAccess } from './gate';
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

const failureWrites = (db: ReturnType<typeof fakeDb>) => db.calls.filter((c) => c.sql.includes('unlock_failures ('));

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
    const wrongDb = fakeDb({ firstQueue: [lockRow(), { failures: 0 }] });
    const wrong = await roomAccess({
      db: wrongDb,
      id: ID,
      headers: new Headers({ Authorization: 'Bearer nope' }),
    });
    expect(wrong).toEqual({ open: false, reason: 'wrong' });
    expect(failureWrites(wrongDb)).toHaveLength(1);

    const rightDb = fakeDb({ firstQueue: [lockRow(), { failures: 0 }] });
    const right = await roomAccess({
      db: rightDb,
      id: ID,
      headers: new Headers({ 'X-MarkLayer-Password': PASSWORD }),
    });
    expect(right).toEqual({ open: true, gen: 1, guarded: true });
    expect(failureWrites(rightDb)).toHaveLength(0);
  });

  test('a client over the limit is refused even with the right password', async () => {
    const db = fakeDb({ firstQueue: [lockRow(), { failures: MAX_FAILURES }] });
    const res = await roomAccess({
      db: db,
      id: ID,
      headers: new Headers({ Authorization: `Bearer ${PASSWORD}` }),
    });
    expect(res).toEqual({ open: false, reason: 'throttled' });
  });

  test('no password and no cookie is locked, with nothing counted', async () => {
    const db = fakeDb({ firstQueue: [lockRow({ owner_id: null })] });
    expect(await roomAccess({ db: db, id: ID, headers: new Headers() })).toEqual({
      open: false,
      reason: 'locked',
    });
    expect(failureWrites(db)).toHaveLength(0);
  });

  test('an unlock cookie from before a password change is refused', async () => {
    const current = await cookieFor({ gen: 1 });
    const open = await roomAccess({
      db: fakeDb({ firstQueue: [lockRow()] }),
      id: ID,
      headers: new Headers({ Cookie: current }),
    });
    expect(open.open).toBe(true);

    // Changed to the same password: only the generation moved, and that alone must void it.
    const sameRecord = await roomAccess({
      db: fakeDb({ firstQueue: [lockRow({ password_gen: 2, owner_id: null })] }),
      id: ID,
      headers: new Headers({ Cookie: current }),
    });
    expect(sameRecord).toEqual({ open: false, reason: 'locked' });

    // A cookie claiming the new generation but signed under the old record is forged as far as the room knows.
    const forged = await cookieFor({ gen: 2 });
    const newRecord = await hashPassword(PASSWORD);
    const refused = await roomAccess({
      db: fakeDb({ firstQueue: [lockRow({ password_hash: newRecord, password_gen: 2, owner_id: null })] }),
      id: ID,
      headers: new Headers({ Cookie: forged }),
    });
    expect(refused).toEqual({ open: false, reason: 'locked' });
  });

  test('the owner skips the prompt; another signed-in user does not', async () => {
    const session = { id: 'owner', email: 'o@x.co', last_seen_at: nowInSeconds(), expires_at: nowInSeconds() + 60 };
    const owner = await roomAccess({
      db: fakeDb({ firstQueue: [lockRow(), session] }),
      id: ID,
      headers: new Headers({ Cookie: 'ml_session=abc' }),
    });
    expect(owner.open).toBe(true);

    const stranger = await roomAccess({
      db: fakeDb({ firstQueue: [lockRow(), { ...session, id: 'someone-else' }] }),
      id: ID,
      headers: new Headers({ Cookie: 'ml_session=abc' }),
    });
    expect(stranger.open).toBe(false);
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
    expect(await ogLocked({ db: fakeDb({ firstQueue: [lockRow()] }), id: ID })).toBe(true);
    expect(await ogLocked({ db: fakeDb({ firstQueue: [lockRow({ password_hash: null })] }), id: ID })).toBe(false);
    // No room by that id: it is a project, whose first page is protected.
    const project = fakeDb({
      firstQueue: [null, { page_ids: JSON.stringify([ID]), created_at: 1, expires_at: null }, lockRow()],
    });
    expect(await ogLocked({ db: project, id: 'someProjectIdThatIsLong' })).toBe(true);
  });
});
