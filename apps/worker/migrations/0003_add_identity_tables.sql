-- Identity. Added for the dashboard: a person can claim the anonymous links
-- they made and get them back later. Anonymous use stays the default — every
-- table below is additive and `owner_id` (added in the next migration) is
-- nullable, so a share link created without an account behaves exactly as it
-- did before.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  -- Lower-cased at the boundary so `A@b.com` and `a@b.com` are one account.
  email TEXT NOT NULL UNIQUE,
  created_at INTEGER DEFAULT (unixepoch()),
  last_seen_at INTEGER DEFAULT (unixepoch())
);

-- `id` is the SHA-256 of the cookie value, never the value itself: a dump of
-- this table hands an attacker nothing replayable. Lookup is by digest, so
-- the comparison happens in SQLite's index rather than in our code — which
-- is also why there is no constant-time compare here to get wrong.
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at INTEGER DEFAULT (unixepoch()),
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);

-- Same digest-only rule as sessions. `used_at` makes a magic link single-use:
-- the row survives redemption so a second click reports "already used"
-- instead of the ambiguous "expired or wrong", and the cleanup cron sweeps
-- it later.
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
