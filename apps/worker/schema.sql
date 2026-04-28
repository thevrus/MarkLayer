CREATE TABLE IF NOT EXISTS annotations (
  id TEXT PRIMARY KEY,
  ops TEXT NOT NULL,
  url TEXT,
  width INTEGER,
  created_at INTEGER DEFAULT (unixepoch()),
  last_accessed_at INTEGER DEFAULT (unixepoch()),
  expires_at INTEGER DEFAULT NULL
);

-- Projects bundle multiple annotation pages under a single shareable id.
-- page_ids is a JSON array of annotation ids, in display order.
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  page_ids TEXT NOT NULL,
  created_at INTEGER DEFAULT (unixepoch()),
  last_accessed_at INTEGER DEFAULT (unixepoch()),
  expires_at INTEGER DEFAULT NULL
);
