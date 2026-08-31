import type { SessionUser } from '@marklayer/types';
import type { EmailEnv } from '../email';

/** Auth needs a database and whatever the email engine needs; it defines neither itself. */
export type AuthEnv = EmailEnv & { DB: D1Database };

/**
 * The same shape `/auth/me` returns, inferred from the schema both sides parse
 * with, so the row this store reads and the object the dashboard receives cannot
 * drift apart.
 */
export type User = SessionUser;

/** How long a magic link stays redeemable. Short: it is a single-use credential in someone's inbox. */
export const LOGIN_TOKEN_TTL_SECONDS = 15 * 60;

/** How long a signed-in session lasts without re-authenticating. */
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

export const SESSION_COOKIE = 'ml_session';

/**
 * Deliberately permissive. The only real proof an address exists is that the
 * link arrives, so this rejects the shapes that cannot be an address at all and
 * leaves the rest to delivery — a stricter pattern only ever turns away real
 * people with unusual addresses.
 */
export function normalizeEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  if (email.length < 3 || email.length > 254) return null;
  const at = email.indexOf('@');
  if (at < 1 || at !== email.lastIndexOf('@')) return null;
  const domain = email.slice(at + 1);
  if (!domain.includes('.') || domain.startsWith('.') || domain.endsWith('.')) return null;
  if (/\s/.test(email)) return null;
  return email;
}
