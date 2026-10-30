import { describe, expect, test } from 'bun:test';
import {
  AGENT_FALLBACK_COLOR,
  agentColor,
  agentLabel,
  applyOpPatch,
  areaOpSchema,
  type CommentOp,
  canEditLink,
  clientMsgSchema,
  cn,
  commentMetaSchema,
  commentOpSchema,
  type DrawOp,
  deletionDeadline,
  effectiveExpiresAt,
  groupReactions,
  inspectOpSchema,
  isNewShareId,
  MAX_PAGE_ERROR_TEXT,
  MAX_PAGE_ERRORS,
  MAX_STYLE_EDITS,
  MAX_STYLE_VALUE,
  type Mention,
  MIN_SHARE_ID_LENGTH,
  mentionSegments,
  normalizeSuggestion,
  opAnchor,
  parseOps,
  type QuestionOp,
  RETENTION_DAYS,
  redactSharePath,
  resolveOpStatus,
  selectionOpSchema,
  type TargetElement,
  tallyQuestion,
  targetElementSchema,
  toggleReaction,
  translateOp,
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
describe('comment meta page errors', () => {
  const err = (message = 'boom') => ({ message, at: 1 });
  const withErrors = (errors: unknown) => commentMetaSchema.safeParse({ errors }).success;

  test('accepts up to the cap and rejects one more', () => {
    expect(withErrors(Array.from({ length: MAX_PAGE_ERRORS }, () => err()))).toBe(true);
    expect(withErrors(Array.from({ length: MAX_PAGE_ERRORS + 1 }, () => err()))).toBe(false);
  });

  test('rejects an oversize message or source', () => {
    expect(withErrors([err('x'.repeat(MAX_PAGE_ERROR_TEXT))])).toBe(true);
    expect(withErrors([err('x'.repeat(MAX_PAGE_ERROR_TEXT + 1))])).toBe(false);
    expect(withErrors([{ ...err(), source: 'x'.repeat(MAX_PAGE_ERROR_TEXT + 1) }])).toBe(false);
  });
});

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

describe('agent branding', () => {
  test('an unrecognised id is title-cased and claims no brand', () => {
    expect(agentLabel('my-cool-agent')).toBe('My Cool Agent');
    expect(agentColor('my-cool-agent')).toBe(AGENT_FALLBACK_COLOR);
    expect(agentLabel('CLAUDE-CODE')).toBe('Claude');
  });
});

describe('isNewShareId', () => {
  test('refuses an id short enough to guess', () => {
    // The whole point of the floor: these are the ids that let someone squat a
    // room or enumerate their way into one, because the id is the access token.
    for (const id of ['a', 'abc', 'aB3xY7kZ', '12345678901']) expect(isNewShareId(id)).toBe(false);
    expect(isNewShareId('a'.repeat(MIN_SHARE_ID_LENGTH))).toBe(true);
  });

  test('takes what the product and the docs actually mint', () => {
    // A real nanoid() rather than the call, so `types` stays dependency-free.
    expect(isNewShareId('dsWPMrdw6EZ8jkkhxvFKS')).toBe(true);
    expect(isNewShareId(crypto.randomUUID())).toBe(true);
  });

  test('refuses anything that could walk out of its own path', () => {
    for (const id of ['../../etc/passwd', 'abcdefghijkl/mno', 'abcdefghijkl?x=1', 'abcdefghijkl.json', ''])
      expect(isNewShareId(id)).toBe(false);
  });

  test('refuses an id too long to want as a primary key', () => {
    expect(isNewShareId('a'.repeat(64))).toBe(true);
    expect(isNewShareId('a'.repeat(65))).toBe(false);
  });
});

describe('redactSharePath', () => {
  test.each([
    ['/s/abc123XYZ', '/s/:id'],
    ['/s/abc123XYZ/mcp', '/s/:id/mcp'],
    ['/s/abc123XYZ?x=1', '/s/:id?x=1'],
  ])('hides the room id in %s', (input, expected) => {
    expect(redactSharePath(input)).toBe(expected);
  });

  test.each([
    '/',
    '/vs/markup-io',
    '/p/projectid',
    '/s/marklayer-live-demo-board',
    '/guides/s/abc',
    'https://x.test/s/abc',
  ])('leaves %s alone', (input) => {
    expect(redactSharePath(input)).toBe(input);
  });
});

describe('opAnchor', () => {
  const base = { id: 'op-1', color: '#000', lineWidth: 2, ts: 1, author: 'Ada' };

  // A reply posted onto a non-comment annotation used to be dropped entirely, so
  // these anchors are the difference between a resolve summary the human reads
  // and one that silently never existed.
  test('takes a comment its own point', () => {
    expect(opAnchor(commentOpSchema.parse({ ...base, tool: 'comment', num: 1, text: 'hi', x: 5, y: 6 }))).toEqual({
      x: 5,
      y: 6,
    });
  });

  test('takes a selection the top-left of its first rect', () => {
    const op = selectionOpSchema.parse({
      ...base,
      tool: 'selection',
      text: 'headline',
      rects: [
        { x: 12, y: 34, width: 100, height: 20 },
        { x: 12, y: 54, width: 80, height: 20 },
      ],
    });
    expect(opAnchor(op)).toEqual({ x: 12, y: 34 });
  });

  test('falls back to the origin for a selection with no rects', () => {
    const op = selectionOpSchema.parse({ ...base, tool: 'selection', text: 'x', rects: [] });
    expect(opAnchor(op)).toEqual({ x: 0, y: 0 });
  });

  test('takes an area its top-left corner, whichever way it was dragged', () => {
    const op = areaOpSchema.parse({ ...base, tool: 'area', startX: 7, startY: 8, endX: 90, endY: 80 });
    expect(opAnchor(op)).toEqual({ x: 7, y: 8 });
    // Dragged right-to-left, `startX` is the RIGHT edge. Reading it raw is what
    // put an agent's reply pin at the wrong corner of the area it answered.
    const backwards = areaOpSchema.parse({ ...base, tool: 'area', startX: 90, startY: 80, endX: 7, endY: 8 });
    expect(opAnchor(backwards)).toEqual({ x: 7, y: 8 });
  });

  test('takes an inspect the top-left of its rect', () => {
    const op = inspectOpSchema.parse({
      ...base,
      tool: 'inspect',
      selector: '#a',
      tag: 'div',
      markdown: '<div/>',
      rect: { x: 3, y: 4, width: 10, height: 10 },
    });
    expect(opAnchor(op)).toEqual({ x: 3, y: 4 });
  });
});

describe('parseOps', () => {
  // A client one release behind meets every new tool this way: losing the whole room to it would be silent.
  test('keeps the ops it can read when one is from a newer client or malformed', () => {
    const intro = { id: 'i1', tool: 'intro', video: 'a'.repeat(21), color: '#000', lineWidth: 2, ts: 1 };
    const stored = [comment, intro, { ...intro, id: 'i2', video: '../etc/passwd' }, { ...comment, tool: 'hologram' }];
    expect(parseOps(stored).map((op) => op.id)).toEqual(['op1', 'i1']);
  });
});

describe('inspect styleEdits', () => {
  const inspect = {
    id: 'i1',
    tool: 'inspect',
    color: '#000',
    lineWidth: 2,
    ts: 1,
    selector: '.card',
    tag: 'div',
    markdown: '<div/>',
    rect: { x: 0, y: 0, width: 1, height: 1 },
  };
  const edit = { property: 'color', from: '#111', to: '#222' };

  // Every room stored before CSS editing shipped has no such key; requiring it would drop them all in `parseOps`.
  test('an inspect op from before style edits still parses', () => {
    expect(parseOps([inspect]).map((op) => op.id)).toEqual(['i1']);
  });

  test('caps the list and each value, so one runaway paste cannot bloat the room', () => {
    const ok = (styleEdits: unknown) => inspectOpSchema.safeParse({ ...inspect, styleEdits }).success;
    expect(ok([edit])).toBe(true);
    expect(ok(Array.from({ length: MAX_STYLE_EDITS }, () => edit))).toBe(true);
    expect(ok(Array.from({ length: MAX_STYLE_EDITS + 1 }, () => edit))).toBe(false);
    expect(ok([{ ...edit, to: 'x'.repeat(MAX_STYLE_VALUE + 1) }])).toBe(false);
    expect(ok([{ ...edit, property: '' }])).toBe(false);
  });
});

describe('tallyQuestion', () => {
  const question: QuestionOp = {
    id: 'q1',
    tool: 'question',
    prompt: 'Which hero?',
    options: ['A', 'B'],
    ts: 1,
    color: '#000',
    lineWidth: 1,
  };
  const vote = (voter: string, option: number, ts: number): DrawOp => ({
    id: `v-${voter}-${ts}`,
    tool: 'vote',
    questionId: 'q1',
    voter,
    option,
    ts,
    color: '#000',
    lineWidth: 1,
  });

  // Two ballots from one voter is a revote; counting both would let anyone stuff the poll.
  test('counts only the latest ballot per voter', () => {
    const tally = tallyQuestion({ question, ops: [vote('ada', 0, 1), vote('ada', 1, 2), vote('bo', 0, 3)] });
    expect(tally.counts).toEqual([1, 1]);
    expect(tally.total).toBe(2);
  });

  test('ignores a ballot for an option the question does not have', () => {
    expect(tallyQuestion({ question, ops: [vote('ada', 4, 1)] }).total).toBe(0);
  });

  test('the room rejects a poll past the option cap', () => {
    const op = { ...question, options: ['1', '2', '3', '4', '5', '6', '7'] };
    expect(clientMsgSchema.safeParse({ type: 'op', op }).success).toBe(false);
  });
});

describe('toggleReaction', () => {
  const me = { id: 'u1', name: 'Me' };
  const you = { id: 'u2', name: 'You' };

  test('adds, then removes only the caller’s own reaction', () => {
    const once = toggleReaction({ emoji: '👍', by: me });
    expect(once).toEqual([{ emoji: '👍', id: 'u1', name: 'Me' }]);
    const theirs = toggleReaction({ reactions: once, emoji: '👍', by: you });
    expect(theirs).toHaveLength(2);
    expect(toggleReaction({ reactions: theirs, emoji: '👍', by: me })).toEqual([
      { emoji: '👍', id: 'u2', name: 'You' },
    ]);
  });

  test('the same person can leave two different emoji', () => {
    const both = toggleReaction({ reactions: toggleReaction({ emoji: '👍', by: me }), emoji: '🎉', by: me });
    expect(groupReactions(both).map((g) => g.emoji)).toEqual(['👍', '🎉']);
  });

  test('a reactions patch survives applyOpPatch on a comment', () => {
    const merged = applyOpPatch({ op: comment, patch: { reactions: toggleReaction({ emoji: '🚀', by: me }) } });
    expect(merged && 'reactions' in merged ? merged.reactions : null).toEqual([{ emoji: '🚀', id: 'u1', name: 'Me' }]);
  });
});

describe('targetElementSchema — element details', () => {
  const old = { selector: '#hero', tag: 'h1', markdown: '## Element Inspector' };

  test('a target written before the detail fields existed still parses', () => {
    // Fails if any new field becomes required: every stored room holds targets like this.
    expect(targetElementSchema.safeParse(old).success).toBe(true);
    const comment = { id: 'c1', tool: 'comment', num: 1, text: 'hi', x: 1, y: 2, color: '#f00', lineWidth: 2, ts: 1 };
    expect(commentOpSchema.safeParse({ ...comment, target: old }).success).toBe(true);
  });

  test('keeps the detail fields when present', () => {
    const full: TargetElement = {
      ...old,
      id: 'hero',
      classes: ['a', 'b'],
      attributes: { role: 'banner' },
      visibleText: 'Pricing',
      styles: { color: 'rgb(0, 0, 0)' },
      component: { framework: 'React', chain: ['Hero'], source: { fileName: 'Hero.tsx', lineNumber: 3 } },
    };
    expect(targetElementSchema.parse(full)).toEqual(full);
  });

  test('rejects a malformed component rather than passing it to an agent', () => {
    expect(targetElementSchema.safeParse({ ...old, component: { framework: 'Angular', chain: [] } }).success).toBe(
      false,
    );
  });
});
