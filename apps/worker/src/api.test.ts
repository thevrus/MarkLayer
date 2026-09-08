import { describe, expect, test } from 'bun:test';
import { MAX_EXPIRES_IN_SECONDS } from '@marklayer/types';
import { api } from './api';
import { asDb, fakeDb } from './test-d1';

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
    const res = await post({ id: 'abc', body: { ops: [], expires_in: MAX_EXPIRES_IN_SECONDS + 1 }, db });
    expect(res.status).toBe(400);
    // Refused on the body alone — nothing was written or read.
    expect(db.calls).toHaveLength(0);
  });

  test('accepts the ceiling itself, so the 30-day preset is not the one value that fails', async () => {
    const res = await post({ id: 'abc', body: { ops: [], expires_in: MAX_EXPIRES_IN_SECONDS }, db: fakeDb() });
    expect(res.status).toBe(200);
  });

  // `expiresAtFrom` reads a non-positive `expires_in` as "no expiry"; a lower
  // bound on the schema would turn that tolerance into a 400 for old callers.
  test('still takes 0 as "no expiry" rather than rejecting it', async () => {
    const res = await post({ id: 'abc', body: { ops: [], expires_in: 0 }, db: fakeDb() });
    expect(res.status).toBe(200);
  });
});
