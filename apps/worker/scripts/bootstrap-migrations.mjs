#!/usr/bin/env node
/**
 * One-time bridge from the old hand-run schema to `wrangler d1 migrations`.
 *
 * The remote DB predates migrations/: its columns were added by hand with
 * `d1 execute --remote` (schema.sql, now deleted, recorded `integrations` as
 * applied on 2026-09-03 and carried copy-paste instructions for `owner_id`).
 * It has never had wrangler's `d1_migrations` bookkeeping table, so a first
 * `migrations apply --remote` would treat every file as unapplied and abort on
 * 0002 with "duplicate column name" — SQLite has no `ADD COLUMN IF NOT EXISTS`,
 * so only 0001 is safe to re-run.
 *
 * This inspects what the database actually has and marks exactly the migrations
 * already satisfied, so `migrations apply` afterwards runs only the real
 * remainder. It reads the schema rather than trusting those dates, because
 * whether `owner_id` was ever applied is not recorded anywhere.
 *
 * Prints a plan and exits; pass --apply to write. Safe to re-run: inserts are
 * `INSERT OR IGNORE` on a UNIQUE name.
 *
 *   node scripts/bootstrap-migrations.mjs                    # dry run, --local
 *   node scripts/bootstrap-migrations.mjs --remote            # dry run against prod
 *   node scripts/bootstrap-migrations.mjs --remote --apply    # write
 *
 * Note the two names for one database: `d1 execute` needs Cloudflare's
 * registered name (`annotateweb`), while `d1 migrations` resolves
 * `database_name` from wrangler.jsonc (`marklayer`). This script calls
 * `d1 execute`, so it defaults to the registered name; override with --db.
 */

import { execFileSync } from 'node:child_process';

const argv = process.argv.slice(2);
const remote = argv.includes('--remote');
const apply = argv.includes('--apply');
const dbArg = argv.indexOf('--db');
const db = dbArg !== -1 ? argv[dbArg + 1] : remote ? 'annotateweb' : 'marklayer';

/** `d1 execute --json`, returning the first statement's rows. */
function query(sql) {
  const out = execFileSync(
    'bunx',
    ['wrangler', 'd1', 'execute', db, remote ? '--remote' : '--local', '--json', '--command', sql],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
  );
  // wrangler prints its banner before the JSON on some versions.
  const start = out.indexOf('[');
  if (start === -1) throw new Error(`no JSON in wrangler output:\n${out}`);
  return JSON.parse(out.slice(start))[0]?.results ?? [];
}

const tables = new Set(query("SELECT name FROM sqlite_master WHERE type='table'").map((r) => r.name));
const columnsOf = (table) => new Set(tables.has(table) ? query(`PRAGMA table_info(${table})`).map((r) => r.name) : []);
const annotations = columnsOf('annotations');
const projects = columnsOf('projects');

/**
 * What each migration leaves behind, so "already applied" is decided by the
 * schema rather than by a changelog nobody kept. 0006 is the odd one: it
 * *removes* a column, so its evidence is an absence — and only counts once
 * `projects` exists at all, or an empty database would look like it had run.
 */
const SATISFIED = [
  ['0001_initial_schema.sql', () => tables.has('annotations') && tables.has('projects') && tables.has('uploads')],
  ['0002_add_annotation_integrations.sql', () => annotations.has('integrations')],
  ['0003_add_identity_tables.sql', () => tables.has('users') && tables.has('sessions') && tables.has('login_tokens')],
  ['0004_add_owner_columns.sql', () => annotations.has('owner_id')],
  ['0005_add_link_access_columns.sql', () => annotations.has('access') && annotations.has('owner_expires_at')],
  ['0006_drop_projects_owner_id.sql', () => tables.has('projects') && !projects.has('owner_id')],
];

const recorded = new Set(tables.has('d1_migrations') ? query('SELECT name FROM d1_migrations').map((r) => r.name) : []);

const toRecord = [];
console.log(`\n${db} (${remote ? 'remote' : 'local'})\n`);
for (const [name, isSatisfied] of SATISFIED) {
  const satisfied = isSatisfied();
  const already = recorded.has(name);
  const state = already ? 'recorded' : satisfied ? 'NEEDS RECORDING' : 'not applied';
  console.log(`  ${name.padEnd(40)} ${state}`);
  if (satisfied && !already) toRecord.push(name);
}

/**
 * A gap means the schema went backwards: an earlier migration looks unapplied
 * while a later one looks applied. Recording only the later ones would leave
 * `migrations apply` to run the earlier file against a database that has moved
 * past it, so stop and let a person look.
 */
const satisfiedFlags = SATISFIED.map(([name, f]) => f() || recorded.has(name));
const lastSatisfied = satisfiedFlags.lastIndexOf(true);
if (satisfiedFlags.slice(0, lastSatisfied).some((v) => !v)) {
  console.error('\nRefusing to act: an earlier migration looks unapplied while a later one looks applied.');
  console.error('Inspect the schema by hand before recording anything.\n');
  process.exit(1);
}

if (toRecord.length === 0) {
  console.log('\nNothing to record. `wrangler d1 migrations apply` is safe to run.\n');
  process.exit(0);
}

const statements = [
  'CREATE TABLE IF NOT EXISTS d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)',
  ...toRecord.map((name) => `INSERT OR IGNORE INTO d1_migrations (name) VALUES ('${name}')`),
];

console.log(`\n${apply ? 'Applying' : 'Would apply'}:\n`);
for (const sql of statements) console.log(`  ${sql};`);

if (!apply) {
  console.log('\nDry run. Re-run with --apply to write.\n');
  process.exit(0);
}

for (const sql of statements) query(sql);
console.log(`\nRecorded ${toRecord.length} migration(s). Now run:`);
console.log(`  bunx wrangler d1 migrations apply marklayer ${remote ? '--remote' : '--local'}\n`);
