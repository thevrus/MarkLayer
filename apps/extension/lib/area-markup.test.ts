import { describe, expect, test } from 'bun:test';
import { clampToRect, markupOp } from './area-markup';
import { areaCrop } from './area-shot';

const style = { color: '#f43f5e', lineWidth: 3 };

describe('markupOp', () => {
  test('an arrow is a line op carrying the arrow flag, so the shared renderer draws the head', () => {
    const op = markupOp({
      tool: 'arrow',
      points: [
        { x: 1, y: 2 },
        { x: 30, y: 40 },
      ],
      style,
      shift: false,
    });
    expect(op).toMatchObject({ tool: 'line', arrow: true, startX: 1, startY: 2, endX: 30, endY: 40 });
  });

  test('a click with no drag makes no mark', () => {
    for (const tool of ['pen', 'circle', 'rectangle', 'arrow'] as const) {
      expect(markupOp({ tool, points: [{ x: 4, y: 4 }], style, shift: false })).toBeNull();
      expect(
        markupOp({
          tool,
          points: [
            { x: 4, y: 4 },
            { x: 4, y: 4 },
          ],
          style,
          shift: false,
        }),
      ).toBeNull();
    }
  });

  test('shift squares a rectangle and snaps a pen stroke straight', () => {
    const sq = markupOp({
      tool: 'rectangle',
      points: [
        { x: 0, y: 0 },
        { x: 40, y: 10 },
      ],
      style,
      shift: true,
    });
    expect(sq).toMatchObject({ endX: 40, endY: 40 });
    const pen = markupOp({
      tool: 'pen',
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 3 },
        { x: 40, y: 1 },
      ],
      style,
      shift: true,
    });
    expect(pen).toMatchObject({ tool: 'pen' });
    if (pen?.tool !== 'pen') throw new Error('expected a pen op');
    expect(pen.points).toHaveLength(2);
    expect(pen.points[1]?.y).toBeCloseTo(0);
  });
});

describe('clampToRect', () => {
  // A stroke that left the area would be cut off in the shot but still show in the live preview.
  test('keeps a pointer that left the area on its edge', () => {
    const r = { x: 100, y: 200, w: 50, h: 40 };
    expect(clampToRect({ p: { x: 10, y: 999 }, r })).toEqual({ x: 100, y: 240 });
    expect(clampToRect({ p: { x: 120, y: 210 }, r })).toEqual({ x: 120, y: 210 });
  });
});

describe('areaCrop', () => {
  const viewport = { width: 1000, height: 600 };

  test('is the visible part of the area, in viewport coordinates', () => {
    const crop = areaCrop({ rect: { x: 900, y: 1500, w: 300, h: 200 }, scroll: { x: 0, y: 1000 }, viewport });
    expect(crop).toEqual({ x: 900, y: 500, width: 100, height: 100 });
  });

  test('is null once the area has scrolled out of view', () => {
    expect(areaCrop({ rect: { x: 0, y: 0, w: 300, h: 200 }, scroll: { x: 0, y: 1000 }, viewport })).toBeNull();
  });
});
