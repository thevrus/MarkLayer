import type { Database } from 'bun:sqlite';
import { beforeEach, describe, expect, test } from 'bun:test';
import { fakeDb, migratedSqlite, SqliteD1 } from '../test-d1';
import { auth } from './routes';
import { folderStore, ownedStore } from './store';

describe('folders are owner-scoped', () => {
  let sqlite: Database;
  let db: D1Database;
  beforeEach(() => {
    sqlite = migratedSqlite();
    sqlite.exec(
      "INSERT INTO annotations (id, ops, owner_id, access) VALUES ('mine', '[]', 'alice', 'edit'), ('theirs', '[]', 'bob', 'edit')",
    );
    db = new SqliteD1(sqlite);
  });

  const folderOf = (id: string) => sqlite.query('SELECT folder_id FROM annotations WHERE id = ?').get(id);

  test('listing shows only the session owner folders', async () => {
    await folderStore(db).create({ ownerId: 'alice', name: 'Work' });
    await folderStore(db).create({ ownerId: 'bob', name: 'Secret' });
    expect((await folderStore(db).list('alice')).map((f) => f.name)).toEqual(['Work']);
  });

  test('another owner can neither rename nor delete a folder', async () => {
    const { id } = await folderStore(db).create({ ownerId: 'alice', name: 'Work' });
    expect(await folderStore(db).rename({ id, ownerId: 'bob', name: 'Mine now' })).toBe(false);
    expect(await folderStore(db).remove({ id, ownerId: 'bob' })).toBe(false);
    expect((await folderStore(db).list('alice')).map((f) => f.name)).toEqual(['Work']);
  });

  test('a link cannot be filed into another owner folder, nor moved by a non-owner', async () => {
    const { id: aliceFolder } = await folderStore(db).create({ ownerId: 'alice', name: 'Work' });
    const owned = ownedStore(db);
    expect(await owned.moveAnnotation({ id: 'theirs', ownerId: 'bob', folderId: aliceFolder })).toBe(false);
    expect(await owned.moveAnnotation({ id: 'theirs', ownerId: 'alice', folderId: aliceFolder })).toBe(false);
    expect(folderOf('theirs')).toEqual({ folder_id: null });
    expect(await owned.moveAnnotation({ id: 'mine', ownerId: 'alice', folderId: aliceFolder })).toBe(true);
    expect(folderOf('mine')).toEqual({ folder_id: aliceFolder });
  });

  test('deleting a folder unfiles its links instead of deleting them', async () => {
    const { id } = await folderStore(db).create({ ownerId: 'alice', name: 'Work' });
    await ownedStore(db).moveAnnotation({ id: 'mine', ownerId: 'alice', folderId: id });
    expect(await folderStore(db).remove({ id, ownerId: 'alice' })).toBe(true);
    expect(folderOf('mine')).toEqual({ folder_id: null });
    expect((await ownedStore(db).listAnnotations('alice')).map((l) => l.folderId)).toEqual([null]);
  });
});

describe('folder routes need a session', () => {
  const routes: [string, string][] = [
    ['GET', '/folders'],
    ['POST', '/folders'],
    ['PATCH', '/folders/f1'],
    ['DELETE', '/folders/f1'],
    ['PUT', '/links/abc/folder'],
  ];
  test.each(routes)('%s %s is a 401 before the store is touched', async (method, path) => {
    const db = fakeDb();
    const res = await auth.request(
      path,
      {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: method === 'GET' || method === 'DELETE' ? undefined : '{}',
      },
      { DB: db },
    );
    expect(res.status).toBe(401);
    expect(db.calls).toHaveLength(0);
  });
});
