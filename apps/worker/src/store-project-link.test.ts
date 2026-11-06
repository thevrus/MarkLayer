import { Database } from 'bun:sqlite';
import { beforeEach, describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { annotationStore } from './store';
import { SqliteD1 } from './test-d1';

// The link guard lives in SQL, which the recording fake in test-d1.ts cannot run, so these use real SQLite.
const MIGRATIONS = join(import.meta.dir, '../migrations');

let sqlite: Database;
let store: ReturnType<typeof annotationStore>;

function migrate({ from = '', through }: { from?: string; through: string }) {
  for (const file of readdirSync(MIGRATIONS).sort()) {
    if (file < from) continue;
    if (file > through) break;
    sqlite.exec(readFileSync(join(MIGRATIONS, file), 'utf8'));
  }
}

function room({ id, access = 'edit', password }: { id: string; access?: string; password?: string }) {
  sqlite
    .query('INSERT INTO annotations (id, ops, access, password_hash) VALUES (?, ?, ?, ?)')
    .run(id, '[]', access, password ?? null);
}

function project({
  id,
  pageIds,
  createdAt,
  expiresAt,
}: {
  id: string;
  pageIds: string[];
  createdAt: number;
  expiresAt?: number;
}) {
  sqlite
    .query('INSERT INTO projects (id, page_ids, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .run(id, JSON.stringify(pageIds), createdAt, expiresAt ?? null);
}

const pointer = (id: string) =>
  sqlite.query<{ project_id: string | null }, [string]>('SELECT project_id FROM annotations WHERE id = ?').get(id)
    ?.project_id;

beforeEach(() => {
  sqlite = new Database(':memory:');
  store = annotationStore(new SqliteD1(sqlite));
});

describe('linkProject', () => {
  beforeEach(() => migrate({ through: '9999' }));

  // Anyone holding an id may bundle it, so a link only its owner may edit must never be re-pointed.
  test('links only open, unprotected, unlinked rooms', async () => {
    room({ id: 'open' });
    room({ id: 'view', access: 'view' });
    room({ id: 'locked', password: 'pbkdf2-sha256$1$s$k' });
    room({ id: 'taken' });
    await store.linkProject({ projectId: 'first', pageIds: ['taken'] });

    await store.linkProject({ projectId: 'p', pageIds: ['open', 'view', 'locked', 'taken'] });

    expect([pointer('open'), pointer('view'), pointer('locked'), pointer('taken')]).toEqual(['p', null, null, 'first']);
  });
});

describe('getPromotion', () => {
  beforeEach(() => migrate({ through: '9999' }));

  test('stops redirecting once the owner makes the link view-only', async () => {
    room({ id: 'a' });
    project({ id: 'p', pageIds: ['a'], createdAt: 1 });
    await store.linkProject({ projectId: 'p', pageIds: ['a'] });
    expect(await store.getPromotion('a')).toEqual({ projectId: 'p', pageIds: ['a'], expiresAt: null });

    sqlite.query("UPDATE annotations SET access = 'view' WHERE id = 'a'").run();
    expect(await store.getPromotion('a')).toBeNull();
  });
});

describe('migration 0013 backfill', () => {
  test('points each open room at its oldest live project', () => {
    migrate({ through: '0012_add_folders.sql' });
    room({ id: 'a' });
    room({ id: 'v', access: 'view' });
    project({ id: 'expired', pageIds: ['a', 'v'], createdAt: 1, expiresAt: 2 });
    project({ id: 'older', pageIds: ['a', 'v'], createdAt: 10 });
    project({ id: 'newer', pageIds: ['a'], createdAt: 20 });

    migrate({ from: '0013', through: '0013_add_annotation_project.sql' });

    expect([pointer('a'), pointer('v')]).toEqual(['older', null]);
  });
});
