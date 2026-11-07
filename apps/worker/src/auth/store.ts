import { LOGIN_TOKEN_TTL_SECONDS } from '@marklayer/brand';
import { nanoid } from 'nanoid';
import type { Folder } from '../../shared/accounts';
import { annotationStore } from '../store';
import { isExpired, nowInSeconds } from '../time';
import { throttleRemaining } from './mail-throttle';
import { hashToken } from './tokens';
import { SEEN_BUMP_SECONDS, SESSION_TTL_SECONDS, type User } from './types';

/**
 * One factory per concern, mirroring `store.ts` — the caller passes the D1
 * binding rather than the module reaching for it, which is what keeps these
 * testable against a fake database.
 */
export function authStore(db: D1Database) {
  return {
    /**
     * Records a pending sign-in. Returns the seconds until the caller may ask
     * again, or 0 when the request should proceed: one unredeemed link per
     * address per window, so a form left on repeat cannot drain the send quota
     * or bury someone's inbox.
     */
    async throttleSeconds(email: string): Promise<number> {
      const row = await db
        .prepare(
          'SELECT created_at FROM login_tokens WHERE email = ? AND used_at IS NULL ORDER BY created_at DESC LIMIT 1',
        )
        .bind(email)
        .first<{ created_at: number }>();
      return throttleRemaining(row?.created_at);
    },

    async createLoginToken({ email, token }: { email: string; token: string }): Promise<void> {
      await db
        .prepare('INSERT INTO login_tokens (id, email, expires_at) VALUES (?, ?, ?)')
        .bind(await hashToken(token), email, nowInSeconds() + LOGIN_TOKEN_TTL_SECONDS)
        .run();
    },

    /**
     * Consumes a magic link, returning the address it was issued to.
     *
     * The UPDATE carries the single-use check in its WHERE clause rather than
     * reading first and writing after: two tabs opening the same link race, and
     * only the one whose write matches a row may proceed. RETURNING makes that
     * one round trip, and the winner is the one that gets a row back.
     */
    async redeemLoginToken(token: string): Promise<string | null> {
      const now = nowInSeconds();
      const row = await db
        .prepare(
          'UPDATE login_tokens SET used_at = ? WHERE id = ? AND used_at IS NULL AND expires_at > ? RETURNING email',
        )
        .bind(now, await hashToken(token), now)
        .first<{ email: string }>();
      return row?.email ?? null;
    },

    /**
     * Sign-in is also sign-up: there is no separate registration step to abandon.
     *
     * One upsert rather than a read-then-write, so two links redeemed at once
     * cannot both decide the account is new. The generated id is discarded on
     * conflict — `email` is UNIQUE, so the existing row's id comes back instead.
     */
    async upsertUser(email: string): Promise<User | null> {
      const row = await db
        .prepare(
          'INSERT INTO users (id, email) VALUES (?, ?) ON CONFLICT(email) DO UPDATE SET last_seen_at = ? RETURNING id, email',
        )
        .bind(nanoid(), email, nowInSeconds())
        .first<User>();
      return row;
    },

    async createSession({ userId, token }: { userId: string; token: string }): Promise<void> {
      await db
        .prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)')
        .bind(await hashToken(token), userId, nowInSeconds() + SESSION_TTL_SECONDS)
        .run();
    },

    /**
     * Resolves a session, and keeps `users.last_seen_at` meaning what it says.
     *
     * A session lasts 30 days, so before this the column only moved when someone
     * redeemed a magic link: it recorded re-authentication, not use, and a
     * return-rate read off it was near zero by construction. Bumped at most once
     * a day per user, which is why the SELECT carries the column at all.
     */
    async userForSession(token: string): Promise<User | null> {
      const row = await db
        .prepare(
          'SELECT users.id AS id, users.email AS email, users.last_seen_at AS last_seen_at, sessions.expires_at AS expires_at FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.id = ?',
        )
        .bind(await hashToken(token))
        .first<{ id: string; email: string; last_seen_at: number | null; expires_at: number }>();
      if (!row || isExpired(row.expires_at)) return null;
      const now = nowInSeconds();
      if ((row.last_seen_at ?? 0) < now - SEEN_BUMP_SECONDS) {
        await db.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').bind(now, row.id).run();
      }
      return { id: row.id, email: row.email };
    },

    async deleteSession(token: string): Promise<void> {
      await db
        .prepare('DELETE FROM sessions WHERE id = ?')
        .bind(await hashToken(token))
        .run();
    },

    /** Called by the existing retention cron; expired rows are dead weight, not history. */
    async sweepExpired(): Promise<void> {
      const now = nowInSeconds();
      await db.batch([
        db.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now),
        db.prepare('DELETE FROM login_tokens WHERE expires_at < ?').bind(now),
      ]);
    },
  };
}

/**
 * The owner's view of the `annotations` table. The SQL lives in `annotationStore`
 * (one store per table); this keeps the names the routes and tests call.
 */
export function ownedStore(db: D1Database) {
  const annotations = annotationStore(db);
  return {
    listAnnotations: annotations.listOwned,
    setPassword: annotations.setPassword,
    getSettings: annotations.getSettings,
    updateSettings: annotations.updateSettings,
    claimAnnotation: annotations.claim,
    releaseAnnotationGen: annotations.release,
    moveAnnotation: annotations.move,
  };
}

/** Every statement carries `owner_id`, so a folder id alone reaches nothing. */
export function folderStore(db: D1Database) {
  return {
    async list(ownerId: string): Promise<Folder[]> {
      const res = await db
        .prepare('SELECT id, name, created_at FROM folders WHERE owner_id = ? ORDER BY name COLLATE NOCASE')
        .bind(ownerId)
        .all<{ id: string; name: string; created_at: number }>();
      return res.results.map((row) => ({ id: row.id, name: row.name, createdAt: row.created_at }));
    },

    async create({ ownerId, name }: { ownerId: string; name: string }): Promise<Folder> {
      const folder = { id: nanoid(), name, createdAt: nowInSeconds() };
      await db
        .prepare('INSERT INTO folders (id, owner_id, name, created_at) VALUES (?, ?, ?, ?)')
        .bind(folder.id, ownerId, name, folder.createdAt)
        .run();
      return folder;
    },

    async rename({ id, ownerId, name }: { id: string; ownerId: string; name: string }): Promise<boolean> {
      const res = await db
        .prepare('UPDATE folders SET name = ? WHERE id = ? AND owner_id = ?')
        .bind(name, id, ownerId)
        .run();
      return (res.meta.changes ?? 0) > 0;
    },

    /** Its links fall back to unfiled; none are deleted. */
    async remove({ id, ownerId }: { id: string; ownerId: string }): Promise<boolean> {
      await db
        .prepare('UPDATE annotations SET folder_id = NULL WHERE folder_id = ? AND owner_id = ?')
        .bind(id, ownerId)
        .run();
      const res = await db.prepare('DELETE FROM folders WHERE id = ? AND owner_id = ?').bind(id, ownerId).run();
      return (res.meta.changes ?? 0) > 0;
    },
  };
}
