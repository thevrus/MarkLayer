/** The Slack app's two tables (migrations/0011). The token column is ciphertext; see slack-crypto.ts. */
export interface SlackInstall {
  roomId: string;
  teamId: string;
  teamName: string | null;
  channelId: string;
  channelName: string | null;
  botUserId: string;
  sealedToken: string;
}

interface InstallRow {
  room_id: string;
  team_id: string;
  team_name: string | null;
  channel_id: string;
  channel_name: string | null;
  bot_user_id: string;
  bot_token: string;
}

const fromRow = (row: InstallRow): SlackInstall => ({
  roomId: row.room_id,
  teamId: row.team_id,
  teamName: row.team_name,
  channelId: row.channel_id,
  channelName: row.channel_name,
  botUserId: row.bot_user_id,
  sealedToken: row.bot_token,
});

export function slackStore(db: D1Database) {
  return {
    async install(roomId: string): Promise<SlackInstall | null> {
      const row = await db
        .prepare(
          'SELECT room_id, team_id, team_name, channel_id, channel_name, bot_user_id, bot_token FROM slack_installs WHERE room_id = ?',
        )
        .bind(roomId)
        .first<InstallRow>();
      return row ? fromRow(row) : null;
    },

    /** A reinstall picks a new channel, so the old channel's threads go with the old row. */
    async saveInstall({ install, installedBy }: { install: SlackInstall; installedBy: string | null }): Promise<void> {
      await db.batch([
        db.prepare('DELETE FROM slack_threads WHERE room_id = ?').bind(install.roomId),
        db
          .prepare(
            `INSERT OR REPLACE INTO slack_installs
               (room_id, team_id, team_name, channel_id, channel_name, bot_user_id, bot_token, installed_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            install.roomId,
            install.teamId,
            install.teamName,
            install.channelId,
            install.channelName,
            install.botUserId,
            install.sealedToken,
            installedBy,
          ),
      ]);
    },

    async removeRoom(roomId: string): Promise<void> {
      await db.batch([
        db.prepare('DELETE FROM slack_threads WHERE room_id = ?').bind(roomId),
        db.prepare('DELETE FROM slack_installs WHERE room_id = ?').bind(roomId),
      ]);
    },

    async removeTeam(teamId: string): Promise<void> {
      await db.batch([
        db.prepare('DELETE FROM slack_threads WHERE team_id = ?').bind(teamId),
        db.prepare('DELETE FROM slack_installs WHERE team_id = ?').bind(teamId),
      ]);
    },

    async threadFor({ roomId, annotationId }: { roomId: string; annotationId: string }) {
      return db
        .prepare('SELECT channel_id, thread_ts FROM slack_threads WHERE room_id = ? AND annotation_id = ?')
        .bind(roomId, annotationId)
        .first<{ channel_id: string; thread_ts: string }>();
    },

    async annotationFor({ teamId, channelId, threadTs }: { teamId: string; channelId: string; threadTs: string }) {
      return db
        .prepare(
          'SELECT room_id, annotation_id FROM slack_threads WHERE team_id = ? AND channel_id = ? AND thread_ts = ?',
        )
        .bind(teamId, channelId, threadTs)
        .first<{ room_id: string; annotation_id: string }>();
    },

    async saveThread(thread: {
      roomId: string;
      annotationId: string;
      teamId: string;
      channelId: string;
      threadTs: string;
    }): Promise<void> {
      await db
        .prepare(
          `INSERT OR REPLACE INTO slack_threads (room_id, annotation_id, team_id, channel_id, thread_ts)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(thread.roomId, thread.annotationId, thread.teamId, thread.channelId, thread.threadTs)
        .run();
    },

    /** Rows whose room the retention sweep already deleted. */
    async sweepOrphans(): Promise<void> {
      await db.batch([
        db.prepare('DELETE FROM slack_threads WHERE room_id NOT IN (SELECT id FROM annotations)'),
        db.prepare('DELETE FROM slack_installs WHERE room_id NOT IN (SELECT id FROM annotations)'),
      ]);
    },
  };
}
