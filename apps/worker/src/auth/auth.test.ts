import type { Database } from 'bun:sqlite';
import { beforeEach, describe, expect, test } from 'bun:test';
import { MAX_EXPIRES_IN_SECONDS } from '../../shared/accounts';
import { nowInSeconds } from '../store';
import { insertRow, migratedSqlite, SqliteD1 } from '../test-d1';
import { FakeExecutionContext, fakeEnv } from '../test-env';
import { auth } from './routes';
import { authStore, ownedStore } from './store';
import { hashToken, mintToken } from './tokens';
import { normalizeEmail, SEEN_BUMP_SECONDS, SESSION_COOKIE } from './types';

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

let sqlite: Database;
let db: D1Database;

beforeEach(() => {
  sqlite = migratedSqlite();
  db = new SqliteD1(sqlite);
});

const room = (id: string, columns: Record<string, string | number | null>) =>
  insertRow({ sqlite, table: 'annotations', row: { id, ops: '[]', ...columns } });

/** A signed-in person, the way the sign-in path leaves them. */
async function signIn({
  userId = 'u1',
  token = 'tok',
  lastSeenAt = nowInSeconds(),
  expiresAt = nowInSeconds() + 1000,
}: {
  userId?: string;
  token?: string;
  lastSeenAt?: number | null;
  expiresAt?: number;
} = {}) {
  insertRow({ sqlite, table: 'users', row: { id: userId, email: 'a@b.com', last_seen_at: lastSeenAt } });
  const id = await hashToken(token);
  insertRow({ sqlite, table: 'sessions', row: { id, user_id: userId, expires_at: expiresAt } });
}

const lastSeen = () => sqlite.query<{ last_seen_at: number | null }, []>('SELECT last_seen_at FROM users').get();

const link = (id: string) =>
  sqlite
    .query<{ owner_id: string | null; access: string; owner_expires_at: number | null }, [string]>(
      'SELECT owner_id, access, owner_expires_at FROM annotations WHERE id = ?',
    )
    .get(id);

describe('authStore.redeemLoginToken', () => {
  // Two tabs opening the same link: the loser must get nothing, so the guard is inside the write.
  test('a link redeems once', async () => {
    const store = authStore(db);
    await store.createLoginToken({ email: 'someone@example.com', token: 'tok' });
    expect(await store.redeemLoginToken('tok')).toBe('someone@example.com');
    expect(await store.redeemLoginToken('tok')).toBeNull();
  });

  test('an expired link redeems to nothing', async () => {
    const row = { id: await hashToken('tok'), email: 'a@b.com', expires_at: nowInSeconds() - 1 };
    insertRow({ sqlite, table: 'login_tokens', row });
    expect(await authStore(db).redeemLoginToken('tok')).toBeNull();
  });
});

describe('authStore.upsertUser', () => {
  test('signs up and signs in with one upsert, taking the id back from the row', async () => {
    const store = authStore(db);
    const first = await store.upsertUser('a@b.com');
    expect(first?.email).toBe('a@b.com');
    expect(await store.upsertUser('a@b.com')).toEqual(first);
    expect(sqlite.query('SELECT count(*) AS n FROM users').get()).toEqual({ n: 1 });
  });
});

describe('authStore.userForSession', () => {
  const now = nowInSeconds();

  test('returns null for an expired session without writing anything', async () => {
    await signIn({ lastSeenAt: 5, expiresAt: now - 1 });
    expect(await authStore(db).userForSession('tok')).toBeNull();
    expect(lastSeen()?.last_seen_at).toBe(5);
  });

  // The column is the only record of a return visit: a 30-day cookie means a
  // person can use this for a month without the sign-in path ever running again.
  test('refreshes last_seen_at when it is older than the bump window', async () => {
    await signIn({ lastSeenAt: now - SEEN_BUMP_SECONDS - 60 });
    expect(await authStore(db).userForSession('tok')).toEqual({ id: 'u1', email: 'a@b.com' });
    expect(lastSeen()?.last_seen_at).toBeGreaterThanOrEqual(now);
  });

  test('leaves it alone within the window, so an active session costs no write', async () => {
    await signIn({ lastSeenAt: now - 60 });
    expect(await authStore(db).userForSession('tok')).not.toBeNull();
    expect(lastSeen()?.last_seen_at).toBe(now - 60);
  });

  // Rows predating the column's upkeep have it NULL; those are exactly the ones
  // that most need a first real timestamp, not a crash or a skipped write.
  test('treats a null last_seen_at as due for a refresh', async () => {
    await signIn({ lastSeenAt: null });
    await authStore(db).userForSession('tok');
    expect(lastSeen()?.last_seen_at).toBeGreaterThanOrEqual(now);
  });
});

describe('authStore.throttleSeconds', () => {
  test('allows the first request for an address', async () => {
    expect(await authStore(db).throttleSeconds('a@b.com')).toBe(0);
  });

  test('reports the remaining wait while a fresh link is outstanding', async () => {
    const row = { id: 'x', email: 'a@b.com', created_at: nowInSeconds() - 20, expires_at: nowInSeconds() + 600 };
    insertRow({ sqlite, table: 'login_tokens', row });
    const wait = await authStore(db).throttleSeconds('a@b.com');
    expect(wait).toBeGreaterThan(0);
    expect(wait).toBeLessThanOrEqual(40);
  });
});

describe('ownedStore.claimAnnotation', () => {
  test('only claims a link nobody owns', async () => {
    room('abc', { owner_id: null });
    expect(await ownedStore(db).claimAnnotation({ id: 'abc', ownerId: 'u1' })).toBe(true);
    expect(await ownedStore(db).claimAnnotation({ id: 'abc', ownerId: 'u2' })).toBe(false);
    expect(link('abc')?.owner_id).toBe('u1');
  });
});

describe('ownedStore.releaseAnnotationGen', () => {
  // The bug this guards: release used to clear only owner_id, so a link left
  // view-only had no owner left to ever flip it back — permanently locked.
  test('also resets access and the owner expiry, not just owner_id', async () => {
    room('abc', { owner_id: 'u1', access: 'view', owner_expires_at: 999, password_gen: 1 });
    expect(await ownedStore(db).releaseAnnotationGen({ id: 'abc', ownerId: 'u1' })).toEqual({ gen: 2 });
    expect(link('abc')).toEqual({ owner_id: null, access: 'edit', owner_expires_at: null });
  });

  test('reports failure when the session does not own the link', async () => {
    room('abc', { owner_id: 'u2', access: 'view' });
    expect(await ownedStore(db).releaseAnnotationGen({ id: 'abc', ownerId: 'u1' })).toBeNull();
    expect(link('abc')).toEqual({ owner_id: 'u2', access: 'view', owner_expires_at: null });
  });
});

/** The slice of the room namespace the settings route touches: it records which room ids it was told to refresh. */
function fakeRoom() {
  const pings: string[] = [];
  return {
    pings,
    idFromName: (name: string) => name,
    get: (id: string) => ({
      refreshAccess: async () => void pings.push(id),
      revoke: async () => undefined,
    }),
  };
}

/** The route hands the room ping to `waitUntil`; nothing here needs to await it. */
const testCtx = new FakeExecutionContext();

describe('PATCH /links/:id', () => {
  const namespace = fakeRoom();
  const EXPIRES = nowInSeconds() + 5000;
  const jsonHeaders = { Cookie: `${SESSION_COOKIE}=tok`, 'Content-Type': 'application/json' };
  beforeEach(async () => {
    namespace.pings.length = 0;
    await signIn({ userId: 'owner1' });
  });
  const patch = ({ body, headers = jsonHeaders }: { body: unknown; headers?: Record<string, string> }) =>
    auth.request(
      '/links/abc',
      { method: 'PATCH', headers, body: JSON.stringify(body) },
      { DB: db, ANNOTATION_ROOM: namespace },
      testCtx,
    );

  test('the owner flips access, and what the body left out stays', async () => {
    room('abc', { owner_id: 'owner1', access: 'edit', owner_expires_at: EXPIRES });
    const res = await patch({ body: { access: 'view' } });
    expect(res.status).toBe(200);
    expect(await res.json<{ updated: boolean }>()).toEqual({ updated: true });
    expect(link('abc')).toEqual({ owner_id: 'owner1', access: 'view', owner_expires_at: EXPIRES });
    // The warm room hears about it, so the flip bites before the next eviction.
    expect(namespace.pings).toEqual(['abc']);
  });

  test('a signed-in non-owner gets updated: false and nothing changes', async () => {
    room('abc', { owner_id: 'someone-else', access: 'edit' });
    const res = await patch({ body: { access: 'view' } });
    expect(res.status).toBe(200);
    expect(await res.json<{ updated: boolean }>()).toEqual({ updated: false });
    expect(link('abc')?.access).toBe('edit');
    expect(namespace.pings).toEqual([]);
  });

  test('an unauthenticated request is rejected and nothing changes', async () => {
    room('abc', { owner_id: 'owner1', access: 'edit' });
    const res = await patch({ body: { access: 'view' }, headers: { 'Content-Type': 'application/json' } });
    expect(res.status).toBe(401);
    expect(link('abc')?.access).toBe('edit');
  });

  test('an ownerExpiresIn past the ceiling is a 400 and nothing changes', async () => {
    room('abc', { owner_id: 'owner1', owner_expires_at: EXPIRES });
    const res = await patch({ body: { ownerExpiresIn: MAX_EXPIRES_IN_SECONDS + 1 } });
    expect(res.status).toBe(400);
    expect(link('abc')?.owner_expires_at).toBe(EXPIRES);
  });

  test('ownerExpiresIn: null clears the owner expiry and leaves access alone', async () => {
    room('abc', { owner_id: 'owner1', access: 'view', owner_expires_at: EXPIRES });
    const res = await patch({ body: { ownerExpiresIn: null } });
    expect(res.status).toBe(200);
    expect(await res.json<{ updated: boolean }>()).toEqual({ updated: true });
    expect(link('abc')).toEqual({ owner_id: 'owner1', access: 'view', owner_expires_at: null });
  });
});

describe('DELETE /links/:id', () => {
  const namespace = fakeRoom();
  beforeEach(async () => {
    namespace.pings.length = 0;
    await signIn({ userId: 'owner1' });
  });
  const release = () =>
    auth.request(
      '/links/abc',
      { method: 'DELETE', headers: { Cookie: `${SESSION_COOKIE}=tok` } },
      { DB: db, ANNOTATION_ROOM: namespace },
      testCtx,
    );

  test('releasing pings the warm room, so a cached view-only lock lifts immediately', async () => {
    room('abc', { owner_id: 'owner1', access: 'view' });
    const res = await release();
    expect(res.status).toBe(200);
    expect(await res.json<{ released: boolean }>()).toEqual({ released: true });
    expect(namespace.pings).toEqual(['abc']);
  });

  test('a no-op release (not the owner) does not ping the room', async () => {
    room('abc', { owner_id: 'someone-else', access: 'view' });
    const res = await release();
    expect(await res.json<{ released: boolean }>()).toEqual({ released: false });
    expect(namespace.pings).toEqual([]);
  });
});

describe('/verify', () => {
  const token = mintToken();
  const origin = 'http://localhost';
  const post = (body: string, headers: Record<string, string> = {}) => ({
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: origin, ...headers },
    body,
  });
  const unspent = async () => (await authStore(db).throttleSeconds('someone@example.com')) > 0;

  beforeEach(() => authStore(db).createLoginToken({ email: 'someone@example.com', token }));

  test('GET leaves the token unspent, so a mail scanner opening the link cannot burn it', async () => {
    const res = await auth.request(`/verify?token=${token}`, {}, fakeEnv({ DB: db }), testCtx);
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(await unspent()).toBe(true);
    expect(await res.text()).toContain(`value="${token}"`);
  });

  test('GET with a token that is not one of ours never echoes it into the page', async () => {
    const res = await auth.request('/verify?token="><script>x</script>', {}, fakeEnv({ DB: db }), testCtx);
    expect(res.status).toBe(400);
    expect(await res.text()).not.toContain('<script>x');
  });

  test('POST spends the token, sets the session and leaves for the app', async () => {
    const res = await auth.request('/verify', post(`token=${token}`), fakeEnv({ DB: db }), testCtx);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/app');
    expect(res.headers.get('set-cookie')).toContain(`${SESSION_COOKIE}=`);
    expect(await unspent()).toBe(false);
  });

  test('POST with a spent token explains instead of landing signed out', async () => {
    await auth.request('/verify', post(`token=${token}`), fakeEnv({ DB: db }), testCtx);
    const res = await auth.request('/verify', post(`token=${token}`), fakeEnv({ DB: db }), testCtx);
    expect(res.status).toBe(400);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  test('POST from another origin is refused before the token is touched', async () => {
    const res = await auth.request(
      '/verify',
      post(`token=${token}`, { Origin: 'https://evil.example' }),
      fakeEnv({ DB: db }),
      testCtx,
    );
    expect(res.status).toBe(403);
    expect(await unspent()).toBe(true);
  });
});
