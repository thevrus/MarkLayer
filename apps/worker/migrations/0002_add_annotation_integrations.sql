-- JSON array of outbound destinations: [{provider, config}]. One column
-- rather than one per provider, so adding Teams or Discord needs no
-- migration — see docs/adr/0003-outbound-integrations.md. Never returned to
-- a client: the room id is the access token, so handing a config back would
-- let anyone with a share link lift a credential. Deleting the row takes the
-- destinations with it, so the retention cron needs no extra step.
ALTER TABLE annotations ADD COLUMN integrations TEXT DEFAULT NULL;
