-- Ownership is a nullable back-reference rather than a join table: a link
-- has at most one owner, and an unclaimed link keeps NULL forever without a
-- row anywhere.
ALTER TABLE annotations ADD COLUMN owner_id TEXT DEFAULT NULL;
ALTER TABLE projects ADD COLUMN owner_id TEXT DEFAULT NULL;
CREATE INDEX IF NOT EXISTS annotations_owner_idx ON annotations(owner_id);
CREATE INDEX IF NOT EXISTS projects_owner_idx ON projects(owner_id);
