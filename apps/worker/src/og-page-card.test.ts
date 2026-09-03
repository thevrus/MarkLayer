import { describe, expect, it } from 'bun:test';
import { buildPageOgSvg, layoutHeading, measure, pickWord } from './og-page-card';

/** What the composer itself holds the heading to. */
const HEADING_WIDTH = 1000;

const HEADINGS = [
  'Markup.io vs MarkLayer',
  'Free Markup.io alternatives for design review',
  'Annotate any webpage with your team',
  'How QA teams report visual bugs on staging without screenshots or Jira attachments',
  'The complete guide to choosing a website feedback and visual annotation tool for distributed product teams in 2026',
  'Pricing',
  'Unternehmensberatungsgesellschaftsverwaltung',
];

describe('measure', () => {
  it('scales with the size', () => {
    expect(measure({ text: 'MarkLayer', size: 80 })).toBeCloseTo(measure({ text: 'MarkLayer', size: 40 }) * 2, 5);
  });

  it('costs something for every character, including the space', () => {
    expect(measure({ text: 'a b', size: 60 })).toBeGreaterThan(measure({ text: 'ab', size: 60 }));
  });

  it('does not silently measure an unknown glyph as zero', () => {
    // A heading with a character outside the subset must still be over-measured
    // rather than under-measured, or it overruns the card instead of wrapping.
    expect(measure({ text: '漢', size: 60 })).toBeGreaterThan(0);
  });
});

describe('layoutHeading', () => {
  it('never exceeds two lines and never overruns the measure', () => {
    for (const heading of HEADINGS) {
      const { size, lines } = layoutHeading(heading);
      expect(lines.length).toBeLessThanOrEqual(2);
      for (const line of lines) {
        expect(measure({ text: line, size })).toBeLessThanOrEqual(HEADING_WIDTH);
      }
    }
  });

  it('keeps a heading that still reads big on one line', () => {
    // Two lines at a hair larger would strand "vs" at the break and empty the
    // right half of the card.
    const { lines, size } = layoutHeading('Markup.io vs MarkLayer');
    expect(lines).toEqual(['Markup.io vs MarkLayer']);
    expect(size).toBeGreaterThanOrEqual(64);
  });

  it('breaks to two lines rather than setting a long heading small', () => {
    const { lines } = layoutHeading('Annotate any webpage with your team');
    expect(lines).toHaveLength(2);
  });

  it('cuts an over-long heading at a word boundary, never mid-word', () => {
    const { lines } = layoutHeading(HEADINGS[4] ?? '');
    const last = lines[lines.length - 1] ?? '';
    expect(last.endsWith('…')).toBe(true);
    // The character before the ellipsis ends a word, so no `tool fo…`.
    expect(last).not.toMatch(/\b(fo|distribut|annotatio)…$/);
    expect(HEADINGS[4]).toContain(last.slice(0, -1).trim());
  });

  it('survives an empty heading', () => {
    expect(layoutHeading('   ').lines).toEqual([]);
  });

  it('collapses runs of whitespace instead of measuring them', () => {
    expect(layoutHeading('Markup.io   vs\n MarkLayer').lines).toEqual(['Markup.io vs MarkLayer']);
  });
});

describe('pickWord', () => {
  it('picks our own name when the last line carries it', () => {
    const layout = layoutHeading('Markup.io vs MarkLayer');
    expect(pickWord(layout)?.text).toBe('MarkLayer');
  });

  it('only ever annotates the last line', () => {
    // Two lines sit 1.08em apart: a stroke and a pin under line one land on
    // line two's letterforms. The caller draws at `lines.length - 1`, so the
    // word it picked has to be one that line actually contains.
    for (const heading of HEADINGS) {
      const layout = layoutHeading(heading);
      const chosen = pickWord(layout);
      if (!chosen) continue;
      expect(layout.lines[layout.lines.length - 1]).toContain(chosen.text);
    }
  });

  it('leaves trailing punctuation out of the stroke', () => {
    const layout = layoutHeading('Why teams choose MarkLayer:');
    expect(pickWord(layout)?.text).toBe('MarkLayer');
  });

  it('keeps the stroke inside the line it underlines', () => {
    for (const heading of HEADINGS) {
      const layout = layoutHeading(heading);
      const chosen = pickWord(layout);
      if (!chosen) continue;
      const line = layout.lines[layout.lines.length - 1] ?? '';
      expect(chosen.start).toBeGreaterThanOrEqual(0);
      expect(chosen.start + chosen.width).toBeLessThanOrEqual(measure({ text: line, size: layout.size }) + 1);
    }
  });

  it('falls back to the longest word with no brand on the line', () => {
    expect(pickWord(layoutHeading('Annotate any webpage'))?.text).toBe('Annotate');
  });
});

describe('buildPageOgSvg', () => {
  it('is deterministic: the same page gets the same card back', () => {
    const once = buildPageOgSvg({ heading: 'Markup.io vs MarkLayer', path: '/vs/markup-io' });
    const twice = buildPageOgSvg({ heading: 'Markup.io vs MarkLayer', path: '/vs/markup-io' });
    expect(once).toBe(twice);
  });

  it('gives different pages different strokes', () => {
    const a = buildPageOgSvg({ heading: 'Markup.io vs MarkLayer', path: '/vs/markup-io' });
    const b = buildPageOgSvg({ heading: 'Pastel vs MarkLayer', path: '/vs/pastel' });
    expect(a).not.toBe(b);
  });

  it('escapes a heading rather than letting it close a tag', () => {
    const svg = buildPageOgSvg({ heading: 'Ship <script>alert(1)</script> faster', path: '/x' });
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;');
  });

  it('escapes the path too', () => {
    const svg = buildPageOgSvg({ heading: 'Pricing', path: '/x"><rect fill="red"' });
    expect(svg).not.toContain('<rect fill="red"');
  });

  it('names the site alone on the root, with no dangling separator', () => {
    const svg = buildPageOgSvg({ heading: 'Annotate any webpage', path: '/' });
    expect(svg).toContain('marklayer.app');
    expect(svg).not.toContain('·');
  });

  it('emits one well-formed root element', () => {
    for (const heading of HEADINGS) {
      const svg = buildPageOgSvg({ heading, path: '/x' });
      expect(svg.startsWith('<svg ')).toBe(true);
      expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
      expect(svg.match(/<svg /g)).toHaveLength(1);
      expect(svg).not.toContain('NaN');
      expect(svg).not.toContain('undefined');
    }
  });

  it('keeps every drawn element inside the card', () => {
    for (const heading of HEADINGS) {
      const svg = buildPageOgSvg({ heading, path: '/x' });
      // The pin is the element most likely to be pushed off the right edge.
      for (const [, cx] of svg.matchAll(/<circle cx="([\d.]+)"/g)) {
        expect(Number(cx)).toBeLessThanOrEqual(1128);
        expect(Number(cx)).toBeGreaterThanOrEqual(72);
      }
    }
  });

  it('draws no annotation when there is nothing to annotate', () => {
    const svg = buildPageOgSvg({ heading: '', path: '/x' });
    expect(svg).not.toContain('<circle');
  });
});
