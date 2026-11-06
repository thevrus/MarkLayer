import { isNewShareId, type LinkAccess, linkAccessSchema } from '@marklayer/types';
import { nanoid } from 'nanoid';

/**
 * Every read and write of the `annotations`, `projects` and `uploads` tables.
 *
 * Routes, the Durable Object and the cron used to each carry their own SQL plus
 * their own copy of the JSON-parsing and expiry rules, which is how the four
 * call sites ended up disagreeing about what a corrupt `ops` column means. The
 * schema is known in one place now; callers ask for rows, not columns.
 */

/** A stored annotation. `ops` is already parsed and never throws — see parseJsonArray. */
export interface StoredAnnotation {
  ops: unknown[];
  url: string | null;
  width: number | null;
  createdAt: number | null;
  expiresAt: number | null;
  access: LinkAccess;
  ownerId: string | null;
  ownerExpiresAt: number | null;
}

/**
 * A weak id degrades the upsert below to a plain UPDATE, so zero rows changed
 * means the *create* was refused — the id is the room's only access token, and
 * one short enough to guess may not mint a room.
 */
const wroteRow = (res: D1Response): boolean => (res.meta.changes ?? 0) > 0;

/**
 * Every write that can also create a row. A weak id may only ever update one
 * that already exists, so a squatter cannot mint a guessable room; the miss is
 * what `wroteRow` reports. One guard so the rule cannot drift between writers.
 */
async function upsertGuarded({
  id,
  update,
  insert,
}: {
  id: string;
  update: () => Promise<D1Response>;
  insert: () => Promise<D1Response>;
}): Promise<boolean> {
  if (!isNewShareId(id)) return wroteRow(await update());
  await insert();
  return true;
}

/**
 * A row's `access` column, degraded to `'edit'` rather than thrown — a row from
 * before the column existed, or garbage, behaves like today's only mode.
 */
export function parseLinkAccess(raw: unknown): LinkAccess {
  const parsed = linkAccessSchema.safeParse(raw);
  return parsed.success ? parsed.data : 'edit';
}

/** What an agent says about a preview room when it opens one. Null where it said nothing. */
export interface PreviewFields {
  url: string;
  title: string;
  note: string | null;
  repo: string | null;
  branch: string | null;
  sha: string | null;
}

export interface VersionRef {
  id: string;
  version: number | null;
  sha: string | null;
}

/** `GET /api/:id/versions`. All null but the neighbours' absence on an ordinary room. */
export interface PreviewInfo {
  title: string | null;
  note: string | null;
  repo: string | null;
  branch: string | null;
  sha: string | null;
  version: number | null;
  previous: VersionRef | null;
  next: VersionRef | null;
}

/** A room's password state. `passwordHash` null is an open link. */
export interface RoomLock {
  passwordHash: string | null;
  passwordGen: number;
  ownerId: string | null;
}

interface LockRow {
  password_hash: string | null;
  password_gen: number | null;
  owner_id: string | null;
}

function lockFromRow(row: LockRow): RoomLock {
  return { passwordHash: row.password_hash, passwordGen: row.password_gen ?? 0, ownerId: row.owner_id };
}

export interface StoredProject {
  pageIds: string[];
  createdAt: number | null;
  expiresAt: number | null;
}

export interface AnnotationPage {
  id: string;
  ops: unknown[];
  url: string | null;
  width: number | null;
}

/**
 * A row's JSON column, degraded to an empty array rather than thrown.
 * A corrupt row should render as an empty annotation, not a 500 — two of the
 * previous call sites parsed unguarded and would have.
 */
function parseJsonArray(raw: string): unknown[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseIds(raw: string): string[] {
  return parseJsonArray(raw).filter((x): x is string => typeof x === 'string');
}

/** Seconds since the epoch, the unit every timestamp column uses. */
export function nowInSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export function isExpired(expiresAt: number | null): boolean {
  return expiresAt !== null && nowInSeconds() > expiresAt;
}

/**
 * Seconds before another mail may go to the same address, given when the last one did.
 * One window for sign-in links and invites alike, so the two cannot drift apart.
 */
export const MAIL_THROTTLE_SECONDS = 60;
export function throttleRemaining(lastSentAt: number | undefined): number {
  if (lastSentAt === undefined) return 0;
  const elapsed = nowInSeconds() - lastSentAt;
  return elapsed >= MAIL_THROTTLE_SECONDS ? 0 : MAIL_THROTTLE_SECONDS - elapsed;
}

export function annotationStore(db: D1Database) {
  return {
    async get(id: string): Promise<StoredAnnotation | null> {
      const row = await db
        .prepare(
          'SELECT ops, url, width, created_at, expires_at, access, owner_id, owner_expires_at FROM annotations WHERE id = ?',
        )
        .bind(id)
        .first<{
          ops: string;
          url: string | null;
          width: number | null;
          created_at: number | null;
          expires_at: number | null;
          access: string;
          owner_id: string | null;
          owner_expires_at: number | null;
        }>();
      if (!row) return null;
      return {
        ops: parseJsonArray(row.ops),
        url: row.url,
        width: row.width,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
        access: parseLinkAccess(row.access),
        ownerId: row.owner_id,
        ownerExpiresAt: row.owner_expires_at,
      };
    },

    /** Who may edit, who owns it, and their expiry — what a warm room re-reads after the owner's Settings PATCH. */
    async getAccess(
      id: string,
    ): Promise<{ access: LinkAccess; ownerId: string | null; ownerExpiresAt: number | null } | null> {
      const row = await db
        .prepare('SELECT access, owner_id, owner_expires_at FROM annotations WHERE id = ?')
        .bind(id)
        .first<{ access: string; owner_id: string | null; owner_expires_at: number | null }>();
      return row
        ? { access: parseLinkAccess(row.access), ownerId: row.owner_id, ownerExpiresAt: row.owner_expires_at }
        : null;
    },

    /**
     * What every content gate reads: the password record, its generation, and who
     * owns the link (the owner skips the prompt). Null when there is no such room.
     */
    async getLock(id: string): Promise<RoomLock | null> {
      const row = await db
        .prepare('SELECT password_hash, password_gen, owner_id FROM annotations WHERE id = ?')
        .bind(id)
        .first<LockRow>();
      return row ? lockFromRow(row) : null;
    },

    /** Locks for a project's pages, protected ones only: an absent id is an open (or missing) page. */
    async getLocks(ids: string[]): Promise<Map<string, RoomLock>> {
      const found = new Map<string, RoomLock>();
      if (ids.length === 0) return found;
      const placeholders = ids.map(() => '?').join(',');
      const rows = await db
        .prepare(
          `SELECT id, password_hash, password_gen, owner_id FROM annotations WHERE password_hash IS NOT NULL AND id IN (${placeholders})`,
        )
        .bind(...ids)
        .all<LockRow & { id: string }>();
      for (const r of rows.results) found.set(r.id, lockFromRow(r));
      return found;
    },

    /** Just the annotated page's URL — the only column the OG routes need. */
    async getUrl(id: string): Promise<string | null> {
      const row = await db.prepare('SELECT url FROM annotations WHERE id = ?').bind(id).first<{ url: string | null }>();
      return row?.url ?? null;
    },

    /** The project an open link was promoted into. Re-checks the link guard: an owner may have locked it down since. */
    async getPromotion(id: string): Promise<{ projectId: string; pageIds: string[]; expiresAt: number | null } | null> {
      const row = await db
        .prepare(
          `SELECT a.project_id, p.page_ids, p.expires_at FROM annotations a
           LEFT JOIN projects p ON p.id = a.project_id
           WHERE a.id = ? AND a.project_id IS NOT NULL AND a.access = 'edit' AND a.password_hash IS NULL`,
        )
        .bind(id)
        .first<{ project_id: string; page_ids: string | null; expires_at: number | null }>();
      if (!row) return null;
      return { projectId: row.project_id, pageIds: parseIds(row.page_ids ?? '[]'), expiresAt: row.expires_at };
    },

    /** Points each open, unprotected page that has no project yet at `projectId`. */
    linkProject({ projectId, pageIds }: { projectId: string; pageIds: string[] }): Promise<unknown> {
      return db
        .prepare(
          `UPDATE annotations SET project_id = ?
           WHERE id IN (SELECT value FROM json_each(?))
             AND project_id IS NULL AND access = 'edit' AND password_hash IS NULL`,
        )
        .bind(projectId, JSON.stringify(pageIds))
        .run();
    },

    unlinkProject({ id, projectId }: { id: string; projectId: string }): Promise<unknown> {
      return db
        .prepare('UPDATE annotations SET project_id = NULL WHERE id = ? AND project_id = ?')
        .bind(id, projectId)
        .run();
    },

    async getOps(id: string): Promise<unknown[] | null> {
      const row = await db.prepare('SELECT ops FROM annotations WHERE id = ?').bind(id).first<{ ops: string }>();
      return row ? parseJsonArray(row.ops) : null;
    },

    /** Pages of a project, keyed by id. Ids with no row are simply absent. */
    async getMany(ids: string[]): Promise<Map<string, AnnotationPage>> {
      const found = new Map<string, AnnotationPage>();
      if (ids.length === 0) return found;
      const placeholders = ids.map(() => '?').join(',');
      const rows = await db
        .prepare(`SELECT id, ops, url, width FROM annotations WHERE id IN (${placeholders})`)
        .bind(...ids)
        .all<{ id: string; ops: string; url: string | null; width: number | null }>();
      for (const r of rows.results) {
        found.set(r.id, { id: r.id, ops: parseJsonArray(r.ops), url: r.url, width: r.width });
      }
      return found;
    },

    /** Whether the room is there at all, without reading any of it. */
    async exists(id: string): Promise<boolean> {
      return (await db.prepare('SELECT 1 FROM annotations WHERE id = ?').bind(id).first()) !== null;
    },

    /** False when the id was too weak to mint a room at — see `wroteRow`. */
    async put({
      id,
      ops,
      url,
      width,
      expiresAt,
    }: {
      id: string;
      ops: unknown[];
      url: string | null;
      width: number | null;
      expiresAt: number | null;
    }): Promise<boolean> {
      return upsertGuarded({
        id,
        update: () =>
          db
            .prepare(
              `UPDATE annotations SET ops = ?, url = COALESCE(?, url), width = COALESCE(?, width), expires_at = ?
             WHERE id = ?`,
            )
            .bind(JSON.stringify(ops), url, width, expiresAt, id)
            .run(),
        insert: () =>
          db
            .prepare(
              `INSERT INTO annotations (id, ops, url, width, expires_at) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET ops = excluded.ops, url = COALESCE(excluded.url, url), width = COALESCE(excluded.width, width), expires_at = excluded.expires_at`,
            )
            .bind(id, JSON.stringify(ops), url, width, expiresAt)
            .run(),
      });
    },

    /**
     * Write ops alone, preserving url/width/expiry — the realtime room's flush.
     * False when the id was too weak to mint a room at; see `wroteRow`.
     */
    async putOps({ id, ops }: { id: string; ops: unknown[] }): Promise<boolean> {
      return upsertGuarded({
        id,
        update: () =>
          db
            .prepare('UPDATE annotations SET ops = ?, last_accessed_at = unixepoch() WHERE id = ?')
            .bind(JSON.stringify(ops), id)
            .run(),
        insert: () =>
          db
            .prepare(
              `INSERT INTO annotations (id, ops, last_accessed_at) VALUES (?, ?, unixepoch())
           ON CONFLICT(id) DO UPDATE SET ops = excluded.ops, last_accessed_at = unixepoch()`,
            )
            .bind(id, JSON.stringify(ops))
            .run(),
      });
    },

    /**
     * Replace the room's outbound destinations. Writes nothing else, so it
     * cannot race the realtime room's op flush.
     *
     * Returns false when the room does not exist: a destination with no room to
     * belong to would be an orphan the retention cron never reaps.
     */
    async setIntegrations({ id, json }: { id: string; json: string | null }): Promise<boolean> {
      const res = await db.prepare('UPDATE annotations SET integrations = ? WHERE id = ?').bind(json, id).run();
      return wroteRow(res);
    },

    /**
     * The destinations alone — what the realtime room and the integration routes
     * need and nothing more. Returns null for a missing row so a caller can tell
     * "no such room" from "room with no destinations" without a second query, and
     * so no route has to pull the whole ops blob just to check the row exists.
     */
    async getIntegrations(id: string): Promise<{ integrations: string | null } | null> {
      const row = await db
        .prepare('SELECT integrations FROM annotations WHERE id = ?')
        .bind(id)
        .first<{ integrations: string | null }>();
      return row ?? null;
    },

    /**
     * Mint a review room for a preview build. Never overwrites: a taken id is
     * someone else's room. It becomes the next version of `previousId` only when
     * that room has the same repo and branch — the caller proves it holds the
     * earlier room by naming it, so a stranger who guesses a repo and branch
     * cannot splice into someone's chain and read its ids off the switcher.
     */
    async createPreview({
      id,
      ops,
      preview,
      previousId,
    }: {
      id: string;
      ops: unknown[];
      preview: PreviewFields;
      previousId: string | null;
    }): Promise<
      | { created: false; reason: 'weak_id' | 'taken' }
      | { created: true; version: number | null; previousId: string | null }
    > {
      if (!isNewShareId(id)) return { created: false, reason: 'weak_id' };
      const { url, title, note, repo, branch, sha } = preview;
      const chained = repo !== null && branch !== null;
      const prev =
        chained && previousId
          ? await db
              .prepare('SELECT repo, branch, version, owner_id, password_hash FROM annotations WHERE id = ?')
              .bind(previousId)
              .first<{
                repo: string | null;
                branch: string | null;
                version: number | null;
                owner_id: string | null;
                password_hash: string | null;
              }>()
          : null;
      const linked = prev !== null && prev.repo === repo && prev.branch === branch;
      const version = linked ? (prev.version ?? 1) + 1 : chained ? 1 : null;
      const prevId = linked ? previousId : null;
      // A new build of a protected room is protected the same way; the owner comes along so the lock stays manageable.
      const lock = linked && prev.password_hash ? { owner: prev.owner_id, hash: prev.password_hash } : null;
      const res = await db
        .prepare(
          `INSERT INTO annotations (id, ops, url, title, note, repo, branch, sha, version, prev_id, owner_id, password_hash)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`,
        )
        .bind(
          id,
          JSON.stringify(ops),
          url,
          title,
          note,
          repo,
          branch,
          sha,
          version,
          prevId,
          lock?.owner ?? null,
          lock?.hash ?? null,
        )
        .run();
      if (!wroteRow(res)) return { created: false, reason: 'taken' };
      return { created: true, version, previousId: prevId };
    },

    /** The preview fields and the neighbouring versions, or null for no such room. */
    async getVersions(id: string): Promise<PreviewInfo | null> {
      const [row, next] = await Promise.all([
        db
          .prepare(
            `SELECT a.title, a.note, a.repo, a.branch, a.sha, a.version,
                    p.id AS prev_id, p.version AS prev_version, p.sha AS prev_sha
             FROM annotations a LEFT JOIN annotations p ON p.id = a.prev_id
             WHERE a.id = ?`,
          )
          .bind(id)
          .first<{
            title: string | null;
            note: string | null;
            repo: string | null;
            branch: string | null;
            sha: string | null;
            version: number | null;
            prev_id: string | null;
            prev_version: number | null;
            prev_sha: string | null;
          }>(),
        // Two previews chained off one room is a fork; the newest is the one to step to.
        db
          .prepare('SELECT id, version, sha FROM annotations WHERE prev_id = ? ORDER BY created_at DESC LIMIT 1')
          .bind(id)
          .first<VersionRef>(),
      ]);
      if (!row) return null;
      return {
        title: row.title,
        note: row.note,
        repo: row.repo,
        branch: row.branch,
        sha: row.sha,
        version: row.version,
        previous: row.prev_id ? { id: row.prev_id, version: row.prev_version, sha: row.prev_sha } : null,
        next: next ?? null,
      };
    },

    /** Push back the retention clock. Callers decide whether to await it. */
    touch(id: string): Promise<unknown> {
      return db.prepare('UPDATE annotations SET last_accessed_at = unixepoch() WHERE id = ?').bind(id).run();
    },

    remove(id: string): Promise<unknown> {
      return db.prepare('DELETE FROM annotations WHERE id = ?').bind(id).run();
    },

    /**
     * Ids of everything past its own expiry, its owner's, or — for a link nobody
     * has claimed — the idle window, now deleted. The idle clause is gated on
     * `owner_id IS NULL` because a claimed link is one someone asked to keep:
     * only an expiry they chose may take it. `deletionDeadline` is the same rule
     * in the shape the dashboard counts down from; the two must agree.
     */
    async deleteExpired({ unusedSince }: { unusedSince: number }): Promise<string[]> {
      const now = nowInSeconds();
      const deleted = await db
        .prepare(
          `DELETE FROM annotations WHERE (owner_id IS NULL AND last_accessed_at < ?)
           OR (expires_at IS NOT NULL AND expires_at < ?)
           OR (owner_expires_at IS NOT NULL AND owner_expires_at < ?)
           RETURNING id`,
        )
        .bind(unusedSince, now, now)
        .all<{ id: string }>();
      return deleted.results.map((r) => r.id);
    },
  };
}

export function projectStore(db: D1Database) {
  return {
    async get(id: string): Promise<StoredProject | null> {
      const row = await db
        .prepare('SELECT page_ids, created_at, expires_at FROM projects WHERE id = ?')
        .bind(id)
        .first<{ page_ids: string; created_at: number | null; expires_at: number | null }>();
      if (!row) return null;
      return { pageIds: parseIds(row.page_ids), createdAt: row.created_at, expiresAt: row.expires_at };
    },

    /** False when the id was too weak to mint a project at — see `wroteRow`. */
    async put({
      id,
      pageIds,
      expiresAt,
    }: {
      id: string;
      pageIds: string[];
      expiresAt: number | null;
    }): Promise<boolean> {
      return upsertGuarded({
        id,
        update: () =>
          db
            .prepare(
              `UPDATE projects SET page_ids = ?, expires_at = ?, last_accessed_at = unixepoch()
             WHERE id = ?`,
            )
            .bind(JSON.stringify(pageIds), expiresAt, id)
            .run(),
        insert: () =>
          db
            .prepare(
              `INSERT INTO projects (id, page_ids, expires_at) VALUES (?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET page_ids = excluded.page_ids, expires_at = excluded.expires_at, last_accessed_at = unixepoch()`,
            )
            .bind(id, JSON.stringify(pageIds), expiresAt)
            .run(),
      });
    },

    touch(id: string): Promise<unknown> {
      return db.prepare('UPDATE projects SET last_accessed_at = unixepoch() WHERE id = ?').bind(id).run();
    },

    remove(id: string): Promise<unknown> {
      return db.prepare('DELETE FROM projects WHERE id = ?').bind(id).run();
    },

    async deleteExpired({ unusedSince }: { unusedSince: number }): Promise<string[]> {
      const deleted = await db
        .prepare(
          'DELETE FROM projects WHERE last_accessed_at < ? OR (expires_at IS NOT NULL AND expires_at < ?) RETURNING id',
        )
        .bind(unusedSince, nowInSeconds())
        .all<{ id: string }>();
      return deleted.results.map((r) => r.id);
    },
  };
}

export function uploadStore(db: D1Database) {
  return {
    /** Row before object: the cron sweeps R2 by what it finds here, so an object
     *  written without one would never be collected. */
    async put({ id, size }: { id: string; size: number }): Promise<void> {
      await db.prepare('INSERT INTO uploads (id, size) VALUES (?, ?)').bind(id, size).run();
    },

    async transcript(id: string): Promise<string | null> {
      const row = await db
        .prepare('SELECT transcript FROM uploads WHERE id = ?')
        .bind(id)
        .first<{ transcript: string | null }>();
      return row?.transcript ?? null;
    },

    setTranscript({ id, text }: { id: string; text: string }): Promise<unknown> {
      return db.prepare('UPDATE uploads SET transcript = ? WHERE id = ?').bind(text, id).run();
    },

    touch(id: string): Promise<unknown> {
      return db.prepare('UPDATE uploads SET last_accessed_at = unixepoch() WHERE id = ?').bind(id).run();
    },

    async deleteExpired({ unusedSince }: { unusedSince: number }): Promise<string[]> {
      const deleted = await db
        .prepare(
          'DELETE FROM uploads WHERE last_accessed_at < ? OR (expires_at IS NOT NULL AND expires_at < ?) RETURNING id',
        )
        .bind(unusedSince, nowInSeconds())
        .all<{ id: string }>();
      return deleted.results.map((r) => r.id);
    },
  };
}

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

/** Emails captured through the share popover's "Invite by email". */
export function inviteStore(db: D1Database) {
  return {
    /** One invite per (link, address) per window, so a form left on repeat cannot bury someone's inbox. */
    async throttleSeconds({ linkId, email }: { linkId: string; email: string }): Promise<number> {
      const row = await db
        .prepare('SELECT created_at FROM invites WHERE link_id = ? AND email = ? ORDER BY created_at DESC LIMIT 1')
        .bind(linkId, email)
        .first<{ created_at: number }>();
      return throttleRemaining(row?.created_at);
    },

    async record({ linkId, email }: { linkId: string; email: string }): Promise<void> {
      await db.prepare('INSERT INTO invites (id, link_id, email) VALUES (?, ?, ?)').bind(nanoid(), linkId, email).run();
    },
  };
}
