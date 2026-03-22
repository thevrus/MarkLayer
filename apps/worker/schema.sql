CREATE TABLE IF NOT EXISTS annotations (
  id TEXT PRIMARY KEY,
  ops TEXT NOT NULL,
  url TEXT,
  width INTEGER,
  created_at INTEGER DEFAULT (unixepoch()),
  last_accessed_at INTEGER DEFAULT (unixepoch()),
  expires_at INTEGER DEFAULT NULL
);
