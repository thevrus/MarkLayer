-- projects never grew the per-link ownership feature annotations got: no
-- route or store reads or writes projects.owner_id (see auth/store.ts,
-- api.ts). It and its index only exist because 0004 added ownership to both
-- tables at once. Drop the index first — SQLite refuses DROP COLUMN on a
-- column an index still references (requires SQLite 3.35+; D1 supports it).
DROP INDEX IF EXISTS projects_owner_idx;
ALTER TABLE projects DROP COLUMN owner_id;
