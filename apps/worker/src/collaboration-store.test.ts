import { beforeEach, expect, test } from 'bun:test';
import { collaborationStore, type RoomTask } from './collaboration-store';
import { migratedSqlite, SqliteD1 } from './test-d1';

let sqlite: ReturnType<typeof migratedSqlite>;
let store: ReturnType<typeof collaborationStore>;
beforeEach(() => {
  sqlite = migratedSqlite();
  sqlite.query("INSERT INTO annotations (id, ops) VALUES ('r', '[]')").run();
  store = collaborationStore(new SqliteD1(sqlite));
});
const task = (id: string, user: string, layer = 'default'): Pick<RoomTask, 'id' | 'room_id' | 'agent_id' | 'requester_id' | 'requester_name' | 'layer_id' | 'annotation_id' | 'source_id'> => ({
  id, room_id: 'r', agent_id: 'ai', requester_id: user, requester_name: user, layer_id: layer, annotation_id: id, source_id: id,
});

test('layers persist, keep their contents and protect the default', async () => {
  expect((await store.layers('r')).map((l) => l.id)).toEqual(['default']);
  expect(await store.createLayer('r', 'review', '审查')).toBe(true);
  expect(await store.renameLayer('r', 'review', '改名')).toBe(true);
  expect(await store.deleteLayer('r', 'default')).toBe(false);
  sqlite.query('UPDATE annotations SET ops = ? WHERE id = ?').run('[{"id":"m","layerId":"review"}]', 'r');
  expect(await store.deleteLayer('r', 'review')).toBe(false);
  sqlite.query("UPDATE annotations SET ops = '[]' WHERE id = 'r'").run();
  expect(await store.enqueue(task('one', 'user', 'review'))).toBe(true);
  expect(await store.deleteLayer('r', 'review')).toBe(false);
  expect(await store.requestCancel('r', 'one')).toBe(true);
  expect(await store.deleteLayer('r', 'review')).toBe(true);
  expect(await store.enqueue(task('bad', 'user', 'review'))).toBe(false);
});

test('claims are exclusive and only the owner can release', async () => {
  expect(await store.claim('r', 'ai', 'owner', '主人')).toBe(true);
  expect(await store.claim('r', 'ai', 'other', '其他')).toBe(false);
  expect(await store.release('r', 'ai', 'other')).toBe(false);
  expect(await store.release('r', 'ai', 'owner')).toBe(true);
  expect(await store.claim('r', 'ai', 'other', '其他')).toBe(true);
});

test('owner priority only applies after the current task, waiting and cancellation block dispatch', async () => {
  await store.claim('r', 'ai', 'owner', '主人');
  await store.enqueue(task('a', 'other'));
  expect((await store.takeNext('r', 'ai'))?.id).toBe('a');
  await store.enqueue(task('b', 'other'));
  await store.enqueue(task('c', 'owner'));
  await store.enqueue(task('d', 'owner'));
  expect(await store.waitFor('r', 'ai', 'a', 'other')).toBe(true);
  expect(await store.takeNext('r', 'ai')).toBeNull();
  expect(await store.finish('r', 'ai', 'a')).toBe(false);
  expect(await store.requestCancel('r', 'a')).toBe(true);
  expect(await store.takeNext('r', 'ai')).toBeNull();
  expect(await store.confirmCancel('r', 'wrong-ai', 'a')).toBe(false);
  expect(await store.confirmCancel('r', 'ai', 'a')).toBe(true);
  expect((await store.takeNext('r', 'ai'))?.id).toBe('c');
  expect(await store.finish('r', 'ai', 'c')).toBe(true);
  expect((await store.takeNext('r', 'ai'))?.id).toBe('d');
  expect(await store.finish('r', 'ai', 'd')).toBe(true);
  expect((await store.takeNext('r', 'ai'))?.id).toBe('b');
});

test('a completed annotation can be assigned to the same agent again', async () => {
  expect(await store.enqueue(task('first', 'user'))).toBe(true);
  expect(await store.takeNext('r', 'ai')).not.toBeNull();
  expect(await store.finish('r', 'ai', 'first')).toBe(true);
  expect(await store.enqueue({ ...task('second', 'user'), source_id: 'first' })).toBe(true);
  expect((await store.takeNext('r', 'ai'))?.id).toBe('second');
});
