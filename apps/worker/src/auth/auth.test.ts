import { beforeEach, describe, expect, test } from 'bun:test';
import { MAX_EXPIRES_IN_SECONDS } from '@marklayer/types';
import { nowInSeconds } from '../store';
import { asDb, fakeDb } from '../test-d1';
import { auth } from './routes';
import { authStore, ownedStore } from './store';
import { hashToken, mintToken } from './tokens';
import { normalizeEmail, SESSION_COOKIE } from './types';

describe('normalizeEmail', () => {
  test('lower-cases and trims so one person is one account', () => {
    expect(normalizeEmail('  Vadym@Example.COM ')).toBe('vadym@example.com');
  });

  test('rejects the shapes that cannot be an address', () => {
    expect(normalizeEmail('nope')).toBeNull();
    expect(normalizeEmail('@example.com')).toBeNull();
    expect(normalizeEmail('a@b')).toBeNull();
    expect(normalizeEmail('two@at@example.com')).toBeNull();
    expect(normalizeEmail('has space@example.com')).toBeNull();
    expect(normalizeEmail(`${'a'.repeat(250)}@example.com`)).toBeNull();
  });

  test('accepts the unusual-but-real addresses a stricter pattern would turn away', () => {
    expect(normalizeEmail("o'brien+tag@sub.example.co.uk")).toBe("o'brien+tag@sub.example.co.uk");
  });
});

describe('tokens', () => {
  test('mints a distinct URL-safe secret each time', () => {
    const a = mintToken();
    const b = mintToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  test('hashes deterministically, and never returns the secret itself', async () => {
    const token = mintToken();
    const digest = await hashToken(token);
    expect(await hashToken(token)).toBe(digest);
    expect(digest).not.toBe(token);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('authStore.redeemLoginToken', () => {
  test('returns null when the conditional update matched no row', async () => {
    // Two tabs opening the same link: the loser's UPDATE returns nothing.
    expect(await authStore(asDb(fakeDb({ first: null }))).redeemLoginToken('tok')).toBeNull();
  });

  test('guards single use and expiry inside the UPDATE, not in a prior read', async () => {
    const db = fakeDb({ first: { email: 'someone@example.com' } });
    expect(await authStore(asDb(db)).redeemLoginToken('tok')).toBe('someone@example.com');
    expect(db.calls).toHaveLength(1);
    expect(db.calls[0].sql).toContain('used_at IS NULL');
    expect(db.calls[0].sql).toContain('expires_at >');
    expect(db.calls[0].sql).toContain('RETURNING email');
  });
});

describe('authStore.upsertUser', () => {
  test('signs up and signs in with one upsert, taking the id back from the row', async () => {
    const db = fakeDb({ first: { id: 'existing', email: 'a@b.com' } });
    expect(await authStore(asDb(db)).upsertUser('a@b.com')).toEqual({ id: 'existing', email: 'a@b.com' });
    expect(db.calls).toHaveLength(1);
    expect(db.calls[0].sql).toContain('ON CONFLICT(email)');
  });
});

describe('authStore.throttleSeconds', () => {
  test('allows the first request for an address', async () => {
    expect(await authStore(asDb(fakeDb({ first: null }))).throttleSeconds('a@b.com')).toBe(0);
  });

  test('reports the remaining wait while a fresh link is outstanding', async () => {
    const createdAt = Math.floor(Date.now() / 1000) - 20;
    const wait = await authStore(asDb(fakeDb({ first: { created_at: createdAt } }))).throttleSeconds('a@b.com');
    expect(wait).toBeGreaterThan(0);
    expect(wait).toBeLessThanOrEqual(40);
  });
});

describe('ownedStore.claimAnnotation', () => {
  test('only claims a link nobody owns', async () => {
    const db = fakeDb({ changes: 1 });
    expect(await ownedStore(asDb(db)).claimAnnotation({ id: 'abc', ownerId: 'u1' })).toBe(true);
    expect(db.calls[0].sql).toContain('owner_id IS NULL');
  });

  test('reports failure when the row is already owned', async () => {
    expect(await ownedStore(asDb(fakeDb({ changes: 0 }))).claimAnnotation({ id: 'abc', ownerId: 'u1' })).toBe(false);
  });
});

describe('ownedStore.releaseAnnotation', () => {
  // The bug this guards: release used to clear only owner_id, so a link left
  // view-only had no owner left to ever flip it back — permanently locked.
  test('also resets access and the owner expiry, not just owner_id', async () => {
    const db = fakeDb({ changes: 1 });
    expect(await ownedStore(asDb(db)).releaseAnnotation({ id: 'abc', ownerId: 'u1' })).toBe(true);
    expect(db.calls[0].sql).toContain("access = 'edit'");
    expect(db.calls[0].sql).toContain('owner_expires_at = NULL');
    expect(db.calls[0].sql).toContain('owner_id = NULL');
  });

  test('reports failure when the session does not own the link', async () => {
    expect(await ownedStore(asDb(fakeDb({ changes: 0 }))).releaseAnnotation({ id: 'abc', ownerId: 'u1' })).toBe(false);
  });
});

/** The slice of the room namespace the settings route touches: it records which room ids it was told to refresh. */
function fakeRoom() {
  const pings: string[] = [];
  return {
    pings,
    idFromName: (name: string) => name,
    get: () => ({
      fetch: async (req: Request) => {
        pings.push(new URL(req.url).searchParams.get('id') ?? '');
        return new Response(null, { status: 204 });
      },
    }),
  };
}
// biome-ignore lint/suspicious/noExplicitAny: same reason as asDb — a fake of only the methods the route calls.
const asRoom = (ns: ReturnType<typeof fakeRoom>) => ns as any;

/** The route hands the room ping to `waitUntil`; nothing here needs to await it. */
// biome-ignore lint/suspicious/noExplicitAny: same reason as asRoom.
const testCtx = { waitUntil: (p: Promise<unknown>) => void p, passThroughOnException: () => {} } as any;

describe('PATCH /links/:id', () => {
  const room = fakeRoom();
  beforeEach(() => {
    room.pings.length = 0;
  });
  const cookie = `${SESSION_COOKIE}=tok`;
  const jsonHeaders = { Cookie: cookie, 'Content-Type': 'application/json' };
  // What `authStore.userForSession`'s join returns for a live session.
  const sessionRow = { id: 'owner1', email: 'owner@example.com', expires_at: nowInSeconds() + 1000 };

  test('the owner flips access and the write carries the resolved values', async () => {
    const db = fakeDb({ firstQueue: [sessionRow, { access: 'edit', owner_expires_at: null }] });
    const res = await auth.request(
      '/links/abc',
      { method: 'PATCH', headers: jsonHeaders, body: JSON.stringify({ access: 'view' }) },
      { DB: asDb(db), ANNOTATION_ROOM: asRoom(room) },
      testCtx,
    );
    expect(res.status).toBe(200);
    expect(await res.json<{ updated: boolean }>()).toEqual({ updated: true });
    const update = db.calls.at(-1);
    expect(update?.sql).toContain('UPDATE annotations SET access');
    // access from the body, ownerExpiresAt untouched from the current row.
    expect(update?.bindings).toEqual(['view', null, 'abc', 'owner1']);
    // The warm room hears about it, so the flip bites before the next eviction.
    expect(room.pings).toEqual(['abc']);
  });

  test('a signed-in non-owner gets updated: false and no write is issued', async () => {
    // getSettings' `AND owner_id = ?` matches nothing for someone else's link.
    const db = fakeDb({ firstQueue: [sessionRow, null] });
    const res = await auth.request(
      '/links/abc',
      { method: 'PATCH', headers: jsonHeaders, body: JSON.stringify({ access: 'view' }) },
      { DB: asDb(db), ANNOTATION_ROOM: asRoom(room) },
      testCtx,
    );
    expect(res.status).toBe(200);
    expect(await res.json<{ updated: boolean }>()).toEqual({ updated: false });
    expect(db.calls).toHaveLength(2);
    expect(room.pings).toEqual([]);
  });

  test('an unauthenticated request is rejected before the store is touched', async () => {
    const db = fakeDb();
    const res = await auth.request(
      '/links/abc',
      { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ access: 'view' }) },
      { DB: asDb(db), ANNOTATION_ROOM: asRoom(room) },
      testCtx,
    );
    expect(res.status).toBe(401);
    expect(db.calls).toHaveLength(0);
  });

  test('an ownerExpiresIn past the ceiling is a 400 before any settings read', async () => {
    const db = fakeDb({ firstQueue: [sessionRow] });
    const res = await auth.request(
      '/links/abc',
      {
        method: 'PATCH',
        headers: jsonHeaders,
        body: JSON.stringify({ ownerExpiresIn: MAX_EXPIRES_IN_SECONDS + 1 }),
      },
      { DB: asDb(db), ANNOTATION_ROOM: asRoom(room) },
      testCtx,
    );
    expect(res.status).toBe(400);
    // Only the session lookup ran — the invalid body never reached ownedStore.
    expect(db.calls).toHaveLength(1);
  });

  test('ownerExpiresIn: null clears the owner expiry and leaves access alone', async () => {
    const db = fakeDb({ firstQueue: [sessionRow, { access: 'view', owner_expires_at: 12345 }] });
    const res = await auth.request(
      '/links/abc',
      { method: 'PATCH', headers: jsonHeaders, body: JSON.stringify({ ownerExpiresIn: null }) },
      { DB: asDb(db), ANNOTATION_ROOM: asRoom(room) },
      testCtx,
    );
    expect(res.status).toBe(200);
    expect(await res.json<{ updated: boolean }>()).toEqual({ updated: true });
    expect(db.calls.at(-1)?.bindings).toEqual(['view', null, 'abc', 'owner1']);
  });
});

describe('DELETE /links/:id', () => {
  const room = fakeRoom();
  beforeEach(() => {
    room.pings.length = 0;
  });
  const cookie = `${SESSION_COOKIE}=tok`;
  const sessionRow = { id: 'owner1', email: 'owner@example.com', expires_at: nowInSeconds() + 1000 };

  test('releasing pings the warm room, so a cached view-only lock lifts immediately', async () => {
    const db = fakeDb({ firstQueue: [sessionRow], changes: 1 });
    const res = await auth.request(
      '/links/abc',
      { method: 'DELETE', headers: { Cookie: cookie } },
      { DB: asDb(db), ANNOTATION_ROOM: asRoom(room) },
      testCtx,
    );
    expect(res.status).toBe(200);
    expect(await res.json<{ released: boolean }>()).toEqual({ released: true });
    expect(room.pings).toEqual(['abc']);
  });

  test('a no-op release (not the owner) does not ping the room', async () => {
    const db = fakeDb({ firstQueue: [sessionRow], changes: 0 });
    const res = await auth.request(
      '/links/abc',
      { method: 'DELETE', headers: { Cookie: cookie } },
      { DB: asDb(db), ANNOTATION_ROOM: asRoom(room) },
      testCtx,
    );
    expect(await res.json<{ released: boolean }>()).toEqual({ released: false });
    expect(room.pings).toEqual([]);
  });
});
