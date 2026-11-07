import { afterEach, describe, expect, test } from 'bun:test';
import type { CommentOp, DrawOp } from '@marklayer/types/ops';
import { addToInspectorStack, flushInspectorStack, inspectorStack } from './inspector-stack';
import { operations } from './ops';
import { ELEMENT_INSPECTOR_HEADING, parseInspectorComment } from './selector';

const comment = (num: number, parentId?: string): CommentOp => ({
  id: `c${num}`,
  tool: 'comment',
  num,
  text: 'note',
  x: 0,
  y: 0,
  color: '#000000',
  lineWidth: 2,
  ts: num,
  parentId,
});

const isComment = (op: DrawOp): op is CommentOp => op.tool === 'comment';

describe('flushInspectorStack', () => {
  afterEach(() => {
    operations.value = [];
    inspectorStack.value = [];
  });

  test('numbers past the replies, so a flushed comment cannot take a number already in the room', () => {
    operations.value = [comment(1), comment(2), comment(3, 'c1'), comment(4)];
    addToInspectorStack({ selector: '', comment: '', markdown: 'one' });
    addToInspectorStack({ selector: '', comment: '', markdown: 'two' });

    expect(flushInspectorStack()).toBe(2);

    const nums = operations.value.filter(isComment).map((c) => c.num);
    expect(new Set(nums).size).toBe(nums.length);
    expect(inspectorStack.value).toEqual([]);
  });

  test('a typed task survives into the comment the pin parses', () => {
    const markdown = `${ELEMENT_INSPECTOR_HEADING}\n\n**Tag:** \`h1\``;
    addToInspectorStack({ selector: '', comment: 'make it bigger', markdown });
    flushInspectorStack();
    const [op] = operations.value.filter(isComment);
    expect(parseInspectorComment(op?.text ?? '')?.task).toBe('make it bigger');
  });
});
