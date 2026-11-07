import { describe, expect, test } from 'bun:test';
import { RETENTION_DAYS } from '@marklayer/brand';
import { canEditLink, deletionDeadline, effectiveExpiresAt } from './accounts';

describe('effectiveExpiresAt', () => {
  test('is null when neither the link nor its owner set a deadline', () => {
    expect(effectiveExpiresAt({ expiresAt: null, ownerExpiresAt: null })).toBeNull();
  });

  test('falls back to whichever one is set', () => {
    expect(effectiveExpiresAt({ expiresAt: 100, ownerExpiresAt: null })).toBe(100);
    expect(effectiveExpiresAt({ expiresAt: null, ownerExpiresAt: 200 })).toBe(200);
  });

  // The bug this guards: a route that read only `expiresAt` kept an owner-expired
  // link fully live until the retention cron's next sweep.
  test('takes the earlier of the two when both are set', () => {
    expect(effectiveExpiresAt({ expiresAt: 200, ownerExpiresAt: 100 })).toBe(100);
    expect(effectiveExpiresAt({ expiresAt: 100, ownerExpiresAt: 200 })).toBe(100);
  });
});

describe('deletionDeadline', () => {
  const DAY = 24 * 60 * 60;
  const lastAccessedAt = 1_700_000_000;

  test('is the idle window when no explicit expiry is set', () => {
    expect(deletionDeadline({ lastAccessedAt, expiresAt: null })).toBe(lastAccessedAt + RETENTION_DAYS * DAY);
  });

  test('an explicit expiry brings the date forward, it does not replace the window', () => {
    // The cron's condition is an OR, so whichever comes first wins. Reading it as
    // "expiry instead of the window" is how a countdown outlives its own row.
    const soon = lastAccessedAt + 5 * DAY;
    expect(deletionDeadline({ lastAccessedAt, expiresAt: soon })).toBe(soon);
    const late = lastAccessedAt + 500 * DAY;
    expect(deletionDeadline({ lastAccessedAt, expiresAt: late })).toBe(lastAccessedAt + RETENTION_DAYS * DAY);
  });

  // The reason the dashboard exists: signing in and keeping a link has to mean
  // the link is kept. `deleteExpired` gates the same clause on `owner_id IS NULL`.
  test('a claimed link with no chosen expiry is never deleted', () => {
    expect(deletionDeadline({ lastAccessedAt, expiresAt: null, owned: true })).toBeNull();
  });

  test('a claimed link still honours an expiry someone actually chose', () => {
    const soon = lastAccessedAt + 5 * DAY;
    expect(deletionDeadline({ lastAccessedAt, expiresAt: null, ownerExpiresAt: soon, owned: true })).toBe(soon);
    expect(deletionDeadline({ lastAccessedAt, expiresAt: soon, ownerExpiresAt: null, owned: true })).toBe(soon);
  });

  test('being claimed lifts the idle window rather than capping at it', () => {
    // Unowned, an expiry past the window is clamped back to the window. Owned,
    // there is no window to clamp to and the far date is the real answer.
    const late = lastAccessedAt + 500 * DAY;
    expect(deletionDeadline({ lastAccessedAt, expiresAt: late })).toBe(lastAccessedAt + RETENTION_DAYS * DAY);
    expect(deletionDeadline({ lastAccessedAt, expiresAt: late, owned: true })).toBe(late);
  });
});

describe('canEditLink', () => {
  const cases = [
    { access: 'edit', ownerId: null, userId: null, want: true },
    { access: 'view', ownerId: 'u1', userId: 'u1', want: true },
    { access: 'view', ownerId: 'u1', userId: 'u2', want: false },
    { access: 'view', ownerId: 'u1', userId: undefined, want: false },
    // An unowned room and an anonymous viewer both carry null; that must not read as "the owner".
    { access: 'view', ownerId: null, userId: null, want: false },
  ] as const;

  for (const { want, ...link } of cases) {
    test(`${JSON.stringify(link)} -> ${want}`, () => {
      expect(canEditLink(link)).toBe(want);
    });
  }
});
