/** Wrong guesses one client gets per room per window before every guess is refused unchecked. */
export const MAX_FAILURES = 10;
export const FAILURE_WINDOW_SECONDS = 15 * 60;
export const FAILURE_WINDOW_MINUTES = FAILURE_WINDOW_SECONDS / 60;

/** Wrong-password counts per (room, client). See migration 0010 for why this is a table. */
export function unlockFailureStore(db: D1Database) {
  return {
    /** Failures inside a window still open at `since`. */
    async count({ roomId, client, since }: { roomId: string; client: string; since: number }): Promise<number> {
      const row = await db
        .prepare('SELECT failures FROM unlock_failures WHERE room_id = ? AND client = ? AND window_start >= ?')
        .bind(roomId, client, since)
        .first<{ failures: number }>();
      return row?.failures ?? 0;
    },

    /** One upsert: a window older than `since` restarts at one rather than accumulating forever. */
    async record({
      roomId,
      client,
      now,
      since,
    }: {
      roomId: string;
      client: string;
      now: number;
      since: number;
    }): Promise<void> {
      await db
        .prepare(
          `INSERT INTO unlock_failures (room_id, client, window_start, failures) VALUES (?, ?, ?, 1)
           ON CONFLICT(room_id, client) DO UPDATE SET
             failures = CASE WHEN window_start < ? THEN 1 ELSE failures + 1 END,
             window_start = CASE WHEN window_start < ? THEN excluded.window_start ELSE window_start END`,
        )
        .bind(roomId, client, now, since, since)
        .run();
    },

    sweep(before: number): Promise<unknown> {
      return db.prepare('DELETE FROM unlock_failures WHERE window_start < ?').bind(before).run();
    },
  };
}
