-- 图层、AI 认领和任务与房间同寿命；旧房间的默认图层无需改写批注数据。
CREATE TABLE room_layers (
  room_id TEXT NOT NULL REFERENCES annotations(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (room_id, id)
);
INSERT INTO room_layers (room_id, id, name) SELECT id, 'default', '默认图层' FROM annotations;
CREATE TRIGGER room_default_layer AFTER INSERT ON annotations BEGIN
  INSERT INTO room_layers (room_id, id, name) VALUES (NEW.id, 'default', '默认图层');
END;

CREATE TABLE room_agent_claims (
  room_id TEXT NOT NULL REFERENCES annotations(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  owner_name TEXT NOT NULL,
  PRIMARY KEY (room_id, agent_id)
);

CREATE TABLE room_tasks (
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
  UNIQUE (room_id, id),
  UNIQUE (room_id, agent_id, source_id),
  FOREIGN KEY (room_id, layer_id) REFERENCES room_layers(room_id, id)
);
CREATE UNIQUE INDEX room_tasks_one_active ON room_tasks(room_id, agent_id)
  WHERE status IN ('running', 'waiting', 'cancel_requested');
CREATE INDEX room_tasks_queue ON room_tasks(room_id, agent_id, status, sequence);
-- 在未启用外键的本地 SQLite 环境中也清理房间附属记录。
CREATE TRIGGER room_collaboration_cleanup AFTER DELETE ON annotations BEGIN
  DELETE FROM room_tasks WHERE room_id = OLD.id;
  DELETE FROM room_agent_claims WHERE room_id = OLD.id;
  DELETE FROM room_layers WHERE room_id = OLD.id;
END;
