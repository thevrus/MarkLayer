import { describe, expect, test } from 'bun:test';
import { annotationStore, isExpired, projectStore } from './store';
import { asDb, fakeDb } from './test-d1';

describe('annotationStore.get', () => {
  test('parses the ops column and maps the row to camelCase', async () => {
    const db = fakeDb({
      first: {
        ops: '[{"tool":"comment"}]',
        url: 'https://example.com',
        width: 1280,
        created_at: 10,
        expires_at: null,
        access: 'view',
        owner_id: 'u1',
        owner_expires_at: 999,
      },
    });
    const row = await annotationStore(asDb(db)).get('abc');
    expect(row).toEqual({
      ops: [{ tool: 'comment' }],
      url: 'https://example.com',
      width: 1280,
      createdAt: 10,
      expiresAt: null,
      access: 'view',
      ownerId: 'u1',
      ownerExpiresAt: 999,
    });
  });

  test('returns null when the row is missing', async () => {
    expect(await annotationStore(asDb(fakeDb({ first: null }))).get('nope')).toBeNull();
  });

  // A row from before `access` existed has no such column at all — the same
  // shape a corrupt value would parse as, so both fall back to today's only mode.
  test('falls back to edit access for a pre-migration row with no access column', async () => {
    const db = fakeDb({
      first: {
        ops: '[]',
        url: null,
        width: null,
        created_at: null,
        expires_at: null,
        owner_id: null,
        owner_expires_at: null,
      },
    });
    const row = await annotationStore(asDb(db)).get('abc');
    expect(row?.access).toBe('edit');
    expect(row?.ownerId).toBeNull();
    expect(row?.ownerExpiresAt).toBeNull();
  });

  // Two call sites used to JSON.parse this unguarded, so a corrupt row was a 500.
  test('degrades a corrupt ops column to an empty list instead of throwing', async () => {
    const db = fakeDb({ first: { ops: '{not json', url: null, width: null, created_at: null, expires_at: null } });
    const row = await annotationStore(asDb(db)).get('abc');
    expect(row?.ops).toEqual([]);
  });

  test('degrades a non-array ops column to an empty list', async () => {
    const db = fakeDb({
      first: { ops: '{"tool":"comment"}', url: null, width: null, created_at: null, expires_at: null },
    });
    expect((await annotationStore(asDb(db)).get('abc'))?.ops).toEqual([]);
  });
});

describe('annotationStore.getMany', () => {
  test('does not query at all for an empty id list', async () => {
    const db = fakeDb();
    expect((await annotationStore(asDb(db)).getMany([])).size).toBe(0);
    expect(db.calls).toHaveLength(0);
  });

  test('binds one placeholder per id and keys the result by id', async () => {
    const db = fakeDb({ all: [{ id: 'b', ops: '[]', url: null, width: null }] });
    const found = await annotationStore(asDb(db)).getMany(['a', 'b']);
    expect(db.calls[0]?.sql).toContain('IN (?,?)');
    expect(db.calls[0]?.bindings).toEqual(['a', 'b']);
    expect(found.has('b')).toBe(true);
    // 'a' has no row — absent rather than a null entry, so callers can fill the gap.
    expect(found.has('a')).toBe(false);
  });
});

describe('projectStore.get', () => {
  test('parses page ids and drops non-string entries', async () => {
    const db = fakeDb({ first: { page_ids: '["a",2,"b",null]', created_at: 5, expires_at: null } });
    expect((await projectStore(asDb(db)).get('p1'))?.pageIds).toEqual(['a', 'b']);
  });

  test('degrades a corrupt page_ids column to an empty list', async () => {
    const db = fakeDb({ first: { page_ids: 'nonsense', created_at: null, expires_at: null } });
    expect((await projectStore(asDb(db)).get('p1'))?.pageIds).toEqual([]);
  });
});

describe('isExpired', () => {
  test('a null expiry never expires', () => {
    expect(isExpired(null)).toBe(false);
  });

  test('a past expiry is expired and a future one is not', () => {
    const now = Math.floor(Date.now() / 1000);
    expect(isExpired(now - 60)).toBe(true);
    expect(isExpired(now + 60)).toBe(false);
  });
});

describe('the share-id entropy floor', () => {
  // The floor lives here, not in the routes: `putOps` (realtime) and the MCP
  // bridge reach this same layer, and a route-only check missed both.
  const WEAK = 'abc';
  const STRONG = 'dsWPMrdw6EZ8jkkhxvFKS';
  const sql = (db: ReturnType<typeof fakeDb>) => db.calls.map((call) => call.sql).join(' ');

  test('putOps never inserts at an id short enough to guess', async () => {
    const db = fakeDb({ changes: 0 });
    expect(await annotationStore(asDb(db)).putOps({ id: WEAK, ops: [] })).toBe(false);
    expect(sql(db)).not.toContain('INSERT');
  });

  test('putOps still updates a room that already exists at a short id', async () => {
    const db = fakeDb({ changes: 1 });
    expect(await annotationStore(asDb(db)).putOps({ id: WEAK, ops: [] })).toBe(true);
    expect(sql(db)).toContain('UPDATE annotations');
  });

  test('putOps upserts as before for a well-formed id', async () => {
    const db = fakeDb();
    expect(await annotationStore(asDb(db)).putOps({ id: STRONG, ops: [] })).toBe(true);
    expect(sql(db)).toContain('INSERT INTO annotations');
  });

  test('put and projectStore.put hold the same line', async () => {
    const row = { id: WEAK, ops: [], url: null, width: null, expiresAt: null };
    const missing = fakeDb({ changes: 0 });
    expect(await annotationStore(asDb(missing)).put(row)).toBe(false);
    expect(sql(missing)).not.toContain('INSERT');

    const project = fakeDb({ changes: 0 });
    expect(await projectStore(asDb(project)).put({ id: WEAK, pageIds: ['a'], expiresAt: null })).toBe(false);
    expect(sql(project)).not.toContain('INSERT');

    const fresh = fakeDb();
    expect(await projectStore(asDb(fresh)).put({ id: STRONG, pageIds: ['a'], expiresAt: null })).toBe(true);
    expect(sql(fresh)).toContain('INSERT INTO projects');
  });
});
