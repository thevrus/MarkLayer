import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { migratedSqlite } from './test-d1';

const migration = readFileSync(new URL('../migrations/0015_layers_and_agent_tasks.sql', import.meta.url), 'utf8');

test('existing rooms receive a default layer without changing their annotations', () => {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE annotations (id TEXT PRIMARY KEY, ops TEXT NOT NULL)');
  db.query('INSERT INTO annotations (id, ops) VALUES (?, ?)').run('old', '[{"id":"mark"}]');
  db.exec(migration);
  expect(db.query('SELECT id, name FROM room_layers WHERE room_id = ?').all('old')).toEqual([{ id: 'default', name: '默认图层' }]);
  expect(db.query('SELECT ops FROM annotations WHERE id = ?').get('old')).toEqual({ ops: '[{"id":"mark"}]' });
  db.close();
});

test('task storage enforces one active task per AI while allowing queued tasks', () => {
  const db = migratedSqlite();
  db.query('INSERT INTO annotations (id, ops) VALUES (?, ?)').run('r', '[]');
  expect(db.query("SELECT id FROM room_layers WHERE room_id = 'r'").get()).toEqual({ id: 'default' });
  const insert = db.query(`INSERT INTO room_tasks (id, room_id, agent_id, requester_id, requester_name, layer_id, annotation_id, source_id, status)
    VALUES (?, 'r', 'ai', 'u', 'user', 'default', 'a', ?, ?)`);
  insert.run('one', 'source1', 'running');
  insert.run('two', 'source2', 'queued');
  expect(() => db.query("UPDATE room_tasks SET status = 'waiting' WHERE id = 'two'").run()).toThrow();
  db.query("UPDATE room_tasks SET status = 'completed' WHERE id = 'one'").run();
  expect(() => db.query("UPDATE room_tasks SET status = 'running' WHERE id = 'two'").run()).not.toThrow();
  db.close();
});

test('deleting and recreating a room does not keep its previous layers or claims', () => {
  const db = migratedSqlite();
  db.query("INSERT INTO annotations (id, ops) VALUES ('r', '[]')").run();
  db.query("INSERT INTO room_layers (room_id, id, name) VALUES ('r', 'old', '旧图层')").run();
  db.query("INSERT INTO room_agent_claims (room_id, agent_id, owner_id, owner_name) VALUES ('r', 'ai', 'u', 'user')").run();
  db.query("DELETE FROM annotations WHERE id = 'r'").run();
  db.query("INSERT INTO annotations (id, ops) VALUES ('r', '[]')").run();
  expect(db.query("SELECT id FROM room_layers WHERE room_id = 'r'").all()).toEqual([{ id: 'default' }]);
  expect(db.query("SELECT agent_id FROM room_agent_claims WHERE room_id = 'r'").all()).toEqual([]);
  db.close();
});
