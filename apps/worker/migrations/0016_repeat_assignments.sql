-- Allow a later assignment of the same annotation to produce a new task.
-- Task ids still deduplicate retransmissions.
CREATE TABLE room_tasks_v2 (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL,
  room_id TEXT NOT NULL REFERENCES annotations(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL,
  requester_id TEXT NOT NULL,
  requester_name TEXT NOT NULL,
  layer_id TEXT NOT NULL,
  annotation_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'waiting', 'cancel_requested', 'completed', 'cancelled')),
  waiting_for TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (room_id, id)
);
INSERT INTO room_tasks_v2 SELECT * FROM room_tasks;
DROP TRIGGER room_collaboration_cleanup;
DROP TABLE room_tasks;
ALTER TABLE room_tasks_v2 RENAME TO room_tasks;
CREATE UNIQUE INDEX room_tasks_one_active ON room_tasks(room_id, agent_id)
  WHERE status IN ('running', 'waiting', 'cancel_requested');
CREATE INDEX room_tasks_queue ON room_tasks(room_id, agent_id, status, sequence);

CREATE TRIGGER room_collaboration_cleanup AFTER DELETE ON annotations BEGIN
  DELETE FROM room_tasks WHERE room_id = OLD.id;
  DELETE FROM room_agent_claims WHERE room_id = OLD.id;
  DELETE FROM room_layers WHERE room_id = OLD.id;
END;
