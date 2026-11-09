import { isNewShareId } from '@marklayer/brand/links';
import { type LinkAccess, linkAccessSchema, type OwnedLink } from '../shared/accounts';
import { nowInSeconds } from './time';

/**
 * Every read and write of the `annotations`, `projects` and `uploads` tables,
 * one store per table.
 *
 * Routes, the Durable Object and the cron used to each carry their own SQL plus
 * their own copy of the JSON-parsing and expiry rules, which is how the four
 * call sites ended up disagreeing about what a corrupt `ops` column means. The
 * schema is known in one place now; callers ask for rows, not columns.
 *
 * The `ops` column has one writer: the room's Durable Object (`putOps`, `create`).
 * Nothing else touches it, which is what makes a warm room's flush safe.
 */

export { inviteStore, MAIL_THROTTLE_SECONDS, throttleRemaining } from './auth/mail-throttle';
export { unlockFailureStore } from './lock/failures';
export { isExpired, nowInSeconds } from './time';

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

/** What `putOps` found: the row it updated, or none, which means the room was deleted behind it. */
export type OpsWrite = 'written' | 'gone';

const wroteRow = (res: D1Response): boolean => (res.meta.changes ?? 0) > 0;

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

/** Everything the room's door reads in one row: the lock, and both deadlines. */
export interface RoomDoor extends RoomLock {
  expiresAt: number | null;
  ownerExpiresAt: number | null;
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

/**
 * The retention sweep's idle clause, for a table whose rows a claimed link may keep
 * alive. A kept link is one someone asked to keep: only an expiry they chose may
 * take it, and the same holds for the project and the uploads it points at.
 * `deletionDeadline` in shared/accounts is the same rule as a countdown. Membership is
 * `page_ids`: `annotations.project_id` is only the promotion pointer, unset for protected pages.
 */
const NO_OWNED_PAGE = `NOT EXISTS (
  SELECT 1 FROM json_each(projects.page_ids) page
  JOIN annotations a ON a.id = page.value WHERE a.owner_id IS NOT NULL
)`;

export type ExecMode = 'solo' | 'guide' | 'pair';

export function annotationStore(db: D1Database) {
  return {
    async getExecMode(id: string): Promise<ExecMode | null> {
      const row = await db.prepare('SELECT exec_mode FROM annotations WHERE id = ?').bind(id).first<{ exec_mode: ExecMode }>();
      return row?.exec_mode ?? null;
    },

    async setExecMode(id: string, mode: ExecMode): Promise<boolean> {
      return wroteRow(await db.prepare('UPDATE annotations SET exec_mode = ? WHERE id = ?').bind(mode, id).run());
    },

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

    /** Everything about a room but its ops: what a warm room re-reads when the row may have moved under it. */
    async getMeta(id: string): Promise<Omit<StoredAnnotation, 'ops'> | null> {
      const row = await db
        .prepare(
          'SELECT url, width, created_at, expires_at, access, owner_id, owner_expires_at FROM annotations WHERE id = ?',
        )
        .bind(id)
        .first<{
          url: string | null;
          width: number | null;
          created_at: number;
          expires_at: number | null;
          access: string;
          owner_id: string | null;
          owner_expires_at: number | null;
        }>();
      return row
        ? {
            url: row.url,
            width: row.width,
            createdAt: row.created_at,
            expiresAt: row.expires_at,
            access: parseLinkAccess(row.access),
            ownerId: row.owner_id,
            ownerExpiresAt: row.owner_expires_at,
          }
        : null;
    },

    /** The password record, its generation, and who owns the link. Null when there is no such room. */
    async getLock(id: string): Promise<RoomLock | null> {
      const row = await db
        .prepare('SELECT password_hash, password_gen, owner_id FROM annotations WHERE id = ?')
        .bind(id)
        .first<LockRow>();
      return row ? lockFromRow(row) : null;
    },

    /** What `openRoom` reads: the lock plus both deadlines, so existence, expiry and password cost one query. */
    async getDoor(id: string): Promise<RoomDoor | null> {
      const row = await db
        .prepare(
          'SELECT password_hash, password_gen, owner_id, expires_at, owner_expires_at FROM annotations WHERE id = ?',
        )
        .bind(id)
        .first<LockRow & { expires_at: number | null; owner_expires_at: number | null }>();
      return row ? { ...lockFromRow(row), expiresAt: row.expires_at, ownerExpiresAt: row.owner_expires_at } : null;
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

    /**
     * Points each open, unprotected page that has no project yet at `projectId`,
     * and frees the pages this write dropped from it — so a share link follows
     * its project exactly as long as it is in it.
     */
    async linkProject({ projectId, pageIds }: { projectId: string; pageIds: string[] }): Promise<void> {
      const ids = JSON.stringify(pageIds);
      await db.batch([
        db
          .prepare(
            `UPDATE annotations SET project_id = NULL
             WHERE project_id = ? AND id NOT IN (SELECT value FROM json_each(?))`,
          )
          .bind(projectId, ids),
        db
          .prepare(
            `UPDATE annotations SET project_id = ?
             WHERE id IN (SELECT value FROM json_each(?))
               AND project_id IS NULL AND access = 'edit' AND password_hash IS NULL`,
          )
          .bind(projectId, ids),
      ]);
    },

    /** Frees every page of projects that no longer exist. */
    unlinkProjects(projectIds: string[]): Promise<unknown> {
      if (projectIds.length === 0) return Promise.resolve();
      return db
        .prepare('UPDATE annotations SET project_id = NULL WHERE project_id IN (SELECT value FROM json_each(?))')
        .bind(JSON.stringify(projectIds))
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

    /**
     * Mint the row. A weak id may not mint one — the id is the room's only access
     * token, and one short enough to guess may not become a room — so this is
     * false without writing. A row that appeared in the meantime (two first
     * flushes racing) keeps its metadata and takes these ops.
     */
    async create({
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
      if (!isNewShareId(id)) return false;
      await db
        .prepare(
          `INSERT INTO annotations (id, ops, url, width, expires_at) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET ops = excluded.ops, url = COALESCE(excluded.url, url), width = COALESCE(excluded.width, width), last_accessed_at = unixepoch()`,
        )
        .bind(id, JSON.stringify(ops), url, width, expiresAt)
        .run();
      return true;
    },

    /**
     * The REST save's metadata half. `url` and `width` only ever fill in; `expiresAt`
     * is written only when the caller sent one (`null` clears it), so a save that
     * says nothing about expiry keeps the one the link has. False for no such row.
     */
    async updateMeta({
      id,
      url,
      width,
      expiresAt,
    }: {
      id: string;
      url: string | null;
      width: number | null;
      expiresAt?: number | null;
    }): Promise<boolean> {
      const res =
        expiresAt === undefined
          ? await db
              .prepare(
                'UPDATE annotations SET url = COALESCE(?, url), width = COALESCE(?, width), last_accessed_at = unixepoch() WHERE id = ?',
              )
              .bind(url, width, id)
              .run()
          : await db
              .prepare(
                'UPDATE annotations SET url = COALESCE(?, url), width = COALESCE(?, width), expires_at = ?, last_accessed_at = unixepoch() WHERE id = ?',
              )
              .bind(url, width, expiresAt, id)
              .run();
      return wroteRow(res);
    },

    /**
     * The room's flush. An UPDATE and never an insert: a row that is not there
     * was deleted behind the room, and a flush must not bring it back. `create`
     * is the only insert, and the room calls it only for a row it never found.
     */
    async putOps({ id, ops }: { id: string; ops: unknown[] }): Promise<OpsWrite> {
      const res = await db
        .prepare('UPDATE annotations SET ops = ?, last_accessed_at = unixepoch() WHERE id = ?')
        .bind(JSON.stringify(ops), id)
        .run();
      return wroteRow(res) ? 'written' : 'gone';
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

    // The owner's columns. Every statement carries `owner_id`, so a guessed id alone reaches nothing.

    /** Links a person has claimed, most recently touched first. */
    async listOwned(ownerId: string): Promise<OwnedLink[]> {
      const res = await db
        .prepare(
          'SELECT id, url, created_at, last_accessed_at, expires_at, access, owner_expires_at, folder_id, password_hash IS NOT NULL AS password_protected FROM annotations WHERE owner_id = ? ORDER BY last_accessed_at DESC LIMIT 200',
        )
        .bind(ownerId)
        .all<{
          id: string;
          url: string | null;
          created_at: number;
          last_accessed_at: number;
          expires_at: number | null;
          access: string;
          owner_expires_at: number | null;
          folder_id: string | null;
          password_protected: number | null;
        }>();
      return res.results.map((row) => ({
        id: row.id,
        url: row.url,
        createdAt: row.created_at,
        lastAccessedAt: row.last_accessed_at,
        expiresAt: row.expires_at,
        access: parseLinkAccess(row.access),
        ownerExpiresAt: row.owner_expires_at,
        folderId: row.folder_id,
        // SQLite answers the IS NOT NULL as 0/1.
        passwordProtected: row.password_protected === 1,
      }));
    },

    /**
     * Sets, replaces or (with `hash: null`) removes the password, bumping the
     * generation every time so each unlock cookie issued before it stops working.
     * Returns the new generation, or null when this session does not own the link.
     */
    async setPassword({
      id,
      ownerId,
      hash,
    }: {
      id: string;
      ownerId: string;
      hash: string | null;
    }): Promise<number | null> {
      const row = await db
        .prepare(
          'UPDATE annotations SET password_hash = ?, password_gen = password_gen + 1 WHERE id = ? AND owner_id = ? RETURNING password_gen',
        )
        .bind(hash, id, ownerId)
        .first<{ password_gen: number }>();
      return row?.password_gen ?? null;
    },

    /** A claimed link's settings, or null when this session does not own it. */
    async getSettings({
      id,
      ownerId,
    }: {
      id: string;
      ownerId: string;
    }): Promise<{ access: LinkAccess; ownerExpiresAt: number | null } | null> {
      const row = await db
        .prepare('SELECT access, owner_expires_at FROM annotations WHERE id = ? AND owner_id = ?')
        .bind(id, ownerId)
        .first<{ access: string; owner_expires_at: number | null }>();
      if (!row) return null;
      return { access: parseLinkAccess(row.access), ownerExpiresAt: row.owner_expires_at };
    },

    /** Takes resolved values — the route decides what a partial PATCH means. */
    async updateSettings({
      id,
      ownerId,
      access,
      ownerExpiresAt,
    }: {
      id: string;
      ownerId: string;
      access: LinkAccess;
      ownerExpiresAt: number | null;
    }): Promise<boolean> {
      const res = await db
        .prepare('UPDATE annotations SET access = ?, owner_expires_at = ? WHERE id = ? AND owner_id = ?')
        .bind(access, ownerExpiresAt, id, ownerId)
        .run();
      return wroteRow(res);
    },

    /**
     * Claims an unowned link. The `owner_id IS NULL` guard is the whole
     * authorization model: anyone holding the id may claim it once, and nobody
     * can take one that is already claimed.
     */
    async claim({ id, ownerId }: { id: string; ownerId: string }): Promise<boolean> {
      const res = await db
        .prepare('UPDATE annotations SET owner_id = ? WHERE id = ? AND owner_id IS NULL')
        .bind(ownerId, id)
        .run();
      return wroteRow(res);
    },

    /**
     * Also resets `access`, `owner_expires_at` and the password: all are
     * owner-managed settings, and with `owner_id` gone `getSettings`'s
     * `AND owner_id = ?` guard would make either permanent. Returns the password
     * generation the release moved to (the room revokes sessions by it), or null
     * when this session does not own the link.
     */
    async release({ id, ownerId }: { id: string; ownerId: string }): Promise<{ gen: number } | null> {
      const row = await db
        .prepare(
          `UPDATE annotations SET owner_id = NULL, access = 'edit', owner_expires_at = NULL, folder_id = NULL,
             password_hash = NULL, password_gen = password_gen + 1
           WHERE id = ? AND owner_id = ? RETURNING password_gen`,
        )
        .bind(id, ownerId)
        .first<{ password_gen: number }>();
      return row ? { gen: row.password_gen } : null;
    },

    /**
     * Files a link, or unfiles it with `folderId: null`. Both halves are
     * owner-guarded in one statement: a guessed folder id must not file a link
     * into someone else's list.
     */
    async move({ id, ownerId, folderId }: { id: string; ownerId: string; folderId: string | null }): Promise<boolean> {
      const res = await db
        .prepare(
          `UPDATE annotations SET folder_id = ? WHERE id = ? AND owner_id = ?
           AND (? IS NULL OR EXISTS (SELECT 1 FROM folders WHERE id = ? AND owner_id = ?))`,
        )
        .bind(folderId, id, ownerId, folderId, folderId, ownerId)
        .run();
      return wroteRow(res);
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

    /**
     * Create or replace. A weak id may only update a project that already exists,
     * the same floor `annotationStore.create` holds; false reports the refusal.
     * `expiresAt` undefined keeps the current expiry.
     */
    async put({
      id,
      pageIds,
      expiresAt,
    }: {
      id: string;
      pageIds: string[];
      expiresAt?: number | null;
    }): Promise<boolean> {
      const ids = JSON.stringify(pageIds);
      if (!isNewShareId(id)) {
        const res =
          expiresAt === undefined
            ? await db
                .prepare('UPDATE projects SET page_ids = ?, last_accessed_at = unixepoch() WHERE id = ?')
                .bind(ids, id)
                .run()
            : await db
                .prepare(
                  'UPDATE projects SET page_ids = ?, expires_at = ?, last_accessed_at = unixepoch() WHERE id = ?',
                )
                .bind(ids, expiresAt, id)
                .run();
        return wroteRow(res);
      }
      await db
        .prepare(
          `INSERT INTO projects (id, page_ids, expires_at) VALUES (?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET page_ids = excluded.page_ids,
             expires_at = CASE WHEN ? THEN excluded.expires_at ELSE expires_at END,
             last_accessed_at = unixepoch()`,
        )
        .bind(id, ids, expiresAt ?? null, expiresAt === undefined ? 0 : 1)
        .run();
      return true;
    },

    touch(id: string): Promise<unknown> {
      return db.prepare('UPDATE projects SET last_accessed_at = unixepoch() WHERE id = ?').bind(id).run();
    },

    remove(id: string): Promise<unknown> {
      return db.prepare('DELETE FROM projects WHERE id = ?').bind(id).run();
    },

    /** Same deadline rule as annotations: a project holding a claimed page has no idle window. */
    async deleteExpired({ unusedSince }: { unusedSince: number }): Promise<string[]> {
      const deleted = await db
        .prepare(
          `DELETE FROM projects WHERE (last_accessed_at < ? AND ${NO_OWNED_PAGE})
           OR (expires_at IS NOT NULL AND expires_at < ?) RETURNING id`,
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

    /**
     * Idle uploads, except those a claimed link still points at (its page `url`,
     * or an attachment inside its ops). Nothing sets `uploads.expires_at`, so the
     * idle window is the only clock.
     */
    async deleteExpired({ unusedSince }: { unusedSince: number }): Promise<string[]> {
      const deleted = await db
        .prepare(
          `DELETE FROM uploads WHERE last_accessed_at < ?
           AND NOT EXISTS (SELECT 1 FROM annotations a WHERE a.owner_id IS NOT NULL
             AND (a.url LIKE '%/f/' || uploads.id OR instr(a.ops, uploads.id) > 0))
           RETURNING id`,
        )
        .bind(unusedSince)
        .all<{ id: string }>();
      return deleted.results.map((r) => r.id);
    },
  };
}
