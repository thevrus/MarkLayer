import { describe, expect, test } from 'bun:test';
import { annotationStore, isExpired, projectStore } from './store';

/**
 * A D1 stand-in that records the SQL it was handed and replays a queued row.
 * Enough to exercise the store's parsing and expiry rules, which is where the
 * four previous call sites disagreed; it deliberately does not model SQLite.
 */
function fakeDb({ first = null, all = [] }: { first?: unknown; all?: unknown[] } = {}) {
  const calls: { sql: string; bindings: unknown[] }[] = [];
  const db = {
    calls,
    prepare(sql: string) {
      const call = { sql, bindings: [] as unknown[] };
      calls.push(call);
      const stmt = {
        bind(...bindings: unknown[]) {
          call.bindings = bindings;
          return stmt;
        },
        first: async () => first,
        all: async () => ({ results: all }),
        run: async () => ({ success: true }),
      };
      return stmt;
    },
  };
  return db;
}

// biome-ignore lint/suspicious/noExplicitAny: the fake implements only the slice of D1 the store touches.
const asDb = (db: ReturnType<typeof fakeDb>) => db as any;

describe('annotationStore.get', () => {
  test('parses the ops column and maps the row to camelCase', async () => {
    const db = fakeDb({
      first: {
        ops: '[{"tool":"comment"}]',
        url: 'https://example.com',
        width: 1280,
        created_at: 10,
        expires_at: null,
      },
    });
    const row = await annotationStore(asDb(db)).get('abc');
    expect(row).toEqual({
      ops: [{ tool: 'comment' }],
      url: 'https://example.com',
      width: 1280,
      createdAt: 10,
      expiresAt: null,
    });
  });

  test('returns null when the row is missing', async () => {
    expect(await annotationStore(asDb(fakeDb({ first: null }))).get('nope')).toBeNull();
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
