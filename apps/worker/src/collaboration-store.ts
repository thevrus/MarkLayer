import { DEFAULT_LAYER_ID } from '@marklayer/types/ops';

export interface RoomLayer { id: string; name: string; created_at: number }
export type TaskStatus = 'queued' | 'running' | 'waiting' | 'cancel_requested' | 'completed' | 'cancelled';
export interface RoomTask {
  sequence: number;
  id: string;
  room_id: string;
  agent_id: string;
  requester_id: string;
  requester_name: string;
  layer_id: string;
  annotation_id: string;
  source_id: string;
  status: TaskStatus;
  waiting_for: string | null;
  created_at: number;
}
export interface AgentClaim { agent_id: string; owner_id: string; owner_name: string }
const changed = (result: D1Result) => (result.meta.changes ?? 0) > 0;

/** 房间级持久数据；涉及并发争用的转换均由单条 SQL 裁决。 */
export function collaborationStore(db: D1Database) {
  return {
    async layers(roomId: string): Promise<RoomLayer[]> {
      const result = await db.prepare('SELECT id, name, created_at FROM room_layers WHERE room_id = ? ORDER BY created_at, id').bind(roomId).all<RoomLayer>();
      return result.results;
    },
    async createLayer(roomId: string, id: string, name: string): Promise<boolean> {
      return changed(await db.prepare('INSERT OR IGNORE INTO room_layers (room_id, id, name) VALUES (?, ?, ?)').bind(roomId, id, name).run());
    },
    async renameLayer(roomId: string, id: string, name: string): Promise<boolean> {
      return changed(await db.prepare('UPDATE room_layers SET name = ? WHERE room_id = ? AND id = ?').bind(name, roomId, id).run());
    },
    async deleteLayer(roomId: string, id: string): Promise<boolean> {
      if (id === DEFAULT_LAYER_ID) return false;
      return changed(await db.prepare(`DELETE FROM room_layers WHERE room_id = ? AND id = ?
        AND NOT EXISTS (SELECT 1 FROM annotations a, json_each(CASE WHEN json_valid(a.ops) THEN a.ops ELSE '[]' END) op WHERE a.id = room_layers.room_id AND CASE WHEN json_valid(op.value) THEN json_extract(op.value, '$.layerId') END = room_layers.id)
        AND NOT EXISTS (SELECT 1 FROM room_tasks t WHERE t.room_id = room_layers.room_id AND t.layer_id = room_layers.id AND t.status NOT IN ('completed', 'cancelled'))`)
        .bind(roomId, id).run());
    },
    async claims(roomId: string): Promise<AgentClaim[]> {
      return (await db.prepare('SELECT agent_id, owner_id, owner_name FROM room_agent_claims WHERE room_id = ? ORDER BY agent_id').bind(roomId).all<AgentClaim>()).results;
    },
    async claim(roomId: string, agentId: string, ownerId: string, ownerName: string): Promise<boolean> {
      return changed(await db.prepare('INSERT OR IGNORE INTO room_agent_claims (room_id, agent_id, owner_id, owner_name) VALUES (?, ?, ?, ?)').bind(roomId, agentId, ownerId, ownerName).run());
    },
    async release(roomId: string, agentId: string, ownerId: string): Promise<boolean> {
      return changed(await db.prepare('DELETE FROM room_agent_claims WHERE room_id = ? AND agent_id = ? AND owner_id = ?').bind(roomId, agentId, ownerId).run());
    },
    async enqueue(task: Pick<RoomTask, 'id' | 'room_id' | 'agent_id' | 'requester_id' | 'requester_name' | 'layer_id' | 'annotation_id' | 'source_id'>): Promise<boolean> {
      return changed(await db.prepare(`INSERT OR IGNORE INTO room_tasks (id, room_id, agent_id, requester_id, requester_name, layer_id, annotation_id, source_id)
        SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM room_layers WHERE room_id = ? AND id = ?)`)
        .bind(task.id, task.room_id, task.agent_id, task.requester_id, task.requester_name, task.layer_id, task.annotation_id, task.source_id, task.room_id, task.layer_id).run());
    },
    async tasks(roomId: string, agentId: string): Promise<RoomTask[]> {
      return (await db.prepare('SELECT * FROM room_tasks WHERE room_id = ? AND agent_id = ? ORDER BY sequence').bind(roomId, agentId).all<RoomTask>()).results;
    },
    async takeNext(roomId: string, agentId: string): Promise<RoomTask | null> {
      return db.prepare(`UPDATE room_tasks SET status = 'running' WHERE sequence = (
          SELECT t.sequence FROM room_tasks t LEFT JOIN room_agent_claims c ON c.room_id = t.room_id AND c.agent_id = t.agent_id
          WHERE t.room_id = ? AND t.agent_id = ? AND t.status = 'queued'
          ORDER BY CASE WHEN t.requester_id = c.owner_id THEN 0 ELSE 1 END, t.sequence LIMIT 1
        ) AND NOT EXISTS (SELECT 1 FROM room_tasks active WHERE active.room_id = ? AND active.agent_id = ? AND active.status IN ('running', 'waiting', 'cancel_requested')) RETURNING *`)
        .bind(roomId, agentId, roomId, agentId).first<RoomTask>();
    },
    async waitFor(roomId: string, agentId: string, taskId: string, person: string): Promise<boolean> {
      return changed(await db.prepare("UPDATE room_tasks SET status = 'waiting', waiting_for = ? WHERE room_id = ? AND agent_id = ? AND id = ? AND status = 'running'").bind(person, roomId, agentId, taskId).run());
    },
    async resume(roomId: string, agentId: string, taskId: string): Promise<boolean> {
      return changed(await db.prepare("UPDATE room_tasks SET status = 'running', waiting_for = NULL WHERE room_id = ? AND agent_id = ? AND id = ? AND status = 'waiting'").bind(roomId, agentId, taskId).run());
    },
    async finish(roomId: string, agentId: string, taskId: string): Promise<boolean> {
      return changed(await db.prepare("UPDATE room_tasks SET status = 'completed', waiting_for = NULL WHERE room_id = ? AND agent_id = ? AND id = ? AND status = 'running'").bind(roomId, agentId, taskId).run());
    },
    async requestCancel(roomId: string, taskId: string): Promise<boolean> {
      return changed(await db.prepare("UPDATE room_tasks SET status = CASE WHEN status = 'queued' THEN 'cancelled' ELSE 'cancel_requested' END, waiting_for = NULL WHERE room_id = ? AND id = ? AND status IN ('queued', 'running', 'waiting')").bind(roomId, taskId).run());
    },
    async confirmCancel(roomId: string, agentId: string, taskId: string): Promise<boolean> {
      return changed(await db.prepare("UPDATE room_tasks SET status = 'cancelled' WHERE room_id = ? AND agent_id = ? AND id = ? AND status = 'cancel_requested'").bind(roomId, agentId, taskId).run());
    },
  };
}
