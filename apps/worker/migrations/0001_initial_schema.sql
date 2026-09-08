CREATE TABLE IF NOT EXISTS annotations (
  id TEXT PRIMARY KEY,
  ops TEXT NOT NULL,
  url TEXT,
  width INTEGER,
  created_at INTEGER DEFAULT (unixepoch()),
  last_accessed_at INTEGER DEFAULT (unixepoch()),
  expires_at INTEGER DEFAULT NULL
);

-- page_ids is a JSON array of annotation ids, in display order. Projects
-- bundle multiple annotation pages under a single shareable id.
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  page_ids TEXT NOT NULL,
  created_at INTEGER DEFAULT (unixepoch()),
  last_accessed_at INTEGER DEFAULT (unixepoch()),
  expires_at INTEGER DEFAULT NULL
);

-- Anonymous PDF uploads (POST /f). The bytes live in the FILE_BUCKET R2
-- bucket keyed by id; this row is only the retention bookkeeping, mirroring
-- annotations' created_at/last_accessed_at/expires_at columns so the same
-- cron sweep logic applies to a file that never gets attached to a share.
CREATE TABLE IF NOT EXISTS uploads (
  id TEXT PRIMARY KEY,
  size INTEGER,
  created_at INTEGER DEFAULT (unixepoch()),
  last_accessed_at INTEGER DEFAULT (unixepoch()),
  expires_at INTEGER DEFAULT NULL
);
