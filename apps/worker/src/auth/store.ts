import type { OwnedLink } from '@marklayer/types';
import { nanoid } from 'nanoid';
import { isExpired, nowInSeconds } from '../store';
import { hashToken } from './tokens';
import { LOGIN_TOKEN_TTL_SECONDS, SESSION_TTL_SECONDS, type User } from './types';

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
     * address per minute, so a form left on repeat cannot drain the send quota
     * or bury someone's inbox.
     */
    async throttleSeconds(email: string): Promise<number> {
      const row = await db
        .prepare(
          'SELECT created_at FROM login_tokens WHERE email = ? AND used_at IS NULL ORDER BY created_at DESC LIMIT 1',
        )
        .bind(email)
        .first<{ created_at: number }>();
      if (!row) return 0;
      const elapsed = nowInSeconds() - row.created_at;
      return elapsed >= 60 ? 0 : 60 - elapsed;
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

    async userForSession(token: string): Promise<User | null> {
      const row = await db
        .prepare(
          'SELECT users.id AS id, users.email AS email, sessions.expires_at AS expires_at FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.id = ?',
        )
        .bind(await hashToken(token))
        .first<{ id: string; email: string; expires_at: number }>();
      if (!row || isExpired(row.expires_at)) return null;
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

/** Links a person has claimed, most recently touched first. */
export function ownedStore(db: D1Database) {
  return {
    async listAnnotations(ownerId: string): Promise<OwnedLink[]> {
      const res = await db
        .prepare(
          'SELECT id, url, created_at, last_accessed_at, expires_at FROM annotations WHERE owner_id = ? ORDER BY last_accessed_at DESC LIMIT 200',
        )
        .bind(ownerId)
        .all<{
          id: string;
          url: string | null;
          created_at: number;
          last_accessed_at: number;
          expires_at: number | null;
        }>();
      // Mapped here, not at the caller: snake_case is D1's shape and it should
      // stop at this boundary, the way it does in `store.ts`.
      return res.results.map((row) => ({
        id: row.id,
        url: row.url,
        createdAt: row.created_at,
        lastAccessedAt: row.last_accessed_at,
        expiresAt: row.expires_at,
      }));
    },

    /**
     * Claims an unowned link. The `owner_id IS NULL` guard is the whole
     * authorization model: anyone holding the id may claim it once, and nobody
     * can take one that is already claimed.
     */
    async claimAnnotation({ id, ownerId }: { id: string; ownerId: string }): Promise<boolean> {
      const res = await db
        .prepare('UPDATE annotations SET owner_id = ? WHERE id = ? AND owner_id IS NULL')
        .bind(ownerId, id)
        .run();
      return (res.meta.changes ?? 0) > 0;
    },

    async releaseAnnotation({ id, ownerId }: { id: string; ownerId: string }): Promise<boolean> {
      const res = await db
        .prepare('UPDATE annotations SET owner_id = NULL WHERE id = ? AND owner_id = ?')
        .bind(id, ownerId)
        .run();
      return (res.meta.changes ?? 0) > 0;
    },
  };
}
