import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { migratedSqlite } from './test-d1';

test('execution mode migration preserves existing rooms and defaults to pair', () => {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE annotations (id TEXT PRIMARY KEY)');
  db.exec("INSERT INTO annotations (id) VALUES ('existing')");
  db.exec(readFileSync(new URL('../migrations/0014_add_exec_mode.sql', import.meta.url), 'utf8'));
  db.exec("INSERT INTO annotations (id) VALUES ('new')");
  expect(db.query('SELECT exec_mode FROM annotations ORDER BY id').all()).toEqual([
    { exec_mode: 'pair' },
    { exec_mode: 'pair' },
  ]);
  db.exec("UPDATE annotations SET exec_mode = 'guide' WHERE id = 'existing'");
  expect(() => db.exec("UPDATE annotations SET exec_mode = 'other'")).toThrow();
  db.close();
});

test('all migrations include the execution mode column', () => {
  const db = migratedSqlite();
  db.exec("INSERT INTO annotations (id, ops) VALUES ('room', '[]')");
  expect(db.query('SELECT exec_mode FROM annotations').get()).toEqual({ exec_mode: 'pair' });
  db.close();
});
