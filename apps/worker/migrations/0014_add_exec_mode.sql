-- Each room starts in collaborative mode. Existing rows receive the same default.
ALTER TABLE annotations ADD COLUMN exec_mode TEXT NOT NULL DEFAULT 'pair'
  CHECK (exec_mode IN ('solo', 'guide', 'pair'));
