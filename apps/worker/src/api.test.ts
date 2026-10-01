import { describe, expect, test } from 'bun:test';
import { MAX_EXPIRES_IN_SECONDS } from '@marklayer/types';
import { api } from './api';
import { asDb, fakeDb } from './test-d1';

/** A real nanoid: a short id now 400s before the body is read, so every assertion below would pass for the wrong reason. */
const ID = 'dsWPMrdw6EZ8jkkhxvFKS';

/** The route validates the body before it reads anything, so these need no live bindings. */
const testCtx = { waitUntil: (p: Promise<unknown>) => void p, passThroughOnException: () => {} };

function post({ id, body, db, cookie }: { id: string; body: unknown; db: ReturnType<typeof fakeDb>; cookie?: string }) {
  return api.request(
    `/${id}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: JSON.stringify(body),
    },
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

describe('POST /{id} on a view-only link', () => {
  const viewOnly = { access: 'view', owner_id: 'u1', owner_expires_at: null };

  test('is 403 for a stranger and 200 for its owner', async () => {
    const stranger = fakeDb({ firstQueue: [viewOnly] });
    const denied = await post({ id: ID, body: { ops: [] }, db: stranger });
    expect(denied.status).toBe(403);
    // The room was not written.
    expect(stranger.calls.some((call) => /INSERT|UPDATE annotations/.test(call.sql))).toBe(false);

    const now = Math.floor(Date.now() / 1000);
    const session = { id: 'u1', email: 'o@x', last_seen_at: now, expires_at: now + 1000 };
    const owner = fakeDb({ firstQueue: [viewOnly, session] });
    const allowed = await post({ id: ID, body: { ops: [] }, db: owner, cookie: 'ml_session=tok' });
    expect(allowed.status).toBe(200);
  });
});

describe('integration routes never expose a credential', () => {
  const request = ({ path, db, body }: { path: string; db: ReturnType<typeof fakeDb>; body?: unknown }) =>
    api.request(
      path,
      body === undefined
        ? {}
        : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
      // biome-ignore lint/suspicious/noExplicitAny: same reason as asDb — a fake of only what the route touches.
      { DB: asDb(db) } as any,
      // biome-ignore lint/suspicious/noExplicitAny: ditto for the execution context.
      testCtx as any,
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
    const db = fakeDb({ first: { integrations: null } });
    const res = await request({
      path: `/${ID}/integrations`,
      db,
      body: { provider: 'github', config: { repo: 'acme/site', token: 'ghp_new' } },
    });
    expect(res.status).toBe(200);
    const write = db.calls.find((call) => call.sql.includes('UPDATE annotations SET integrations'));
    expect(write).toBeDefined();
    const json = String(write?.bindings[0]);
    expect(json).toContain('acme/site');
    expect(json).not.toContain('ghp_new');
    expect(await res.text()).not.toContain('ghp_new');
  });
});
