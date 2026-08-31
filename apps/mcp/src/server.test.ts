import { describe, expect, test } from 'bun:test';
import { areaOpSchema, commentOpSchema, inspectOpSchema, opAnchor, selectionOpSchema } from '@marklayer/types';
import { parseRoomRef, projectAnnotation } from './server';

describe('parseRoomRef', () => {
  test('passes a bare room id through untouched', () => {
    expect(parseRoomRef('abc123')).toBe('abc123');
  });

  test('trims surrounding whitespace', () => {
    expect(parseRoomRef('  abc123  ')).toBe('abc123');
  });

  test('extracts the id from a full share URL', () => {
    expect(parseRoomRef('https://marklayer.app/s/abc123')).toBe('abc123');
  });

  test('stops at the next slash when the URL has a path after the id', () => {
    expect(parseRoomRef('https://marklayer.app/s/abc123/whatever')).toBe('abc123');
  });

  test('rejects empty or whitespace-only input', () => {
    expect(() => parseRoomRef('')).toThrow('empty room reference');
    expect(() => parseRoomRef('   ')).toThrow('empty room reference');
  });

  // Has a `/` (so it skips the bare-id shortcut) but is not a parseable URL.
  test('rejects a slash-containing string that is not a valid URL', () => {
    expect(() => parseRoomRef('this/is/not/a/url')).toThrow('invalid room reference: this/is/not/a/url');
  });

  test('rejects a valid URL with no /s/ segment', () => {
    expect(() => parseRoomRef('https://marklayer.app/nope')).toThrow(
      'could not extract room id from URL: https://marklayer.app/nope',
    );
  });
});

describe('projectAnnotation — comment', () => {
  const comment = commentOpSchema.parse({
    id: 'op-1',
    tool: 'comment',
    num: 1,
    text: 'move this button down',
    x: 10,
    y: 20,
    color: '#ff0000',
    lineWidth: 2,
    ts: 1_700_000_000_000,
    author: 'Ada',
    status: 'open',
    meta: { url: 'https://example.com/page' },
    target: { selector: '#hero button', tag: 'button', markdown: '<button>Buy now</button>' },
  });

  test('carries the position, page url, and target through', () => {
    expect(projectAnnotation(comment)).toEqual({
      id: 'op-1',
      kind: 'comment',
      status: 'open',
      author: 'Ada',
      assignee: null,
      assignedAgent: null,
      mentions: [],
      ts: 1_700_000_000_000,
      text: 'move this button down',
      position: { x: 10, y: 20 },
      url: 'https://example.com/page',
      target: { selector: '#hero button', tag: 'button', markdown: '<button>Buy now</button>' },
    });
  });

  test('falls back to null when author, meta, and target are absent', () => {
    const bare = commentOpSchema.parse({
      id: 'op-2',
      tool: 'comment',
      num: 2,
      text: 'no context on this one',
      x: 0,
      y: 0,
      color: '#000',
      lineWidth: 1,
      ts: 1_700_000_000_000,
    });
    expect(projectAnnotation(bare)).toEqual({
      id: 'op-2',
      kind: 'comment',
      status: 'open',
      author: null,
      assignee: null,
      assignedAgent: null,
      mentions: [],
      ts: 1_700_000_000_000,
      text: 'no context on this one',
      position: { x: 0, y: 0 },
      url: null,
      target: null,
    });
  });
});

describe('projectAnnotation — area', () => {
  test('derives a rect from the two corners', () => {
    const area = areaOpSchema.parse({
      id: 'op-3',
      tool: 'area',
      startX: 10,
      startY: 20,
      endX: 110,
      endY: 220,
      color: '#00ff00',
      lineWidth: 2,
      ts: 1_700_000_000_000,
      comment: 'this whole section feels off',
      target: { selector: '.hero', tag: 'section', markdown: '<section>hero</section>' },
    });
    expect(projectAnnotation(area)).toEqual({
      id: 'op-3',
      kind: 'area',
      status: 'open',
      author: null,
      assignee: null,
      assignedAgent: null,
      mentions: [],
      ts: 1_700_000_000_000,
      comment: 'this whole section feels off',
      rect: { x: 10, y: 20, width: 100, height: 200 },
      target: { selector: '.hero', tag: 'section', markdown: '<section>hero</section>' },
    });
  });
});

describe('projectAnnotation — selection', () => {
  test('carries the proposed suggestion alongside the original text', () => {
    const selection = selectionOpSchema.parse({
      id: 'op-4',
      tool: 'selection',
      text: 'welcome too our site',
      rects: [{ x: 0, y: 0, width: 50, height: 20 }],
      comment: 'typo',
      suggestion: 'welcome to our site',
      ts: 1_700_000_000_000,
      color: '#0000ff',
      lineWidth: 1,
      target: { selector: 'h1', tag: 'h1', markdown: '<h1>welcome too our site</h1>' },
    });
    expect(projectAnnotation(selection)).toEqual({
      id: 'op-4',
      kind: 'selection',
      status: 'open',
      author: null,
      assignee: null,
      assignedAgent: null,
      mentions: [],
      ts: 1_700_000_000_000,
      text: 'welcome too our site',
      suggestion: 'welcome to our site',
      comment: 'typo',
      rects: [{ x: 0, y: 0, width: 50, height: 20 }],
      target: { selector: 'h1', tag: 'h1', markdown: '<h1>welcome too our site</h1>' },
    });
  });

  test('reports no suggestion as null, not undefined', () => {
    const selection = selectionOpSchema.parse({
      id: 'op-5',
      tool: 'selection',
      text: 'just a note, no edit proposed',
      rects: [],
      ts: 1_700_000_000_000,
      color: '#0000ff',
      lineWidth: 1,
    });
    expect(projectAnnotation(selection)).toEqual({
      id: 'op-5',
      kind: 'selection',
      status: 'open',
      author: null,
      assignee: null,
      assignedAgent: null,
      mentions: [],
      ts: 1_700_000_000_000,
      text: 'just a note, no edit proposed',
      suggestion: null,
      comment: null,
      rects: [],
      target: null,
    });
  });
});

describe('projectAnnotation — inspect', () => {
  // Inspect ops are not `anchorable` (no `target` field on the schema) — the
  // element handle lives directly on selector/tag/markdown/rect instead.
  test('shapes the element handle from its own fields, with no target key', () => {
    const inspect = inspectOpSchema.parse({
      id: 'op-6',
      tool: 'inspect',
      selector: '.card',
      tag: 'div',
      comment: 'increase padding',
      markdown: '<div class="card">...</div>',
      rect: { x: 1, y: 2, width: 3, height: 4 },
      ts: 1_700_000_000_000,
      color: '#000000',
      lineWidth: 1,
    });
    const projected = projectAnnotation(inspect);
    expect(projected).toEqual({
      id: 'op-6',
      kind: 'inspect',
      status: 'open',
      author: null,
      assignee: null,
      assignedAgent: null,
      mentions: [],
      ts: 1_700_000_000_000,
      selector: '.card',
      tag: 'div',
      comment: 'increase padding',
      markdown: '<div class="card">...</div>',
      rect: { x: 1, y: 2, width: 3, height: 4 },
    });
    expect(projected).not.toHaveProperty('target');
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
