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
  integrations TEXT DEFAULT NULL,
  -- Nullable: an anonymous link never gets an owner. See the identity block below.
  owner_id TEXT DEFAULT NULL
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
  expires_at INTEGER DEFAULT NULL,
  owner_id TEXT DEFAULT NULL
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

-- ---------------------------------------------------------------------------
-- Identity. Added for the dashboard: a person can claim the anonymous links
-- they made and get them back later. Anonymous use stays the default — every
-- table below is additive and `owner_id` is nullable, so a share link created
-- without an account behaves exactly as it did before.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  -- Lower-cased at the boundary so `A@b.com` and `a@b.com` are one account.
  email TEXT NOT NULL UNIQUE,
  created_at INTEGER DEFAULT (unixepoch()),
  last_seen_at INTEGER DEFAULT (unixepoch())
);

-- `id` is the SHA-256 of the cookie value, never the value itself: a dump of
-- this table hands an attacker nothing replayable. Lookup is by digest, so the
-- comparison happens in SQLite's index rather than in our code — which is also
-- why there is no constant-time compare here to get wrong.
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at INTEGER DEFAULT (unixepoch()),
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);

-- Same digest-only rule as sessions. `used_at` makes a magic link single-use:
-- the row survives redemption so a second click reports "already used" instead
-- of the ambiguous "expired or wrong", and the cleanup cron sweeps it later.
CREATE TABLE IF NOT EXISTS login_tokens (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  created_at INTEGER DEFAULT (unixepoch()),
  expires_at INTEGER NOT NULL,
  used_at INTEGER DEFAULT NULL
);
CREATE INDEX IF NOT EXISTS login_tokens_expiry_idx ON login_tokens(expires_at);
-- The send throttle reads the newest unredeemed row for an address on every
-- sign-in request. That is the unauthenticated path, so it must not full-scan.
CREATE INDEX IF NOT EXISTS login_tokens_email_idx ON login_tokens(email, created_at);

-- Ownership is a nullable back-reference rather than a join table: a link has
-- at most one owner, and an unclaimed link keeps NULL forever without a row
-- anywhere. Existing databases predate these columns, so apply by hand once
-- and expect "duplicate column name" if it already ran:
--   wrangler d1 execute marklayer --remote --command \
--     "ALTER TABLE annotations ADD COLUMN owner_id TEXT DEFAULT NULL"
--   wrangler d1 execute marklayer --remote --command \
--     "ALTER TABLE projects ADD COLUMN owner_id TEXT DEFAULT NULL"
CREATE INDEX IF NOT EXISTS annotations_owner_idx ON annotations(owner_id);
CREATE INDEX IF NOT EXISTS projects_owner_idx ON projects(owner_id);
