CREATE TABLE IF NOT EXISTS annotations (
  id TEXT PRIMARY KEY,
  ops TEXT NOT NULL,
  url TEXT,
  width INTEGER,
  created_at INTEGER DEFAULT (unixepoch()),
  last_accessed_at INTEGER DEFAULT (unixepoch()),
  expires_at INTEGER DEFAULT NULL,
  -- JSON array of outbound destinations: [{provider, config}]. One column rather
  -- than one per provider, so adding Teams or Discord needs no migration — see
  -- docs/adr/0003-outbound-integrations.md. Never returned to a client: the room
  -- id is the access token, so handing a config back would let anyone with a
  -- share link lift a credential. Deleting the row takes the destinations with
  -- it, so the retention cron needs no extra step.
  integrations TEXT DEFAULT NULL
);

-- Existing databases predate `integrations`. SQLite has no "ADD COLUMN IF NOT
-- EXISTS", and CREATE TABLE IF NOT EXISTS above is a no-op on them, so apply
-- this once by hand and expect "duplicate column name" if it already ran:
--   wrangler d1 execute <db> --remote --command \
--     "ALTER TABLE annotations ADD COLUMN integrations TEXT DEFAULT NULL"

-- Projects bundle multiple annotation pages under a single shareable id.
-- page_ids is a JSON array of annotation ids, in display order.
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  page_ids TEXT NOT NULL,
  created_at INTEGER DEFAULT (unixepoch()),
  last_accessed_at INTEGER DEFAULT (unixepoch()),
  expires_at INTEGER DEFAULT NULL
);
