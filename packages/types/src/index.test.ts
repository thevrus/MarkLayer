import { describe, expect, test } from 'bun:test';
import { applyOpPatch, type CommentOp, resolveOpStatus } from './index';

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
