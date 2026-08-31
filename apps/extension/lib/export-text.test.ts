import { describe, expect, test } from 'bun:test';
import type { CommentOp, DrawOp, SelectionOp, TextOp } from '@marklayer/types';
import { buildMarkdownExport, defaultExportFilename, downloadMarkdown } from './export-text';

const base = { id: 'op', color: '#000', lineWidth: 2 };

const comment = (over: Partial<CommentOp> = {}): CommentOp => ({
  ...base,
  tool: 'comment',
  num: 1,
  text: 'Nav feels cramped',
  x: 10,
  y: 20,
  ts: 0,
  ...over,
});

const selection = (over: Partial<SelectionOp> = {}): SelectionOp => ({
  ...base,
  tool: 'selection',
  text: 'Ship faster',
  rects: [{ x: 0, y: 0, width: 10, height: 10 }],
  ts: 0,
  ...over,
});

const label = (text: string): TextOp => ({ ...base, tool: 'text', text, x: 0, y: 0, fontSize: 14 });

const build = (ops: DrawOp[], meta: Parameters<typeof buildMarkdownExport>[1] = {}) =>
  buildMarkdownExport(ops, { generatedAt: Date.UTC(2026, 0, 2), ...meta });

describe('buildMarkdownExport', () => {
  test('produces a header and nothing else for an empty canvas', () => {
    const md = build([]);
    expect(md).toContain('# MarkLayer annotations');
    expect(md).not.toContain('Totals');
    expect(md).not.toContain('## Comments');
  });

  test('renders a root comment with its author, number and status label', () => {
    const md = build([comment({ id: 'c1', num: 3, author: 'Ada', status: 'in_progress' })]);
    expect(md).toContain('### #3 — Ada _(In progress)_');
    expect(md).toContain('Nav feels cramped');
  });

  test('names an unattributed comment rather than leaving the author blank', () => {
    expect(build([comment()])).toContain('### #1 — Anonymous');
  });

  test('reads a legacy resolved flag as a resolved status', () => {
    // Older ops carry `resolved: true` and no `status` field.
    expect(build([comment({ resolved: true })])).toContain('_(Resolved)_');
  });

  test('nests replies under the comment they answer, not as threads of their own', () => {
    const md = build([
      comment({ id: 'c1', num: 1, text: 'Nav feels cramped' }),
      comment({ id: 'r1', num: 2, parentId: 'c1', text: 'Agreed', author: 'Bo' }),
    ]);
    expect(md).toContain('> **Bo:** Agreed');
    // One heading, because the reply is not a root.
    expect(md.match(/^### #/gm)).toHaveLength(1);
  });

  test('keeps a multi-line reply inside the blockquote', () => {
    // Without prefixing the continuation lines, the second line escapes the
    // quote and reads as body text.
    const md = build([
      comment({ id: 'c1' }),
      comment({ id: 'r1', parentId: 'c1', text: 'line one\nline two', author: 'Bo' }),
    ]);
    expect(md).toContain('> **Bo:** line one\n> line two');
  });

  test('renders a copy edit as an applyable diff block', () => {
    const md = build([selection({ text: 'Ship faster', suggestion: 'Ship sooner' })]);
    expect(md).toContain('```diff\n- Ship faster\n+ Ship sooner\n```');
  });

  test('flattens a multi-line selection into a single quoted heading', () => {
    const md = build([selection({ text: 'Ship\n  faster\tnow' })]);
    expect(md).toContain('### "Ship faster now"');
  });

  test('collapses newlines in a text label so it stays one list item', () => {
    expect(build([label('two\nlines')])).toContain('- two lines');
  });

  test('counts each annotation kind, singular and plural', () => {
    expect(build([comment(), label('a')])).toContain('**Totals:** 1 comment, 1 text label');
    expect(build([comment({ id: 'a' }), comment({ id: 'b' }), selection()])).toContain(
      '**Totals:** 2 comments, 1 selection',
    );
  });

  test('omits a kind with nothing in it from the totals', () => {
    expect(build([comment()])).toBe(
      `${['# MarkLayer annotations', '', `**Generated:** ${new Date(Date.UTC(2026, 0, 2)).toLocaleString()}`, '**Totals:** 1 comment', '', '## Comments', '', '### #1 — Anonymous _(Open)_', '', 'Nav feels cramped'].join('\n')}\n`,
    );
  });

  test('never leaves a run of blank lines behind', () => {
    const md = build([comment({ id: 'c1' }), selection(), label('a')], { url: 'https://example.com' });
    expect(md).not.toMatch(/\n{3}/);
  });

  test('splits a multi-page project into per-page sections with combined totals', () => {
    const md = build([], {
      pages: [
        { url: 'https://example.com/pricing?ref=x', ops: [comment({ id: 'c1' })] },
        { url: null, ops: [comment({ id: 'c2' }), selection()] },
      ],
    });
    expect(md).toContain('**Pages:** 2');
    expect(md).toContain('**Totals:** 2 comments, 1 selection');
    // The heading label is host + path, so a query string does not become the
    // title - while the full url still travels below it as a link.
    expect(md).toContain('## Page 1 — example.com/pricing\n');
    expect(md).toContain('<https://example.com/pricing?ref=x>');
    // A page with no url still gets a section, numbered in place.
    expect(md).toContain('## Page 2 — Page 2');
    // Per-page headings step down a level to sit under the page heading.
    expect(md).toContain('#### #1 — Anonymous');
  });

  test('renders a single-page project inline rather than as a one-page list', () => {
    const md = build([comment()], { pages: [{ url: 'https://example.com', ops: [comment()] }] });
    expect(md).not.toContain('**Pages:**');
    expect(md).toContain('## Comments');
  });
});

describe('defaultExportFilename', () => {
  const today = new Date().toISOString().slice(0, 10);

  test('names the file after the annotated host, without the www', () => {
    expect(defaultExportFilename('https://www.example.com/pricing')).toBe(`example.com-annotations-${today}.md`);
  });

  test('falls back to the product name for a missing or unparseable url', () => {
    expect(defaultExportFilename()).toBe(`marklayer-annotations-${today}.md`);
    expect(defaultExportFilename('not a url')).toBe(`marklayer-annotations-${today}.md`);
  });
});

describe('downloadMarkdown', () => {
  test('hands the browser a named markdown file and releases the blob url', () => {
    const created: Blob[] = [];
    const revoked: string[] = [];
    let clicked: { href: string; download: string } | null = null;

    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    const originalCreateElement = document.createElement.bind(document);
    URL.createObjectURL = (blob: Blob) => {
      created.push(blob);
      return 'blob:fake';
    };
    URL.revokeObjectURL = (url: string) => revoked.push(url);
    // The anchor is never attached to the document, so intercept it at creation.
    Object.defineProperty(document, 'createElement', {
      value: (tag: string) => {
        const el = originalCreateElement(tag);
        if (tag === 'a' && el instanceof HTMLAnchorElement) {
          Object.defineProperty(el, 'click', {
            value: () => {
              clicked = { href: el.href, download: el.download };
            },
            configurable: true,
          });
        }
        return el;
      },
      configurable: true,
    });

    try {
      downloadMarkdown('# hi\n', 'example.com-annotations-2026-01-02.md');
    } finally {
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
      Object.defineProperty(document, 'createElement', { value: originalCreateElement, configurable: true });
    }

    expect(created[0]?.type).toBe('text/markdown;charset=utf-8');
    expect(clicked).toMatchObject({ download: 'example.com-annotations-2026-01-02.md' });
    // Leaking the url pins the blob in memory for the life of the page.
    expect(revoked).toEqual(['blob:fake']);
  });
});
