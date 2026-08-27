import { describe, expect, test } from 'bun:test';
import { applyOpPatch, type CommentOp, type DrawOp, normalizeSuggestion, resolveOpStatus, translateOp } from './index';

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

  test('rejects a patch that would change the op into another tool', () => {
    expect(applyOpPatch({ op: comment, patch: { tool: 'guide' } })).toBeNull();
  });

  test('rejects a stored op that is not an op at all', () => {
    expect(applyOpPatch({ op: null, patch: { status: 'open' } })).toBeNull();
    expect(applyOpPatch({ op: 'nonsense', patch: { status: 'open' } })).toBeNull();
    expect(applyOpPatch({ op: { id: 'x' }, patch: { status: 'open' } })).toBeNull();
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
