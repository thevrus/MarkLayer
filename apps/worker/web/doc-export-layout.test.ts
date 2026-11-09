import { describe, expect, test } from 'bun:test';
import { type PageBox, pageTransform, pinPoint } from './doc-export-layout';

// doc.html stacks pages in a flex column with 12px margins, so 24px gutters that do not collapse.
const stack = ({ count, width, height, left }: { count: number; width: number; height: number; left: number }) =>
  new Map<number, PageBox>(
    Array.from({ length: count }, (_, i) => [i + 1, { left, top: 12 + i * (height + 24), width, height }]),
  );

const apply = ({ t, x, y }: { t: ReturnType<typeof pageTransform>; x: number; y: number }) => ({
  x: t.a * x + t.e,
  y: t.d * y + t.f,
});

describe('page mapping', () => {
  const pages = stack({ count: 3, width: 1000, height: 1294, left: 0 });
  const out = { width: 1190, height: 1540 };

  test('a mark on page 2 lands on page 2, at its offset within the page', () => {
    const page2 = pages.get(2);
    if (!page2) throw new Error('no page 2');
    // A quarter across and halfway down page 2, in document space.
    const at = { x: 250, y: page2.top + 647 };
    const p = apply({ t: pageTransform({ box: page2, out }), ...at });
    expect(p.x).toBeCloseTo(297.5);
    expect(p.y).toBeCloseTo(770);
  });

  test('the same mark falls outside page 1 and page 3', () => {
    const at = { x: 250, y: 12 + 1294 + 24 + 647 };
    for (const n of [1, 3]) {
      const box = pages.get(n);
      if (!box) throw new Error(`no page ${n}`);
      const p = apply({ t: pageTransform({ box, out }), ...at });
      expect(p.y < 0 || p.y > out.height).toBe(true);
    }
  });

  test('an image the viewer shrank and centred maps back to its native pixels', () => {
    // A 2400px image shown at 1000px wide, centred in a 1200px frame.
    const box = { left: 100, top: 12, width: 1000, height: 500 };
    const t = pageTransform({ box, out: { width: 2400, height: 1200 } });
    expect(apply({ t, x: 100, y: 12 })).toEqual({ x: 0, y: 0 });
    expect(apply({ t, x: 1100, y: 512 })).toEqual({ x: 2400, y: 1200 });
  });
});

describe('pinPoint', () => {
  test('a page anchor wins over a stale stored point', () => {
    // Stored point says page 1; the anchor says halfway down page 3.
    const pages = stack({ count: 3, width: 800, height: 1000, left: 40 });
    const p = pinPoint({ op: { x: 10, y: 20, pdf: { page: 3, x: 0.5, y: 0.5 } }, pages });
    expect(p).toEqual({ x: 40 + 400, y: 12 + 2 * 1024 + 500 });
  });

  test('without an anchor, or for a page that is not laid out, the stored point stands', () => {
    const pages = stack({ count: 1, width: 800, height: 1000, left: 0 });
    expect(pinPoint({ op: { x: 10, y: 20 }, pages })).toEqual({ x: 10, y: 20 });
    expect(pinPoint({ op: { x: 10, y: 20, pdf: { page: 9, x: 0.5, y: 0.5 } }, pages })).toEqual({ x: 10, y: 20 });
  });
});
