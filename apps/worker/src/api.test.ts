import { describe, expect, test } from 'bun:test';
import { MAX_EXPIRES_IN_SECONDS } from '@marklayer/types';
import { api } from './api';
import { asDb, fakeDb } from './test-d1';

/** A real nanoid: a short id now 400s before the body is read, so every assertion below would pass for the wrong reason. */
const ID = 'dsWPMrdw6EZ8jkkhxvFKS';

/** The route validates the body before it reads anything, so these need no live bindings. */
const testCtx = { waitUntil: (p: Promise<unknown>) => void p, passThroughOnException: () => {} };

function post({ id, body, db }: { id: string; body: unknown; db: ReturnType<typeof fakeDb> }) {
  return api.request(
    `/${id}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    // biome-ignore lint/suspicious/noExplicitAny: same reason as asDb — a fake of only what the route touches.
    { DB: asDb(db) } as any,
    // biome-ignore lint/suspicious/noExplicitAny: ditto for the execution context.
    testCtx as any,
  );
}

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

describe('POST /{id} — share id entropy floor', () => {
  // Guards the old bare-`z.string()` bug: `POST /api/a` squatted marklayer.app/s/a,
  // and a short keyspace made the whole room set enumerable.
  const insertsA = (db: ReturnType<typeof fakeDb>) => db.calls.some((call) => call.sql.includes('INSERT'));

  test('refuses to mint a room at a guessable id', async () => {
    // Charset cases live in the `isNewShareId` unit tests; a slash never
    // reaches this route at all.
    for (const id of ['a', 'abc', 'aB3xY7kZ', 'onlyeleven']) {
      // changes: 0 — the UPDATE matched no row, so there was no room to write.
      const db = fakeDb({ changes: 0 });
      const res = await post({ id, body: { ops: [] }, db });
      expect(res.status).toBe(400);
      expect(insertsA(db)).toBe(false);
    }
  });

  test('a room that already exists still takes writes at its old short id', async () => {
    // Only *minting* is gated. A floor on length alone would have made every
    // pre-existing short link read-only the moment this shipped.
    const db = fakeDb({ first: { access: 'edit', owner_id: null, owner_expires_at: null }, changes: 1 });
    const res = await post({ id: 'abc', body: { ops: [] }, db });
    expect(res.status).toBe(200);
    // Updated in place, never re-created: an INSERT here would be the squat.
    expect(insertsA(db)).toBe(false);
    expect(db.calls.some((call) => call.sql.includes('UPDATE annotations'))).toBe(true);
  });

  test('a well-formed id takes the ordinary upsert, and costs no extra lookup', async () => {
    const db = fakeDb();
    const res = await post({ id: ID, body: { ops: [] }, db });
    expect(res.status).toBe(200);
    expect(insertsA(db)).toBe(true);
    // One access read, one upsert — the floor adds nothing on the normal path.
    expect(db.calls).toHaveLength(2);
  });
});

describe('GET /health — the bindings, not a hardcoded ok', () => {
  // This route answered a literal `{ status: 'ok' }` until the footer's status
  // line on every page started reading it. A green light through a D1 outage is
  // the whole bug these guard.
  const health = ({ db, storage }: { db: () => Promise<unknown>; storage: () => Promise<unknown> }) =>
    api.request(
      '/health',
      {},
      // biome-ignore lint/suspicious/noExplicitAny: a fake of only what the route touches.
      { DB: { prepare: () => ({ first: db }) }, OG_BUCKET: { head: storage } } as any,
      // biome-ignore lint/suspicious/noExplicitAny: ditto for the execution context.
      testCtx as any,
    );

  /** `/health` is not an OpenAPI route, so Hono infers its body as `undefined`. */
  const body = (res: Response): Promise<unknown> => res.json();

  const reachable = async () => ({ 1: 1 });
  const missing = async () => null;
  const down = async () => {
    throw new Error('binding unreachable');
  };

  test('reports ok only when both bindings answer', async () => {
    const res = await health({ db: reachable, storage: missing });
    expect(res.status).toBe(200);
    expect(await body(res)).toEqual({ status: 'ok', checks: { db: true, storage: true } });
  });

  // The one that would have shipped a permanent outage: `head()` on a key that
  // does not exist resolves to null, which is a successful round trip. A probe
  // that treated a miss as a failure would report degraded forever.
  test('counts an R2 miss as reached, not as a failure', async () => {
    const res = await health({ db: reachable, storage: missing });
    expect(await body(res)).toMatchObject({ checks: { storage: true } });
  });

  test('degrades with a 503 when D1 is unreachable', async () => {
    const res = await health({ db: down, storage: missing });
    expect(res.status).toBe(503);
    expect(await body(res)).toEqual({ status: 'degraded', checks: { db: false, storage: true } });
  });

  test('degrades when R2 is unreachable, so one binding cannot hide the other', async () => {
    const res = await health({ db: reachable, storage: down });
    expect(res.status).toBe(503);
    expect(await body(res)).toEqual({ status: 'degraded', checks: { db: true, storage: false } });
  });
});
