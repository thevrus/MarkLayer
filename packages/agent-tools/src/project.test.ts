import { describe, expect, test } from 'bun:test';
import {
  areaOpSchema,
  commentOpSchema,
  inspectOpSchema,
  selectionOpSchema,
  type TargetElement,
} from '@marklayer/types/ops';
import { projectAnnotation } from './index';

const API_BASE = 'https://marklayer.app';

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
    expect(projectAnnotation(comment, API_BASE)).toEqual({
      id: 'op-1',
      layerId: 'default',
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
      pageErrors: [],
      attachments: [],
      voice: null,
      video: null,
    });
  });

  test('exposes saved visual context without changing old comments', () => {
    const visualContext = {
      region: { x: 0, y: 0, width: 800, height: 500 },
      layerId: 'default',
      annotations: [{ id: 'nearby', kind: 'comment' as const, text: 'near' }],
      truncated: false,
    };
    const parsed = commentOpSchema.parse({ ...comment, visualContext });
    expect(projectAnnotation(parsed, API_BASE)).toMatchObject({ visualContext });
    expect(projectAnnotation(comment, API_BASE)).not.toHaveProperty('visualContext');
  });

  test('hands an area its screenshot as a fetchable URL', () => {
    const area = areaOpSchema.parse({
      id: 'op-a',
      tool: 'area',
      startX: 0,
      startY: 0,
      endX: 10,
      endY: 20,
      color: '#000',
      lineWidth: 1,
      ts: 1_700_000_000_000,
      attachments: ['abc123def456ghi789jkl'],
    });
    expect(projectAnnotation(area, API_BASE)).toMatchObject({
      kind: 'area',
      attachments: ['https://marklayer.app/f/abc123def456ghi789jkl'],
    });
  });

  test('hands the page errors captured with the comment to the agent', () => {
    const withErrors = commentOpSchema.parse({
      ...comment,
      meta: { errors: [{ message: 'TypeError: x is undefined', at: 5 }] },
    });
    expect(projectAnnotation(withErrors, API_BASE)).toMatchObject({
      pageErrors: [{ message: 'TypeError: x is undefined', at: 5 }],
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
    expect(projectAnnotation(bare, API_BASE)).toEqual({
      id: 'op-2',
      layerId: 'default',
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
      pageErrors: [],
      attachments: [],
      voice: null,
      video: null,
    });
  });

  test('resolves attachment ids to fetchable URLs on the room’s own origin', () => {
    const withAttachments = commentOpSchema.parse({
      id: 'op-2b',
      tool: 'comment',
      num: 3,
      text: 'see the screenshot',
      x: 0,
      y: 0,
      color: '#000',
      lineWidth: 1,
      ts: 1_700_000_000_000,
      attachments: ['abc123def456ghi789jkl'],
    });
    expect(projectAnnotation(withAttachments, API_BASE)).toMatchObject({
      attachments: ['https://marklayer.app/f/abc123def456ghi789jkl'],
    });
  });

  test('resolves a voice note to a fetchable URL, text being its transcript', () => {
    const voiced = commentOpSchema.parse({
      id: 'op-2c',
      tool: 'comment',
      num: 4,
      text: '',
      x: 0,
      y: 0,
      color: '#000',
      lineWidth: 1,
      ts: 1_700_000_000_000,
      voice: 'abc123def456ghi789jkl',
    });
    expect(projectAnnotation(voiced, API_BASE)).toMatchObject({
      voice: 'https://marklayer.app/f/abc123def456ghi789jkl',
    });
  });
});

describe('projectAnnotation — video', () => {
  test('resolves a video note to a fetchable URL', () => {
    const recorded = commentOpSchema.parse({
      id: 'op-2d',
      tool: 'comment',
      num: 5,
      text: 'see the jump at 0:12',
      x: 0,
      y: 0,
      color: '#000',
      lineWidth: 1,
      ts: 1_700_000_000_000,
      video: 'abc123def456ghi789jkl',
    });
    expect(projectAnnotation(recorded, API_BASE)).toMatchObject({
      voice: null,
      video: 'https://marklayer.app/f/abc123def456ghi789jkl',
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
    expect(projectAnnotation(area, API_BASE)).toEqual({
      id: 'op-3',
      layerId: 'default',
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
      attachments: [],
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
    expect(projectAnnotation(selection, API_BASE)).toEqual({
      id: 'op-4',
      layerId: 'default',
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
    expect(projectAnnotation(selection, API_BASE)).toMatchObject({ suggestion: null, comment: null, target: null });
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
    const projected = projectAnnotation(inspect, API_BASE);
    expect(projected).toEqual({
      id: 'op-6',
      layerId: 'default',
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
      styleEdits: [],
      details: null,
    });
    expect(projected).not.toHaveProperty('target');
  });

  test('carries structured element details through the room parse to the agent', () => {
    const details = {
      id: 'cta',
      classes: ['btn', 'btn-primary'],
      attributes: { 'aria-label': 'Buy' },
      visibleText: 'Buy now',
      styles: { color: 'rgb(0, 0, 0)', position: 'static' },
      component: { framework: 'React' as const, chain: ['BuyButton', 'Hero'] },
    };
    const inspect = inspectOpSchema.parse({
      id: 'op-8',
      tool: 'inspect',
      selector: '#cta',
      tag: 'button',
      markdown: '<button/>',
      rect: { x: 0, y: 0, width: 1, height: 1 },
      details,
      ts: 1,
      color: '#000000',
      lineWidth: 1,
    });
    expect(projectAnnotation(inspect, API_BASE)).toMatchObject({ details });
  });

  test('flattens live CSS edits into lines an agent reads at a glance', () => {
    const inspect = inspectOpSchema.parse({
      id: 'op-7',
      tool: 'inspect',
      selector: '.card',
      tag: 'div',
      markdown: '<div/>',
      rect: { x: 0, y: 0, width: 1, height: 1 },
      styleEdits: [{ property: 'color', from: '#111', to: '#222' }],
      ts: 1,
      color: '#000000',
      lineWidth: 1,
    });
    expect(projectAnnotation(inspect, API_BASE)).toMatchObject({ styleEdits: ['color: #111 -> #222'] });
  });
});

describe('projectAnnotation — element details', () => {
  const base = {
    id: 'op-9',
    tool: 'comment',
    num: 1,
    text: 'tighten this',
    x: 1,
    y: 2,
    color: '#f00',
    lineWidth: 2,
    ts: 1,
  };

  test('hands the agent the structured details alongside the markdown', () => {
    const target: TargetElement = {
      selector: '#buy',
      tag: 'button',
      markdown: '## Element Inspector',
      id: 'buy',
      classes: ['btn'],
      attributes: { type: 'submit' },
      visibleText: 'Buy now',
      styles: { color: 'rgb(0, 0, 0)', display: 'block' },
      component: { framework: 'React', chain: ['BuyButton'], source: { fileName: 'Buy.tsx', lineNumber: 7 } },
    };
    const projected = projectAnnotation(commentOpSchema.parse({ ...base, target }), API_BASE);
    expect('target' in projected && projected.target).toEqual(target);
  });
});
