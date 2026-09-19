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

    /** Just the annotated page's URL — the only column the OG routes need. */
    async getUrl(id: string): Promise<string | null> {
      const row = await db.prepare('SELECT url FROM annotations WHERE id = ?').bind(id).first<{ url: string | null }>();
      return row?.url ?? null;
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
