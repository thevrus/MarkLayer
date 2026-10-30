import { describe, expect, test } from 'bun:test';
import type { CommentOp, InspectOp } from '@marklayer/types';
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

  test('keeps a recording-only thread, labelled by what was recorded', () => {
    const out = buildAnnotationsPrompt({
      ops: [comment({ id: 'v', text: '', video: 'abc123def456ghi789jkl' })],
    });
    expect(out).toContain('1. (video note)');
  });

  test('an inspect with only CSS edits is still work, and carries each edit as an arrow line', () => {
    const inspect: InspectOp = {
      id: 'i',
      tool: 'inspect',
      color: '#000',
      lineWidth: 2,
      ts: 1,
      selector: '.card',
      tag: 'div',
      markdown: '<div/>',
      rect: { x: 0, y: 0, width: 1, height: 1 },
      styleEdits: [
        { property: 'color', from: '#111', to: '#222' },
        { property: 'gap', from: '', to: '8px' },
      ],
    };
    const out = buildAnnotationsPrompt({ ops: [inspect] });
    expect(out).toContain('1. (CSS edits)');
    expect(out).toContain('`color: #111 -> #222`');
    expect(out).toContain('`gap: (unset) -> 8px`');
  });

  test('null when nothing is open', () => {
    expect(buildAnnotationsPrompt({ ops: [comment({ status: 'dismissed' })] })).toBeNull();
  });
});
