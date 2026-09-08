-- Emails captured through "Invite by email" in the share popover. Not an
-- access grant — the share link itself is already the credential — just a
-- record of who was invited, kept so a repeat send throttles and the address
-- survives for outreach. `link_id` is whichever id the popover was showing
-- (an annotation or a project), so it is not a foreign key onto either table.
CREATE TABLE IF NOT EXISTS invites (
  id TEXT PRIMARY KEY,
  link_id TEXT NOT NULL,
  email TEXT NOT NULL,
  created_at INTEGER DEFAULT (unixepoch())
);
-- The throttle reads the newest invite for a (link, email) pair on every
-- request, same shape as login_tokens' send throttle.
CREATE INDEX IF NOT EXISTS invites_link_email_idx ON invites(link_id, email, created_at);
