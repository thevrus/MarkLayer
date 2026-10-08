import { describe, expect, test } from 'bun:test';
import type { CommentOp } from '@marklayer/types';
import { buildAnnotationsPrompt } from './prompt';

const comment = (over: Partial<CommentOp>): CommentOp => ({
  id: 'c1',
  tool: 'comment',
  num: 1,
  text: 'label is vague',
  x: 0,
  y: 0,
  color: '#000',
  lineWidth: 2,
  ts: 1,
  ...over,
});

describe('buildAnnotationsPrompt', () => {
  test('drops settled threads and folds replies under their root', () => {
    const out = buildAnnotationsPrompt({
      url: 'https://x.test',
      ops: [
        comment({ id: 'a', text: 'fix me', priority: 'high' }),
        comment({ id: 'b', text: 'done already', status: 'resolved' }),
        comment({ id: 'c', text: 'legacy', resolved: true }),
        comment({ id: 'r', parentId: 'a', text: 'agreed', author: 'Sam' }),
      ],
    });
    expect(out).toContain('1. fix me');
    expect(out).toContain('Priority: high');
    expect(out).toContain('Reply (Sam): agreed');
    expect(out).not.toContain('done already');
    expect(out).not.toContain('legacy');
  });

  test('null when nothing is open', () => {
    expect(buildAnnotationsPrompt({ ops: [comment({ status: 'dismissed' })] })).toBeNull();
  });
});
