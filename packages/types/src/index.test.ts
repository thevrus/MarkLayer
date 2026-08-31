import { describe, expect, test } from 'bun:test';
import {
  applyOpPatch,
  type CommentOp,
  clientMsgSchema,
  cn,
  type DrawOp,
  deletionDeadline,
  type Mention,
  mentionSegments,
  normalizeSuggestion,
  RETENTION_DAYS,
  resolveOpStatus,
  translateOp,
  UPLOAD_ACCEPT,
  UPLOAD_FORMATS,
} from './index';

const comment: CommentOp = {
  id: 'op1',
  tool: 'comment',
  num: 1,
  text: 'needs a darker border',
  x: 10,
  y: 20,
  color: '#ff0000',
  lineWidth: 2,
  ts: 1_700_000_000_000,
  author: 'Ada',
};

describe('applyOpPatch', () => {
  test('merges a valid patch and returns the parsed op', () => {
    const merged = applyOpPatch({ op: comment, patch: { status: 'resolved' } });
    expect(merged).not.toBeNull();
    expect(merged?.id).toBe('op1');
    expect(merged?.tool).toBe('comment');
    if (merged?.tool === 'comment') expect(merged.status).toBe('resolved');
  });

  test('leaves fields the patch does not mention', () => {
    const merged = applyOpPatch({ op: comment, patch: { priority: 'high' } });
    if (merged?.tool === 'comment') {
      expect(merged.text).toBe('needs a darker border');
      expect(merged.priority).toBe('high');
    }
  });

  // The regression this module exists to prevent: a bad patch used to be merged,
  // broadcast to every peer, and flushed to D1 verbatim.
  test('rejects a patch that violates the schema', () => {
    expect(applyOpPatch({ op: comment, patch: { status: 'not-a-status' } })).toBeNull();
    expect(applyOpPatch({ op: comment, patch: { x: 'over there' } })).toBeNull();
  });

  // Unassign travels as an explicit null so it survives JSON.stringify on the wire.
  test('accepts an assignee, and null to clear it', () => {
    const assigned = applyOpPatch({ op: comment, patch: { assignee: 'Grace' } });
    if (assigned?.tool === 'comment') expect(assigned.assignee).toBe('Grace');
    const cleared = applyOpPatch({ op: assigned, patch: { assignee: null } });
    expect(cleared).not.toBeNull();
    if (cleared?.tool === 'comment') expect(cleared.assignee).toBeNull();
    expect(applyOpPatch({ op: comment, patch: { assignee: 42 } })).toBeNull();
  });

  // Same reason as the assignee above: `{ priority: undefined }` serializes to
  // `{}`, which every peer reads as "unchanged", so clearing has to send null.
  test('accepts a priority, and null to clear it', () => {
    const raised = applyOpPatch({ op: comment, patch: { priority: 'urgent' } });
    if (raised?.tool === 'comment') expect(raised.priority).toBe('urgent');
    const cleared = applyOpPatch({ op: raised, patch: { priority: null } });
    expect(cleared).not.toBeNull();
    if (cleared?.tool === 'comment') expect(cleared.priority).toBeNull();
    expect(applyOpPatch({ op: comment, patch: { priority: 'catastrophic' } })).toBeNull();
  });

  test('rejects a patch that would change the op into another tool', () => {
    expect(applyOpPatch({ op: comment, patch: { tool: 'guide' } })).toBeNull();
  });

  test('rejects a stored op that is not an op at all', () => {
    expect(applyOpPatch({ op: null, patch: { status: 'open' } })).toBeNull();
    expect(applyOpPatch({ op: 'nonsense', patch: { status: 'open' } })).toBeNull();
    expect(applyOpPatch({ op: { id: 'x' }, patch: { status: 'open' } })).toBeNull();
  });

  // Load-bearing, and the one invariant nothing else pins. `update_op` is the only
  // message the room broadcasts back to its own sender (annotation-room.ts:272 passes
  // no exclude, where `op` and `undo` both pass `ws`), so whoever sent a patch applies
  // it twice — once locally, once on the echo. That is only safe while a patch is an
  // absolute field merge. A relative one ('+1') would double-count for the sender alone,
  // which is the hardest kind of drift to see: every other peer stays correct.
  test('applying the same patch twice lands where applying it once did', () => {
    const once = applyOpPatch({ op: comment, patch: { status: 'resolved', priority: 'high' } });
    expect(once).not.toBeNull();
    if (!once) return;
    expect(applyOpPatch({ op: once, patch: { status: 'resolved', priority: 'high' } })).toEqual(once);
  });
});

describe('resolveOpStatus', () => {
  test('prefers an explicit status', () => {
    expect(resolveOpStatus({ ...comment, status: 'in_progress' })).toBe('in_progress');
  });

  test('falls back to open when nothing is set', () => {
    expect(resolveOpStatus(comment)).toBe('open');
  });

  // Ops written before `status` existed carry only this boolean.
  test('reads the legacy resolved boolean on comments', () => {
    expect(resolveOpStatus({ ...comment, resolved: true })).toBe('resolved');
    expect(resolveOpStatus({ ...comment, resolved: false })).toBe('open');
  });

  // setOpStatus writes `resolved: true` alongside an approval, so a reader that
  // only knows the boolean still sees a finished thread. The status has to win
  // anyway, or approving a comment would read back as merely resolved.
  test('an explicit approved beats the resolved boolean beside it', () => {
    expect(resolveOpStatus({ ...comment, status: 'approved', resolved: true })).toBe('approved');
  });

  test('an explicit status wins over the legacy boolean', () => {
    expect(resolveOpStatus({ ...comment, resolved: true, status: 'open' })).toBe('open');
  });
});

describe('normalizeSuggestion', () => {
  test('keeps a real replacement, trimmed', () => {
    expect(normalizeSuggestion({ text: 'Sign up free', suggestion: '  Start free  ' })).toBe('Start free');
  });

  // The field opens pre-filled with the original, so "opened it and left it alone"
  // is the common case and must not reach the op as a diff with identical sides.
  test('drops a suggestion that matches the text it replaces', () => {
    expect(normalizeSuggestion({ text: 'Sign up free', suggestion: 'Sign up free' })).toBeUndefined();
    expect(normalizeSuggestion({ text: ' Sign up free ', suggestion: 'Sign up free' })).toBeUndefined();
  });

  test('drops an empty, whitespace-only, or absent suggestion', () => {
    expect(normalizeSuggestion({ text: 'Sign up free', suggestion: '' })).toBeUndefined();
    expect(normalizeSuggestion({ text: 'Sign up free', suggestion: '   ' })).toBeUndefined();
    expect(normalizeSuggestion({ text: 'Sign up free', suggestion: null })).toBeUndefined();
    expect(normalizeSuggestion({ text: 'Sign up free', suggestion: undefined })).toBeUndefined();
  });
});

describe('translateOp', () => {
  const base = { id: 'op1', color: '#ff0000', lineWidth: 2 };

  test('shifts every coordinate a tool carries', () => {
    const pen: DrawOp = { ...base, tool: 'pen', points: [{ x: 1, y: 2 }], compositeOperation: 'source-over' };
    expect(translateOp({ op: pen, dx: 5, dy: 7 })).toMatchObject({ points: [{ x: 6, y: 9 }] });

    const rect: DrawOp = { ...base, tool: 'rectangle', startX: 0, startY: 0, endX: 10, endY: 20 };
    expect(translateOp({ op: rect, dx: 5, dy: 7 })).toMatchObject({ startX: 5, startY: 7, endX: 15, endY: 27 });

    const circle: DrawOp = { ...base, tool: 'circle', centerX: 4, centerY: 6, radius: 1 };
    expect(translateOp({ op: circle, dx: 5, dy: 7 })).toMatchObject({ centerX: 9, centerY: 13 });
  });

  // These own a thread, a text range, an element handoff, an axis, or are a
  // subtraction from the strokes beneath them — a moved copy means nothing.
  test('refuses the ops a copy would be meaningless for', () => {
    expect(translateOp({ op: comment, dx: 5, dy: 7 })).toBeNull();
    const guide: DrawOp = { ...base, tool: 'guide', orientation: 'vertical', position: 100 };
    expect(translateOp({ op: guide, dx: 5, dy: 7 })).toBeNull();
  });

  test('leaves the original untouched', () => {
    const rect: DrawOp = { ...base, tool: 'rectangle', startX: 0, startY: 0, endX: 10, endY: 20 };
    translateOp({ op: rect, dx: 5, dy: 7 });
    expect(rect.startX).toBe(0);
  });
});

describe('cn', () => {
  // tailwind-merge resolves an unknown `text-*` to the colour group, so before the
  // type scale was declared to it every one of these dropped its size and the
  // element fell back to the inherited 16px — silently, in both apps' chrome.
  test('keeps a type-scale size beside a text colour', () => {
    expect(cn('text-meta font-medium', 'text-inherit')).toBe('text-meta font-medium text-inherit');
    expect(cn('text-ui text-(--ds-gray-900)')).toBe('text-ui text-(--ds-gray-900)');
    expect(cn('text-mini', 'text-red-500')).toBe('text-mini text-red-500');
  });

  test('still merges two sizes, and two colours', () => {
    expect(cn('text-meta', 'text-ui')).toBe('text-ui');
    expect(cn('text-red-500', 'text-(--ds-gray-900)')).toBe('text-(--ds-gray-900)');
  });
});

// The wire schema is the only thing standing between a client message and the
// broadcast: an unparsed type is dropped silently by the Durable Object, so a
// feature can look wired up on both ends and simply never cross.
describe('clientMsgSchema', () => {
  test('accepts a flock toggle in both directions', () => {
    expect(clientMsgSchema.safeParse({ type: 'flock', on: true }).success).toBe(true);
    expect(clientMsgSchema.safeParse({ type: 'flock', on: false }).success).toBe(true);
  });

  test('rejects a flock message with no state to apply', () => {
    expect(clientMsgSchema.safeParse({ type: 'flock' }).success).toBe(false);
    expect(clientMsgSchema.safeParse({ type: 'flock', on: 'yes' }).success).toBe(false);
  });
});

// Display names contain spaces, so tokenising has to be driven by the op's own
// mention list. A regex over the text splits "@Speedy Axolotl" into a tag plus a
// stray word, which renders as a half-highlighted name in every thread.
describe('mentionSegments', () => {
  const speedy: Mention = { id: 'c1', name: 'Speedy Axolotl' };
  const speedyShort: Mention = { id: 'c2', name: 'Speedy' };

  test('tokenises a multi-word name as one mention', () => {
    expect(mentionSegments({ text: 'hey @Speedy Axolotl look', mentions: [speedy] })).toEqual([
      { text: 'hey ' },
      { text: '@Speedy Axolotl', mention: speedy },
      { text: ' look' },
    ]);
  });

  test('prefers the longest matching name', () => {
    const segments = mentionSegments({ text: '@Speedy Axolotl', mentions: [speedyShort, speedy] });
    expect(segments).toEqual([{ text: '@Speedy Axolotl', mention: speedy }]);
  });

  test('matches case-insensitively but keeps what was typed', () => {
    expect(mentionSegments({ text: '@speedy axolotl!', mentions: [speedy] })).toEqual([
      { text: '@speedy axolotl', mention: speedy },
      { text: '!' },
    ]);
  });

  test('leaves an unmatched @ and a stale mention as prose', () => {
    expect(mentionSegments({ text: 'email a@b.com', mentions: [speedy] })).toEqual([{ text: 'email a@b.com' }]);
    expect(mentionSegments({ text: 'they left', mentions: [speedy] })).toEqual([{ text: 'they left' }]);
  });

  test('tokenises two mentions in one body', () => {
    const other: Mention = { id: 'c3', name: 'Jazzy Quokka' };
    expect(mentionSegments({ text: '@Speedy Axolotl and @Jazzy Quokka', mentions: [speedy, other] })).toEqual([
      { text: '@Speedy Axolotl', mention: speedy },
      { text: ' and ' },
      { text: '@Jazzy Quokka', mention: other },
    ]);
  });

  test('returns the whole body untouched when nothing is tagged', () => {
    expect(mentionSegments({ text: 'plain note', mentions: [] })).toEqual([{ text: 'plain note' }]);
    expect(mentionSegments({ text: 'plain note' })).toEqual([{ text: 'plain note' }]);
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
});

describe('UPLOAD_ACCEPT', () => {
  test('offers exactly the formats the sniffer recognises', () => {
    // Derived rather than hand-listed: the two disagreeing is how a person is
    // offered a file that the server then refuses.
    expect(UPLOAD_ACCEPT.split(',')).toEqual(UPLOAD_FORMATS.map((format) => format.contentType));
    expect(UPLOAD_ACCEPT).not.toContain('svg');
  });
});
