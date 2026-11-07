import { nanoid } from 'nanoid';
import { nowInSeconds } from '../time';

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
