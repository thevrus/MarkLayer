import { expect, test } from 'bun:test';
import type { CommentOp, DrawOp } from '@marklayer/types/ops';
import { commentContext } from './comment-context';

const comment = (id: string, x: number, layerId?: string): CommentOp => ({
  id, tool: 'comment', x, y: 200, color: '#000', lineWidth: 2, num: 1, text: id, ts: 1, layerId,
});

test('captures only root annotations in the selected layer and region', () => {
  const ops: DrawOp[] = [comment('inside', 300), comment('outside', 1200), comment('other', 300, 'other'), { ...comment('reply', 300), parentId: 'inside' }];
  const result = commentContext({ pin: { x: 400, y: 250 }, viewport: { x: 0, y: 0, width: 1600, height: 900 }, layerId: 'default', ops });
  expect(result.region).toEqual({ x: 0, y: 0, width: 800, height: 500 });
  expect(result.annotations).toEqual([{ id: 'inside', kind: 'comment', text: 'inside' }]);
  expect(result.truncated).toBe(false);
});

test('caps the nearby annotations and signals truncation', () => {
  const ops = Array.from({ length: 26 }, (_, i) => comment(String(i), 300));
  const result = commentContext({ pin: { x: 400, y: 250 }, viewport: { x: 0, y: 0, width: 1600, height: 900 }, layerId: 'default', ops });
  expect(result.annotations.length).toBe(25);
  expect(result.truncated).toBe(true);
});

test('marks a missing document as incomplete', () => {
  const result = commentContext({ pin: { x: 400, y: 250 }, viewport: { x: 0, y: 0, width: 1600, height: 900 }, layerId: 'default', ops: [], doc: null });
  expect(result.incomplete).toBe(true);
});

test('signals when a nearby annotation text is shortened', () => {
  const op = { ...comment('long', 300), text: 'x'.repeat(501) };
  const result = commentContext({ pin: { x: 400, y: 250 }, viewport: { x: 0, y: 0, width: 1600, height: 900 }, layerId: 'default', ops: [op] });
  expect(result.annotations[0]?.text.length).toBe(500);
  expect(result.truncated).toBe(true);
});
