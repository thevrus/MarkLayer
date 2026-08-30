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

export function annotationStore(db: D1Database) {
  return {
    async get(id: string): Promise<StoredAnnotation | null> {
      const row = await db
        .prepare('SELECT ops, url, width, created_at, expires_at FROM annotations WHERE id = ?')
        .bind(id)
        .first<{
          ops: string;
          url: string | null;
          width: number | null;
          created_at: number | null;
          expires_at: number | null;
        }>();
      if (!row) return null;
      return {
        ops: parseJsonArray(row.ops),
        url: row.url,
        width: row.width,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
      };
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
    }): Promise<void> {
      await db
        .prepare(
          `INSERT INTO annotations (id, ops, url, width, expires_at) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET ops = excluded.ops, url = COALESCE(excluded.url, url), width = COALESCE(excluded.width, width), expires_at = excluded.expires_at`,
        )
        .bind(id, JSON.stringify(ops), url, width, expiresAt)
        .run();
    },

    /** Write ops alone, preserving url/width/expiry — the realtime room's flush. */
    async putOps({ id, ops }: { id: string; ops: unknown[] }): Promise<void> {
      await db
        .prepare(
          `INSERT INTO annotations (id, ops, last_accessed_at) VALUES (?, ?, unixepoch())
           ON CONFLICT(id) DO UPDATE SET ops = excluded.ops, last_accessed_at = unixepoch()`,
        )
        .bind(id, JSON.stringify(ops))
        .run();
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
      return (res.meta.changes ?? 0) > 0;
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

    /** Ids of everything past retention or its own expiry, now deleted. */
    async deleteExpired({ unusedSince }: { unusedSince: number }): Promise<string[]> {
      const deleted = await db
        .prepare(
          'DELETE FROM annotations WHERE last_accessed_at < ? OR (expires_at IS NOT NULL AND expires_at < ?) RETURNING id',
        )
        .bind(unusedSince, nowInSeconds())
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

    async put({ id, pageIds, expiresAt }: { id: string; pageIds: string[]; expiresAt: number | null }): Promise<void> {
      await db
        .prepare(
          `INSERT INTO projects (id, page_ids, expires_at) VALUES (?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET page_ids = excluded.page_ids, expires_at = excluded.expires_at, last_accessed_at = unixepoch()`,
        )
        .bind(id, JSON.stringify(pageIds), expiresAt)
        .run();
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
