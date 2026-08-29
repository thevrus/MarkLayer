import { describe, expect, it } from 'bun:test';
import { collectMarks, liftColor, renderMarks } from './og-marks';

const base = { id: 'a', color: '#ff0055', lineWidth: 4 };

describe('liftColor', () => {
  it('re-emits a parsed color as #rrggbb', () => {
    expect(liftColor('#f05')).toBe('#ff0055');
    expect(liftColor('rgb(255, 0, 85)')).toBe('#ff0055');
    expect(liftColor('rgba(255,0,85,0.5)')).toBe('#ff0055');
  });

  it('never emits anything that could break out of an SVG attribute', () => {
    // The one that matters: ops are stored user input and land in fill="...".
    for (const hostile of ['" onload="x', 'red"/><script>', 'url(#x)', '', 'chartreuse']) {
      expect(liftColor(hostile)).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('lifts near-black off a black ground but keeps a legible hue', () => {
    expect(liftColor('#000000')).not.toBe('#000000');
    expect(liftColor('#ffffff')).toBe('#ffffff');
    // Saturated ink is dark by luminance and still perfectly visible: leave it.
    expect(liftColor('#ff0055')).toBe('#ff0055');
    expect(liftColor('#1a56ff')).toBe('#1a56ff');
    // A dark blue stays blue: its own channel still dominates after the lift.
    const lifted = liftColor('#101040');
    const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(lifted.slice(i, i + 2), 16));
    expect(b).toBeGreaterThan(r);
    expect(b).toBeGreaterThan(g);
  });
});

describe('collectMarks', () => {
  it('counts an op whose schema no longer parses', () => {
    // A row written before `compositeOperation` existed still says what it was.
    const { marks, tally } = collectMarks([{ tool: 'pen', points: [{ x: 1, y: 1 }] }]);
    expect(tally.drawings).toBe(1);
    expect(marks).toHaveLength(0);
  });

  it('counts a comment thread once, not once per reply', () => {
    const thread = { ...base, tool: 'comment', num: 1, text: 'hi', x: 10, y: 10, ts: 0 };
    const { tally } = collectMarks([thread, { ...thread, id: 'b', parentId: 'a' }]);
    expect(tally.comments).toBe(1);
  });

  it('ignores ops with no paintable geometry', () => {
    const { marks, tally } = collectMarks([
      { ...base, tool: 'guide', orientation: 'horizontal', position: 40 },
      { ...base, tool: 'text', text: 'note', x: 1, y: 2, fontSize: 14 },
    ]);
    expect(marks).toHaveLength(0);
    expect(tally.notes).toBe(1);
  });
});

describe('renderMarks', () => {
  // The card's real panel: drawn wider than the window so the crop can pan.
  const place = { page: { x: 452, width: 868 }, visible: { x: 452, y: 58, w: 748, h: 356 } };

  it('renders nothing when there is nothing to draw', () => {
    expect(renderMarks({ marks: [], ...place, viewportWidth: 1440 })).toBe('');
  });

  it('keeps every drawn coordinate inside the window it was cropped to', () => {
    // A wide annotation low on a tall page: at page scale it would sit below the
    // window, so the crop has to bring it back into frame.
    const { marks, viewportWidth } = collectMarks([
      { ...base, tool: 'rectangle', startX: 40, startY: 3000, endX: 1200, endY: 3300 },
      { ...base, tool: 'comment', num: 3, text: 'x', x: 1200, y: 3300, ts: 0 },
    ]);
    const svg = renderMarks({ marks, ...place, viewportWidth });
    // `\b` would also match the `x` of `rx`, so anchor on the space before it.
    const xs = [...svg.matchAll(/ c?x="(-?[\d.]+)"/g)].map((m) => Number(m[1]));
    const ys = [...svg.matchAll(/ c?y="(-?[\d.]+)"/g)].map((m) => Number(m[1]));
    expect(xs.length).toBeGreaterThan(0);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(place.visible.x);
    expect(Math.max(...xs)).toBeLessThanOrEqual(place.visible.x + place.visible.w);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(place.visible.y);
    expect(Math.max(...ys)).toBeLessThanOrEqual(place.visible.y + place.visible.h);
  });

  it('never scrolls above the top of the page', () => {
    // Two pins in the page's top-left corner belong at the top-left of the card,
    // not floated to the middle with blank ground revealed above them.
    const pin = { ...base, tool: 'comment', text: 'x', ts: 0, captureViewport: { width: 1440, height: 900 } };
    const { marks, viewportWidth } = collectMarks([
      { ...pin, num: 1, x: 40, y: 30 },
      { ...pin, id: 'b', num: 2, x: 900, y: 90 },
    ]);
    const svg = renderMarks({ marks, ...place, viewportWidth });
    const ys = [...svg.matchAll(/ cy="(-?[\d.]+)"/g)].map((m) => Number(m[1]));
    expect(Math.min(...ys)).toBeLessThan(place.visible.y + place.visible.h / 2);
  });

  it('crops in when the annotations would otherwise be lost on the page', () => {
    const pin = { ...base, tool: 'comment', text: 'x', ts: 0, captureViewport: { width: 2560, height: 1440 } };
    const { marks, viewportWidth } = collectMarks([
      { ...pin, num: 1, x: 100, y: 700 },
      { ...pin, id: 'b', num: 2, x: 240, y: 760 },
    ]);
    const svg = renderMarks({ marks, ...place, viewportWidth });
    const xs = [...svg.matchAll(/ cx="(-?[\d.]+)"/g)].map((m) => Number(m[1]));
    // At true page scale (868/2560) the pins would sit ~47px apart, a speck in a
    // 748px window; the crop has to open them up.
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(100);
  });

  it('drops a non-finite coordinate instead of emitting NaN into the SVG', () => {
    const { marks, viewportWidth } = collectMarks([
      { ...base, tool: 'circle', centerX: Number.NaN, centerY: 10, radius: 5 },
      { ...base, tool: 'rectangle', startX: 0, startY: 0, endX: 100, endY: 100 },
    ]);
    expect(renderMarks({ marks, ...place, viewportWidth })).not.toContain('NaN');
  });
});
