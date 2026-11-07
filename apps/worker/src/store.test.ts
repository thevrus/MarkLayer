import type { Database } from 'bun:sqlite';
import { beforeEach, describe, expect, test } from 'bun:test';
import { annotationStore, isExpired, nowInSeconds, projectStore } from './store';
import { insertRow, migratedSqlite, SqliteD1 } from './test-d1';

const WEAK = 'abc';
const STRONG = 'dsWPMrdw6EZ8jkkhxvFKS';

let sqlite: Database;
let annotations: ReturnType<typeof annotationStore>;
let projects: ReturnType<typeof projectStore>;

beforeEach(() => {
  sqlite = migratedSqlite();
  const db = new SqliteD1(sqlite);
  annotations = annotationStore(db);
  projects = projectStore(db);
});

const room = (id: string, columns: Record<string, string | number | null> = {}) =>
  insertRow({ sqlite, table: 'annotations', row: { id, ops: '[]', ...columns } });

const rowCount = (table: 'annotations' | 'projects') =>
  sqlite.query<{ n: number }, []>(`SELECT count(*) AS n FROM ${table}`).get()?.n;

describe('annotationStore.get', () => {
  test('parses the ops column and maps the row to camelCase', async () => {
    room('abc', {
      ops: '[{"tool":"comment"}]',
      url: 'https://example.com',
      width: 1280,
      created_at: 10,
      access: 'view',
      owner_id: 'u1',
      owner_expires_at: 999,
    });
    expect(await annotations.get('abc')).toEqual({
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
    expect(await annotations.get('nope')).toBeNull();
  });

  test('falls back to edit access for a value it cannot read', async () => {
    room('abc', { access: 'garbage' });
    expect((await annotations.get('abc'))?.access).toBe('edit');
  });

  // Two call sites used to JSON.parse this unguarded, so a corrupt row was a 500.
  test('degrades a corrupt ops column to an empty list instead of throwing', async () => {
    room('abc', { ops: '{not json' });
    expect((await annotations.get('abc'))?.ops).toEqual([]);
  });

  test('degrades a non-array ops column to an empty list', async () => {
    room('abc', { ops: '{"tool":"comment"}' });
    expect((await annotations.get('abc'))?.ops).toEqual([]);
  });
});

describe('projectStore.get', () => {
  const project = (pageIds: string) => insertRow({ sqlite, table: 'projects', row: { id: 'p1', page_ids: pageIds } });

  test('parses page ids and drops non-string entries', async () => {
    project('["a",2,"b",null]');
    expect((await projects.get('p1'))?.pageIds).toEqual(['a', 'b']);
  });

  test('degrades a corrupt page_ids column to an empty list', async () => {
    project('nonsense');
    expect((await projects.get('p1'))?.pageIds).toEqual([]);
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

describe('annotationStore.deleteExpired', () => {
  const CUTOFF = 100;
  const IDLE = CUTOFF - 1;
  const RECENT = CUTOFF + 1;
  const left = () => sqlite.query<{ id: string }, []>('SELECT id FROM annotations ORDER BY id').all();

  // This guard is the whole point of signing in: lose it and a kept link is swept
  // 90 days later while the dashboard promises it will not be.
  test('the idle window takes only a link nobody claimed', async () => {
    room('idle', { last_accessed_at: IDLE });
    room('kept', { last_accessed_at: IDLE, owner_id: 'u1' });
    room('recent', { last_accessed_at: RECENT });
    expect(await annotations.deleteExpired({ unusedSince: CUTOFF })).toEqual(['idle']);
    expect(left()).toEqual([{ id: 'kept' }, { id: 'recent' }]);
  });

  // Keeping a link exempts it from the idle clock, never from a deadline that was actually set on it.
  test('an expiry someone chose still deletes, owner or not', async () => {
    const past = nowInSeconds() - 60;
    const future = nowInSeconds() + 60;
    room('link-expired', { last_accessed_at: RECENT, owner_id: 'u1', expires_at: past });
    room('owner-expired', { last_accessed_at: RECENT, owner_id: 'u1', owner_expires_at: past });
    room('still-due', { last_accessed_at: RECENT, owner_id: 'u1', expires_at: future, owner_expires_at: future });
    expect((await annotations.deleteExpired({ unusedSince: CUTOFF })).sort()).toEqual([
      'link-expired',
      'owner-expired',
    ]);
    expect(left()).toEqual([{ id: 'still-due' }]);
  });
});

describe('projectStore.deleteExpired', () => {
  const CUTOFF = 1_000_000;

  test('a project whose claimed page was view-only when bundled keeps its idle exemption', async () => {
    const sqlite = migratedSqlite();
    const claimed = { id: 'p1', ops: '[]', access: 'view', owner_id: 'u1', last_accessed_at: CUTOFF + 1 };
    insertRow({ sqlite, table: 'users', row: { id: 'u1', email: 'o@x' } });
    insertRow({ sqlite, table: 'annotations', row: claimed });
    const row = { id: 'proj', page_ids: '["p1"]', created_at: 1, last_accessed_at: 1 };
    insertRow({ sqlite, table: 'projects', row });
    insertRow({ sqlite, table: 'projects', row: { ...row, id: 'idle', page_ids: '[]' } });
    expect(await projectStore(new SqliteD1(sqlite)).deleteExpired({ unusedSince: CUTOFF })).toEqual(['idle']);
  });
});

describe('the share-id entropy floor', () => {
  const row = { ops: [], url: null, width: null, expiresAt: null };

  test('putOps never inserts: a row that is not there was deleted, and a flush must not bring it back', async () => {
    expect(await annotations.putOps({ id: STRONG, ops: [] })).toBe('gone');
    expect(rowCount('annotations')).toBe(0);
  });

  test('putOps updates a room that exists, whatever its id looks like', async () => {
    room(WEAK);
    expect(await annotations.putOps({ id: WEAK, ops: [{ tool: 'pen' }] })).toBe('written');
    expect(await annotations.getOps(WEAK)).toEqual([{ tool: 'pen' }]);
  });

  // The floor lives here, not in the routes: the room's flush and the REST save
  // both mint through `create`, and a route-only check missed the realtime path.
  test('create mints only at a well-formed id', async () => {
    expect(await annotations.create({ id: STRONG, ...row })).toBe(true);
    expect(await annotations.exists(STRONG)).toBe(true);
    expect(await annotations.create({ id: WEAK, ...row })).toBe(false);
    expect(await annotations.exists(WEAK)).toBe(false);
  });

  test('projectStore.put holds the same line', async () => {
    expect(await projects.put({ id: WEAK, pageIds: ['a'], expiresAt: null })).toBe(false);
    expect(rowCount('projects')).toBe(0);
    expect(await projects.put({ id: STRONG, pageIds: ['a'], expiresAt: null })).toBe(true);
    expect((await projects.get(STRONG))?.pageIds).toEqual(['a']);
  });
});

describe('annotationStore.createPreview', () => {
  const preview = {
    url: 'https://p.example.com',
    title: 'Hero',
    note: null,
    repo: 'acme/web',
    branch: 'main',
    sha: null,
  };

  // The chain is what exposes a room's neighbours, so naming a room is not enough: it must be the same branch.
  test('chains to the named room only when its repo and branch match', async () => {
    room('same', { repo: 'acme/web', branch: 'main', version: 2 });
    room('other', { repo: 'acme/web', branch: 'feature', version: 2 });

    expect(await annotations.createPreview({ id: STRONG, ops: [], preview, previousId: 'same' })).toEqual({
      created: true,
      version: 3,
      previousId: 'same',
    });
    expect(
      await annotations.createPreview({ id: 'xxWPMrdw6EZ8jkkhxvFKS', ops: [], preview, previousId: 'other' }),
    ).toEqual({ created: true, version: 1, previousId: null });
  });

  test('never overwrites a room that already holds the id', async () => {
    room(STRONG, { ops: '[{"id":"theirs"}]' });
    expect(await annotations.createPreview({ id: STRONG, ops: [], preview, previousId: null })).toEqual({
      created: false,
      reason: 'taken',
    });
    expect(await annotations.getOps(STRONG)).toEqual([{ id: 'theirs' }]);
  });
});
