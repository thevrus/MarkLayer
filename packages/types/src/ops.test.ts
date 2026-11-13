import { describe, expect, test } from 'bun:test';
import {
  applyOpPatch,
  areaOpSchema,
  type CommentOp,
  commentMetaSchema,
  commentOpSchema,
  type DrawOp,
  groupReactions,
  indexOps,
  inspectOpSchema,
  isAnnotationOp,
  isRootAnnotation,
  MAX_STYLE_EDITS,
  MAX_STYLE_VALUE,
  type Mention,
  mentionSegments,
  nextCommentNum,
  normalizeSuggestion,
  opAnchor,
  parseOps,
  type QuestionOp,
  rectOpSchema,
  resolveOpStatus,
  selectionOpSchema,
  type TargetElement,
  tallyQuestion,
  targetElementSchema,
  toggleReaction,
  translateOp,
} from './ops';
import { MAX_PAGE_ERROR_TEXT, MAX_PAGE_ERRORS } from './relay';
import { clientMsgSchema } from './wire';

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
    expect(merged).toMatchObject({ text: 'needs a darker border', priority: 'high' });
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

describe('op families', () => {
  const reply: CommentOp = { ...comment, id: 'r1', parentId: 'op1' };

  test('a reply is an annotation op, but not an annotation in its own right', () => {
    expect(isAnnotationOp(reply)).toBe(true);
    expect(isRootAnnotation(reply)).toBe(false);
    expect(isRootAnnotation(comment)).toBe(true);
  });

  test('numbers off root comments, so a reply cannot take a number a pin already shows', () => {
    expect(nextCommentNum([comment, reply, { ...reply, id: 'r2' }])).toBe(2);
  });

  test('threads replies under any annotation kind, not only comments', () => {
    const area: DrawOp = {
      id: 'a1',
      tool: 'area',
      color: '#000',
      lineWidth: 2,
      startX: 0,
      startY: 0,
      endX: 1,
      endY: 1,
      ts: 1,
    };
    const onArea: CommentOp = { ...reply, parentId: 'a1' };
    const { roots, replies } = indexOps([comment, area, onArea]);
    expect(roots.map((op) => op.id)).toEqual(['op1', 'a1']);
    expect(replies.get('a1')).toEqual([onArea]);
  });
});

describe('authorship on every op', () => {
  // A stroke that loses its authorId on the wire reads as unsigned, so undo can take a peer's mark.
  test('a drawn mark keeps who made it', () => {
    const parsed = rectOpSchema.parse({
      id: 'r1',
      tool: 'rectangle',
      color: '#000',
      lineWidth: 2,
      startX: 0,
      startY: 0,
      endX: 1,
      endY: 1,
      authorId: 'u1',
      author: 'Ada',
    });
    expect(parsed.authorId).toBe('u1');
  });
});

test('annotation layer survives parsing and patching while older annotations remain readable', () => {
  const comment = {
    id: 'layer-test',
    tool: 'comment',
    num: 1,
    text: '问题',
    x: 1,
    y: 2,
    color: '#000',
    lineWidth: 2,
    ts: 1,
  };
  expect(commentOpSchema.safeParse(comment).success).toBe(true);
  const layered = commentOpSchema.parse({ ...comment, layerId: 'review' });
  expect(layered.layerId).toBe('review');
  expect(applyOpPatch({ op: layered, patch: { text: '更新' } })).toMatchObject({ layerId: 'review' });
  expect(commentOpSchema.safeParse({ ...comment, layerId: '' }).success).toBe(false);
});
