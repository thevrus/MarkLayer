import { describe, expect, test } from 'bun:test';
import { getContainerLines, getDistanceOverlay, guideDistance, nextAnchorElement, pickGuideAtPoint } from './measure';

const rect = (left: number, top: number, width: number, height: number) => ({ left, top, width, height });

describe('getDistanceOverlay', () => {
  test('measures the gap on an axis where the rects are separated', () => {
    // A ends at x=100, B starts at x=160 - a 60px horizontal gap.
    const o = getDistanceOverlay(rect(0, 0, 100, 40), rect(160, 0, 50, 40));
    expect(o.horizontal).toEqual({ x1: 100, x2: 160, y: 20, value: 60 });
    expect(o.vertical).toBeNull();
  });

  test('reports the same positive gap whichever rect is on the left', () => {
    const gap = (a: ReturnType<typeof rect>, b: ReturnType<typeof rect>) => getDistanceOverlay(a, b).horizontal?.value;
    expect(gap(rect(0, 0, 100, 40), rect(160, 0, 50, 40))).toBe(60);
    // B on the left: the line must still run B's right edge to A's left edge.
    expect(gap(rect(160, 0, 50, 40), rect(0, 0, 100, 40))).toBe(60);
  });

  test('measures both axes when the rects sit diagonally to each other', () => {
    const o = getDistanceOverlay(rect(0, 0, 100, 40), rect(160, 100, 50, 40));
    expect(o.horizontal?.value).toBe(60);
    expect(o.vertical?.value).toBe(60);
  });

  test('reports nothing on an axis where the rects overlap', () => {
    const o = getDistanceOverlay(rect(0, 0, 100, 100), rect(50, 50, 100, 100));
    expect(o.horizontal).toBeNull();
    expect(o.vertical).toBeNull();
    expect(o.connectors).toEqual([]);
  });

  test('treats exactly touching edges as separated with a zero gap, not as overlap', () => {
    const o = getDistanceOverlay(rect(0, 0, 100, 40), rect(100, 0, 50, 40));
    expect(o.horizontal?.value).toBe(0);
  });

  test('extends a connector to B when the measurement line misses B vertically', () => {
    // A's centre y is 20 but B spans y 100..140, so the horizontal line floats
    // above B and needs a dashed leg down to B's top edge.
    const o = getDistanceOverlay(rect(0, 0, 100, 40), rect(160, 100, 50, 40));
    expect(o.connectors).toContainEqual({ x1: 160, y1: 20, x2: 160, y2: 100 });
  });

  test('drops a sub-pixel connector rather than emitting a zero-length dash', () => {
    // The line lands 0.25px off B's top edge - too short to draw.
    const o = getDistanceOverlay(rect(0, 0, 100, 40.5), rect(160, 20.5, 50, 40));
    expect(o.connectors).toEqual([]);
  });
});

describe('getContainerLines', () => {
  test('measures each edge gap from the rect to its container', () => {
    const lines = getContainerLines(rect(120, 60, 100, 80), rect(20, 10, 400, 300));
    expect(lines.left.value).toBe(100);
    expect(lines.top.value).toBe(50);
    expect(lines.right.value).toBe(200);
    expect(lines.bottom.value).toBe(170);
  });

  test('clamps a gap to zero when the rect overflows its container', () => {
    // Negative gaps would draw the measurement lines backwards.
    const lines = getContainerLines(rect(-40, -30, 600, 500), rect(0, 0, 400, 300));
    expect(lines.left.value).toBe(0);
    expect(lines.top.value).toBe(0);
    expect(lines.right.value).toBe(0);
    expect(lines.bottom.value).toBe(0);
  });

  test('keeps the measurement lines inside the container when the rect centre is outside it', () => {
    const lines = getContainerLines(rect(500, 400, 100, 80), rect(0, 0, 400, 300));
    expect(lines.top.x).toBe(400);
    expect(lines.left.y).toBe(300);
  });
});

describe('guideDistance', () => {
  // A swapped axis here stays invisible until a guide refuses to be grabbed, so
  // pin both orientations to the coordinate they actually read.
  test('a vertical guide is measured against x, a horizontal one against y', () => {
    const point = { x: 100, y: 500 };
    expect(guideDistance('vertical', 90, point)).toBe(10);
    expect(guideDistance('horizontal', 90, point)).toBe(410);
  });

  test('is unsigned, so a guide on either side of the cursor is equally near', () => {
    expect(guideDistance('vertical', 110, { x: 100, y: 0 })).toBe(10);
    expect(guideDistance('vertical', 90, { x: 100, y: 0 })).toBe(10);
  });
});

describe('pickGuideAtPoint', () => {
  const guides = [
    { id: 'far', orientation: 'vertical' as const, position: 104 },
    { id: 'near', orientation: 'vertical' as const, position: 102 },
    { id: 'other-axis', orientation: 'horizontal' as const, position: 100 },
  ];

  test('returns the closest guide inside the snap radius, not the first one found', () => {
    expect(pickGuideAtPoint({ x: 100, y: 500 }, guides)?.id).toBe('near');
  });

  test('includes a guide exactly at the snap distance', () => {
    const at = [{ id: 'edge', orientation: 'vertical' as const, position: 106 }];
    expect(pickGuideAtPoint({ x: 100, y: 0 }, at, 6)?.id).toBe('edge');
    expect(pickGuideAtPoint({ x: 100, y: 0 }, at, 5)).toBeNull();
  });

  test('returns null when nothing is in range or there are no guides', () => {
    expect(pickGuideAtPoint({ x: 400, y: 400 }, guides)).toBeNull();
    expect(pickGuideAtPoint({ x: 0, y: 0 }, [])).toBeNull();
  });
});

describe('nextAnchorElement', () => {
  const isHost = (el: Element) => el.tagName === 'MARK-LAYER';

  const build = (html: string) => {
    document.body.innerHTML = html;
    const el = document.querySelector('#start');
    if (!el) throw new Error('fixture missing #start');
    return el;
  };

  test('walks up past our own injected UI', () => {
    const start = build('<mark-layer><section id="wrap"><b id="start">x</b></section></mark-layer>');
    expect(nextAnchorElement(start, 'parent', isHost)?.id).toBe('wrap');
    const wrap = document.querySelector('#wrap');
    if (!wrap) throw new Error('missing #wrap');
    // #wrap's only remaining ancestors are <mark-layer>, body and html.
    expect(nextAnchorElement(wrap, 'parent', isHost)).toBeNull();
  });

  test('never returns body or documentElement as a parent', () => {
    const start = build('<div id="start">x</div>');
    expect(nextAnchorElement(start, 'parent', isHost)).toBeNull();
  });

  test('skips our UI when descending and when moving between siblings', () => {
    const child = build('<div id="start"><mark-layer></mark-layer><span id="kid">x</span></div>');
    expect(nextAnchorElement(child, 'child', isHost)?.id).toBe('kid');

    const sibs = build(
      '<div><i id="prev"></i><mark-layer></mark-layer><i id="start"></i><mark-layer></mark-layer><i id="next"></i></div>',
    );
    expect(nextAnchorElement(sibs, 'next', isHost)?.id).toBe('next');
    expect(nextAnchorElement(sibs, 'prev', isHost)?.id).toBe('prev');
  });

  test('returns null at the ends of a subtree', () => {
    const start = build('<div><i id="start"></i></div>');
    expect(nextAnchorElement(start, 'child', isHost)).toBeNull();
    expect(nextAnchorElement(start, 'next', isHost)).toBeNull();
    expect(nextAnchorElement(start, 'prev', isHost)).toBeNull();
  });
});
