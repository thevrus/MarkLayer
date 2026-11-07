import { expect, test } from 'bun:test';
import type { DrawOp } from '@marklayer/types/ops';
import { operations, undo } from './ops';

// A ballot or checklist step a peer just pushed must not be what my ⌘Z takes back.
test('undo skips review ops that arrived after my last mark', () => {
  const mark: DrawOp = {
    id: 'p1',
    tool: 'pen',
    color: '#000',
    lineWidth: 2,
    compositeOperation: 'source-over',
    points: [{ x: 0, y: 0 }],
  };
  const vote: DrawOp = {
    id: 'v1',
    tool: 'vote',
    questionId: 'q1',
    voter: 'peer',
    option: 0,
    ts: 2,
    color: '#000',
    lineWidth: 1,
  };
  operations.value = [mark, vote];
  undo();
  expect(operations.value.map((op) => op.id)).toEqual(['v1']);
});

test("undo leaves a peer's comment alone", () => {
  const theirs: DrawOp = {
    id: 'c1',
    tool: 'comment',
    num: 1,
    text: 'x',
    x: 0,
    y: 0,
    ts: 1,
    color: '#000',
    lineWidth: 2,
    authorId: 'agent',
  };
  operations.value = [theirs];
  undo();
  expect(operations.value.map((op) => op.id)).toEqual(['c1']);
});
