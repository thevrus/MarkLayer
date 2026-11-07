import type { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { MAX_EXPIRES_IN_SECONDS } from '../shared/accounts';
import { api } from './api';
import { nowInSeconds } from './store';
import { fakeDb, insertRow, migratedSqlite, SqliteD1 } from './test-d1';
import { FakeBucket, FakeExecutionContext, FakeRoomNamespace, fakeEnv } from './test-env';

/** A real nanoid: a short id now 400s before the body is read, so every assertion below would pass for the wrong reason. */
const ID = 'dsWPMrdw6EZ8jkkhxvFKS';

/** The route validates the body before it reads anything, so these need no live bindings. */
const testCtx = new FakeExecutionContext();

const OP = { id: 'o1', tool: 'rectangle', color: '#000000', lineWidth: 2, startX: 0, startY: 0, endX: 9, endY: 9 };

function post({
  id,
  body,
  db,
  cookie,
  room,
}: {
  id: string;
  body: unknown;
  db: D1Database;
  cookie?: string;
  room?: FakeRoomNamespace;
}) {
  return api.request(
    `/${id}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: JSON.stringify(body),
    },
    fakeEnv({ DB: db, ...(room ? { ANNOTATION_ROOM: room } : {}) }),
    testCtx,
  );
}

/** A real schema holding one room. Real SQL, because each guard below is about what reaches a row. */
function roomInDb(id: string, columns: Record<string, string | number | null> = {}) {
  const sqlite = migratedSqlite();
  insertRow({ sqlite, table: 'annotations', row: { id, ops: '[]', ...columns } });
  return { sqlite, db: new SqliteD1(sqlite) };
}

const rowsIn = (sqlite: Database) => sqlite.query('SELECT count(*) AS n FROM annotations').get();

describe('POST /{id} — expires_in ceiling', () => {
  // The bug this guards: both OpenAPI descriptions advertised "max 2592000 = 30
  // days" while `expiresAtFrom` accepted any integer, so a caller could park a
  // row far past the documented limit and the retention sweep would honour it.
  test('rejects an expires_in past the documented 30-day ceiling', async () => {
    const db = fakeDb();
    const res = await post({ id: ID, body: { ops: [], expires_in: MAX_EXPIRES_IN_SECONDS + 1 }, db });
    expect(res.status).toBe(400);
    // Refused on the body alone — nothing was written or read.
    expect(db.calls).toHaveLength(0);
  });

  test('accepts the ceiling itself, so the 30-day preset is not the one value that fails', async () => {
    const res = await post({ id: ID, body: { ops: [], expires_in: MAX_EXPIRES_IN_SECONDS }, db: fakeDb() });
    expect(res.status).toBe(200);
  });

  // `expiresAtFrom` reads a non-positive `expires_in` as "no expiry"; a lower
  // bound on the schema would turn that tolerance into a 400 for old callers.
  test('still takes 0 as "no expiry" rather than rejecting it', async () => {
    const res = await post({ id: ID, body: { ops: [], expires_in: 0 }, db: fakeDb() });
    expect(res.status).toBe(200);
  });
});

describe('POST /{id} — a save without expires_in', () => {
  const EXPIRES_AT = nowInSeconds() + 3600;

  /** The expiry left on a room after one save. Real SQL, because the bug is a column the UPDATE overwrites. */
  async function expiryAfterSaving(body: unknown) {
    const { sqlite, db } = roomInDb(ID, { expires_at: EXPIRES_AT });
    const res = await post({ id: ID, body, db });
    expect(res.status).toBe(200);
    return sqlite
      .query<{ expires_at: number | null }, [string]>('SELECT expires_at FROM annotations WHERE id = ?')
      .get(ID)?.expires_at;
  }

  test('W12 the object form keeps the expiry the link already has', async () => {
    expect(await expiryAfterSaving({ ops: [] })).toBe(EXPIRES_AT);
  });

  test('W12 the bare-array autosave never touches the expiry', async () => {
    expect(await expiryAfterSaving([])).toBe(EXPIRES_AT);
  });
});

describe('POST /{id} — share id entropy floor', () => {
  // Guards the old bare-`z.string()` bug: `POST /api/a` squatted marklayer.app/s/a,
  // and a short keyspace made the whole room set enumerable.
  test('refuses to mint a room at a guessable id', async () => {
    // Charset cases live in the `isNewShareId` unit tests; a slash never
    // reaches this route at all.
    for (const id of ['a', 'abc', 'aB3xY7kZ', 'onlyeleven']) {
      const sqlite = migratedSqlite();
      const res = await post({ id, body: { ops: [] }, db: new SqliteD1(sqlite) });
      expect(res.status).toBe(404);
      expect(rowsIn(sqlite)).toEqual({ n: 0 });
    }
  });

  test('a room that already exists still takes writes at its old short id', async () => {
    // Only *minting* is gated. A floor on length alone would have made every
    // pre-existing short link read-only the moment this shipped.
    const { sqlite, db } = roomInDb('abc');
    const room = new FakeRoomNamespace();
    const res = await post({ id: 'abc', body: { ops: [OP] }, db, room });
    expect(res.status).toBe(200);
    expect(room.room.replaced.map((change) => change.ops)).toEqual([[OP]]);
    expect(rowsIn(sqlite)).toEqual({ n: 1 });
  });
});

describe('GET /health — the bindings, not a hardcoded ok', () => {
  // This route answered a literal `{ status: 'ok' }` until the footer's status
  // line on every page started reading it. A green light through a D1 outage is
  // the whole bug these guard.
  const health = ({ db, storage }: { db: D1Database; storage: R2Bucket['head'] }) =>
    api.request('/health', {}, fakeEnv({ DB: db, OG_BUCKET: new FakeBucket({ head: storage }) }), testCtx);

  /** `/health` is not an OpenAPI route, so Hono infers its body as `undefined`. */
  const body = (res: Response): Promise<unknown> => res.json();

  const reachable = () => fakeDb({ first: { 1: 1 } });
  const missing = async () => null;
  const down = async () => {
    throw new Error('binding unreachable');
  };
  const unreachable = () => {
    const db = fakeDb();
    const { prepare } = db;
    db.prepare = (sql) => {
      const stmt = prepare(sql);
      stmt.first = down;
      return stmt;
    };
    return db;
  };

  test('reports ok only when both bindings answer', async () => {
    const res = await health({ db: reachable(), storage: missing });
    expect(res.status).toBe(200);
    expect(await body(res)).toEqual({ status: 'ok', checks: { db: true, storage: true } });
  });

  test('degrades with a 503 when D1 is unreachable', async () => {
    const res = await health({ db: unreachable(), storage: missing });
    expect(res.status).toBe(503);
    expect(await body(res)).toEqual({ status: 'degraded', checks: { db: false, storage: true } });
  });

  test('degrades when R2 is unreachable, so one binding cannot hide the other', async () => {
    const res = await health({ db: reachable(), storage: down });
    expect(res.status).toBe(503);
    expect(await body(res)).toEqual({ status: 'degraded', checks: { db: true, storage: false } });
  });
});

describe('integration routes never expose a credential', () => {
  const request = ({ path, db, body }: { path: string; db: D1Database; body?: unknown }) =>
    api.request(
      path,
      body === undefined
        ? {}
        : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
      fakeEnv({ DB: db }),
      testCtx,
    );

  test('summaries carry a hint, never the config', async () => {
    const integrations = JSON.stringify([
      { provider: 'slack', config: { url: 'https://hooks.slack.com/services/T0/B0/SECRETwxyz' } },
      { provider: 'github', config: { repo: 'acme/site', token: 'ghp_legacy' } },
    ]);
    const res = await request({ path: `/${ID}/integrations`, db: fakeDb({ first: { integrations } }) });
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).not.toContain('SECRET');
    expect(text).not.toContain('ghp_legacy');
    expect(JSON.parse(text)).toEqual({
      integrations: [
        { provider: 'slack', hint: '…wxyz' },
        { provider: 'github', hint: 'acme/site' },
      ],
    });
  });

  test('a posted token is split off before the room is stored', async () => {
    const { sqlite, db } = roomInDb(ID);
    const res = await request({
      path: `/${ID}/integrations`,
      db,
      body: { provider: 'github', config: { repo: 'acme/site', token: 'ghp_new' } },
    });
    expect(res.status).toBe(200);
    const stored = sqlite.query<{ integrations: string }, []>('SELECT integrations FROM annotations').get();
    expect(stored?.integrations).toContain('acme/site');
    expect(stored?.integrations).not.toContain('ghp_new');
    expect(await res.text()).not.toContain('ghp_new');
  });
});
