import { describe, expect, test } from 'bun:test';
import { inspectOpSchema } from '@marklayer/types';
import { buildInspectPrompt, inspectFields, stackMarkdown } from './inspect-note';

const edit = { property: 'padding', from: '8px', to: '16px' };

describe('buildInspectPrompt', () => {
  test('puts the live CSS edits between the task and the element snapshot', () => {
    const prompt = buildInspectPrompt({
      comment: 'more room',
      priorityLabel: 'High',
      markdown: '## Element\n',
      styleEdits: [edit],
    });
    expect(prompt).toBe(
      '## Priority\n\nHigh\n\n## Task\n\nmore room\n\n## CSS tried live\n\n- `padding: 8px -> 16px`\n\n## Element\n',
    );
  });

  test('a note with no edits reads exactly as before CSS editing existed', () => {
    expect(buildInspectPrompt({ comment: '', markdown: '## Element\n', styleEdits: [] })).toBe('## Element\n');
  });
});

test('Add to stack keeps the edits, since a stack item has no field of its own for them', () => {
  expect(stackMarkdown({ markdown: '## Element\n', styleEdits: [edit] })).toContain('padding: 8px -> 16px');
  expect(stackMarkdown({ markdown: '## Element\n', styleEdits: [] })).toBe('## Element\n');
});

describe('inspectFields', () => {
  const base = {
    selector: '#cta',
    tag: 'button',
    markdown: '<button/>',
    rect: { x: 1, y: 2, width: 3, height: 4 },
    details: { id: 'cta', classes: ['btn'], styles: { color: 'red' } },
  };
  const op = (styleEdits: (typeof edit)[]) => ({
    id: 'op',
    tool: 'inspect' as const,
    color: '#000',
    lineWidth: 1,
    ts: 1,
    ...inspectFields({ ...base, styleEdits }),
  });

  test('details and edits survive the room parse, which strips any key the schema lacks', () => {
    const parsed = inspectOpSchema.parse(op([edit]));
    expect(parsed.details).toEqual(base.details);
    expect(parsed.styleEdits).toEqual([edit]);
  });

  test('no edits leaves the field unset, rather than an empty list', () => {
    expect(inspectOpSchema.parse(op([])).styleEdits).toBeUndefined();
  });
});
