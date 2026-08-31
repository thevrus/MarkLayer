import { describe, expect, test } from 'bun:test';
import type { CircleOp, FreehandOp, LineOp, Point, RectOp } from '@marklayer/types';
import {
  circleHitsRect,
  constrainEnd,
  hexToRgba,
  inView,
  opBounds,
  redrawCanvas,
  renderOp,
  simplify,
  strokeArrowHead,
} from './renderer';

const base = { id: 'op', color: '#000', lineWidth: 2 };

const freehand = (points: Point[], lineWidth = 2): FreehandOp => ({
  ...base,
  lineWidth,
  tool: 'pen',
  points,
  compositeOperation: 'source-over',
});

const rect = (over: Partial<RectOp> = {}): RectOp => ({
  ...base,
  tool: 'rectangle',
  startX: 10,
  startY: 20,
  endX: 110,
  endY: 60,
  ...over,
});

const line = (over: Partial<LineOp> = {}): LineOp => ({
  ...base,
  tool: 'line',
  startX: 0,
  startY: 0,
  endX: 100,
  endY: 0,
  ...over,
});

const circle = (over: Partial<CircleOp> = {}): CircleOp => ({
  ...base,
  tool: 'circle',
  centerX: 100,
  centerY: 100,
  radius: 40,
  ...over,
});

const close = (actual: Point, x: number, y: number) => {
  expect(actual.x).toBeCloseTo(x, 6);
  expect(actual.y).toBeCloseTo(y, 6);
};

describe('constrainEnd', () => {
  test('snaps a line to the nearest 45 degree increment, keeping the drag length', () => {
    // Dragged 100 right and 10 down: near horizontal, so it flattens.
    close(constrainEnd('line', 0, 0, 100, 10), Math.hypot(100, 10), 0);
    // Dragged near the diagonal: snaps onto it.
    const diagonal = constrainEnd('line', 0, 0, 100, 90);
    expect(diagonal.x).toBeCloseTo(diagonal.y, 6);
  });

  test('preserves the cursor distance rather than projecting onto the axis', () => {
    // A projection would give x=100; a rotation keeps the full drag length.
    expect(constrainEnd('line', 0, 0, 100, 40).x).toBeCloseTo(Math.hypot(100, 40), 6);
  });

  test('snaps into every quadrant, not just the positive one', () => {
    close(constrainEnd('line', 0, 0, -100, 5), -Math.hypot(100, 5), 0);
    close(constrainEnd('arrow', 0, 0, 5, -100), 0, -Math.hypot(5, 100));
  });

  test('returns the cursor untouched when there is no drag to take an angle from', () => {
    // atan2(0, 0) is 0, which would snap a zero-length drag onto the x axis.
    close(constrainEnd('line', 50, 60, 50, 60), 50, 60);
  });

  test('locks a rectangle to a square on the longer axis', () => {
    close(constrainEnd('rectangle', 0, 0, 100, 40), 100, 100);
    close(constrainEnd('rectangle', 0, 0, 40, 100), 100, 100);
  });

  test('keeps a square in the direction it was dragged', () => {
    // Up and to the left has to stay up and to the left.
    close(constrainEnd('rectangle', 0, 0, -100, -40), -100, -100);
    close(constrainEnd('rectangle', 0, 0, 100, -40), 100, -100);
  });

  test('constrains freehand tools by angle, and leaves the rest alone', () => {
    for (const tool of ['pen', 'highlight', 'eraser', 'arrow'] as const) {
      expect(constrainEnd(tool, 0, 0, 100, 10).y).toBeCloseTo(0, 6);
    }
    // A circle has no shift constraint here; the cursor passes straight through.
    close(constrainEnd('circle', 0, 0, 100, 10), 100, 10);
    close(constrainEnd('comment', 0, 0, 100, 10), 100, 10);
  });
});

describe('hexToRgba', () => {
  test('expands both hex lengths', () => {
    expect(hexToRgba('#ff8800')).toBe('rgba(255,136,0,1)');
    expect(hexToRgba('#f80')).toBe('rgba(255,136,0,1)');
  });

  test('carries the alpha through', () => {
    expect(hexToRgba('#000000', 0.4)).toBe('rgba(0,0,0,0.4)');
  });

  test('falls back to black rather than inventing a colour from malformed input', () => {
    // `parseInt('abc', 16)` succeeds and would silently paint something blue-ish.
    for (const bad of ['abc', '#abcd', '#12345', '', '#', 'rgb(1,2,3)', 'oklch(0.5 0 0)']) {
      expect(hexToRgba(bad, 0.5)).toBe('rgba(0,0,0,0.5)');
    }
  });

  test('falls back when the digits are not hex at all', () => {
    expect(hexToRgba('#zzzzzz')).toBe('rgba(0,0,0,1)');
  });

  test('reads the channels in RGB order', () => {
    // A shift here paints every stroke the wrong colour and nothing throws.
    expect(hexToRgba('#010203')).toBe('rgba(1,2,3,1)');
  });
});

describe('simplify', () => {
  test('returns a short path untouched', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 5, y: 90 },
    ];
    expect(simplify(pts)).toBe(pts);
  });

  test('drops points that sit on the line between their neighbours', () => {
    const straight = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
      { x: 30, y: 0 },
    ];
    expect(simplify(straight)).toEqual([
      { x: 0, y: 0 },
      { x: 30, y: 0 },
    ]);
  });

  test('keeps a point that deviates by more than the tolerance', () => {
    const kinked = [
      { x: 0, y: 0 },
      { x: 10, y: 50 },
      { x: 20, y: 0 },
    ];
    expect(simplify(kinked, 1)).toEqual(kinked);
  });

  test('always keeps the first and last point, so a stroke never loses its ends', () => {
    const pts = Array.from({ length: 40 }, (_, i) => ({ x: i, y: 0 }));
    const out = simplify(pts);
    expect(out[0]).toEqual({ x: 0, y: 0 });
    expect(out[out.length - 1]).toEqual({ x: 39, y: 0 });
  });

  test('keeps the surviving points in drawing order', () => {
    // The recursion emits left subtree, pivot, right subtree; out of order the
    // stroke would fold back on itself.
    const zigzag = [
      { x: 0, y: 0 },
      { x: 10, y: 40 },
      { x: 20, y: 0 },
      { x: 30, y: 40 },
      { x: 40, y: 0 },
    ];
    const xs = simplify(zigzag, 1).map((p) => p.x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(xs).toEqual([0, 10, 20, 30, 40]);
  });

  test('drops more points as the tolerance grows', () => {
    const wobble = Array.from({ length: 60 }, (_, i) => ({ x: i, y: i % 2 ? 1 : 0 }));
    expect(simplify(wobble, 0.5).length).toBeGreaterThan(simplify(wobble, 20).length);
    expect(simplify(wobble, 20)).toHaveLength(2);
  });

  test('handles a path where every point is identical', () => {
    const stacked = Array.from({ length: 5 }, () => ({ x: 7, y: 7 }));
    expect(simplify(stacked)).toEqual([
      { x: 7, y: 7 },
      { x: 7, y: 7 },
    ]);
  });
});

describe('opBounds', () => {
  test('pads a freehand stroke by its brush radius, which is wider than the line', () => {
    // Freehand renders through perfect-freehand at 2.5x the nominal width, so a
    // half-lineWidth pad would clip the stroke at a viewport edge.
    const b = opBounds(
      freehand(
        [
          { x: 100, y: 100 },
          { x: 200, y: 140 },
        ],
        4,
      ),
    );
    expect(b).toEqual({ x: 100 - 6, y: 100 - 6, w: 100 + 12, h: 40 + 12 });
  });

  test('returns null for a freehand op with no points', () => {
    expect(opBounds(freehand([]))).toBeNull();
  });

  test('normalises a rectangle dragged backwards', () => {
    const forward = opBounds(rect());
    const backward = opBounds(rect({ startX: 110, startY: 60, endX: 10, endY: 20 }));
    expect(backward).toEqual(forward);
    expect(forward).toEqual({ x: 9, y: 19, w: 102, h: 42 });
  });

  test('pads a plain line by half its stroke width', () => {
    expect(opBounds(line({ lineWidth: 6 }))).toEqual({ x: -3, y: -3, w: 106, h: 6 });
  });

  test('pads an arrow on every side, because the head sweeps out at any angle', () => {
    // The head extends past the endpoint by max(10, lineWidth*4) in a direction
    // the bounding box cannot know, so the pad has to be isotropic.
    const arrow = opBounds(line({ lineWidth: 2, arrow: true }));
    expect(arrow).toEqual({ x: -11, y: -11, w: 122, h: 22 });

    const thick = opBounds(line({ lineWidth: 6, arrow: true }));
    expect(thick).toEqual({ x: -27, y: -27, w: 154, h: 54 });
  });

  test('bounds a circle around its full diameter', () => {
    expect(opBounds(circle({ lineWidth: 2 }))).toEqual({ x: 59, y: 59, w: 82, h: 82 });
  });

  test('returns null for the ops drawn as DOM rather than on the canvas', () => {
    const dom = [
      { ...base, tool: 'comment' as const, num: 1, text: '', x: 0, y: 0, ts: 0 },
      { ...base, tool: 'selection' as const, text: '', rects: [], ts: 0 },
      { ...base, tool: 'area' as const, startX: 0, startY: 0, endX: 1, endY: 1, ts: 0 },
      { ...base, tool: 'guide' as const, orientation: 'vertical' as const, position: 10 },
    ];
    for (const op of dom) expect(opBounds(op)).toBeNull();
  });
});

describe('inView', () => {
  const viewport = [0, 0, 1000, 800] as const;
  const box = (x: number, y: number, w = 100, h = 100) => ({ x, y, w, h });

  test('keeps a box overlapping the viewport', () => {
    expect(inView(box(500, 400), ...viewport)).toBe(true);
  });

  test('drops a box entirely outside it, on any side', () => {
    expect(inView(box(-200, 400), ...viewport)).toBe(false);
    expect(inView(box(1100, 400), ...viewport)).toBe(false);
    expect(inView(box(500, -200), ...viewport)).toBe(false);
    expect(inView(box(500, 900), ...viewport)).toBe(false);
  });

  test('keeps a box straddling an edge, so nothing pops in halfway', () => {
    expect(inView(box(-50, 400), ...viewport)).toBe(true);
    expect(inView(box(950, 400), ...viewport)).toBe(true);
    expect(inView(box(500, 750), ...viewport)).toBe(true);
  });

  test('treats a box that only touches the edge as outside', () => {
    // Exactly abutting: zero pixels of it would be painted.
    expect(inView(box(-100, 0), ...viewport)).toBe(false);
    expect(inView(box(1000, 0), ...viewport)).toBe(false);
  });

  test('keeps an op with no bounds, since it is drawn as DOM and never culled', () => {
    expect(inView(null, ...viewport)).toBe(true);
  });

  test('respects a scrolled viewport origin', () => {
    // The same box is off-screen at the top of the page and on-screen after a scroll.
    expect(inView(box(500, 2000), 0, 0, 1000, 800)).toBe(false);
    expect(inView(box(500, 2000), 0, 1800, 1000, 800)).toBe(true);
  });
});

describe('circleHitsRect', () => {
  test('hits a rect the circle centre is inside', () => {
    expect(circleHitsRect(50, 50, 5, 0, 0, 100, 100)).toBe(true);
  });

  test('hits through the nearest edge, and misses just past the radius', () => {
    // Centre 10px left of the rect: a radius of 10 reaches it, 9 does not.
    expect(circleHitsRect(-10, 50, 10, 0, 0, 100, 100)).toBe(true);
    expect(circleHitsRect(-10, 50, 9, 0, 0, 100, 100)).toBe(false);
  });

  test('measures to the corner diagonally, not to the edges independently', () => {
    // 10 left and 10 above the corner: distance is ~14.14, so r=11 must miss
    // even though each axis is within 11.
    expect(circleHitsRect(-10, -10, 11, 0, 0, 100, 100)).toBe(false);
    expect(circleHitsRect(-10, -10, 15, 0, 0, 100, 100)).toBe(true);
  });

  test('hits a zero-size rect, which is how a comment pin is tested', () => {
    expect(circleHitsRect(100, 100, 8, 103, 103, 0, 0)).toBe(true);
    expect(circleHitsRect(100, 100, 4, 103, 103, 0, 0)).toBe(false);
  });

  test('hits a rect entirely inside the circle', () => {
    expect(circleHitsRect(50, 50, 500, 40, 40, 20, 20)).toBe(true);
  });

  test('never hits with a zero radius unless the point is on the rect', () => {
    expect(circleHitsRect(50, 50, 0, 0, 0, 100, 100)).toBe(true);
    expect(circleHitsRect(150, 50, 0, 0, 0, 100, 100)).toBe(false);
  });
});

/**
 * A recording stand-in for the 2D context. happy-dom has no canvas, and what
 * matters here is the coordinate maths — the scroll offset and the capture
 * scale applied to every point — not the pixels.
 */
interface Call {
  op: string;
  args: number[];
}

const recordingContext = () => {
  const calls: Call[] = [];
  const log =
    (op: string) =>
    (...args: number[]) =>
      calls.push({ op, args });
  // `renderOp` writes strokeStyle/lineWidth/font/globalCompositeOperation straight
  // onto the context, so they land on this object as own properties.
  const ctx: Record<string, unknown> & { calls: Call[] } = {
    calls,
    save: () => calls.push({ op: 'save', args: [] }),
    restore: () => calls.push({ op: 'restore', args: [] }),
    beginPath: () => calls.push({ op: 'beginPath', args: [] }),
    closePath: () => calls.push({ op: 'closePath', args: [] }),
    stroke: () => calls.push({ op: 'stroke', args: [] }),
    fill: () => calls.push({ op: 'fill', args: [] }),
    moveTo: log('moveTo'),
    lineTo: log('lineTo'),
    arc: log('arc'),
    strokeRect: log('strokeRect'),
    clearRect: log('clearRect'),
    fillText: (text: string, x: number, y: number) => calls.push({ op: `fillText:${text}`, args: [x, y] }),
  };
  return ctx;
};

/** The recording context is a coordinate probe, not a CanvasRenderingContext2D. */
const asContext = (ctx: ReturnType<typeof recordingContext>): CanvasRenderingContext2D =>
  ctx as unknown as CanvasRenderingContext2D;

const argsOf = (ctx: ReturnType<typeof recordingContext>, op: string) =>
  ctx.calls.filter((c) => c.op === op).map((c) => c.args);

describe('strokeArrowHead', () => {
  test('draws both barbs out from the tip', () => {
    const ctx = recordingContext();
    strokeArrowHead(asContext(ctx), { start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, lineWidth: 2 });

    // Two legs, each starting at the tip.
    expect(argsOf(ctx, 'moveTo')).toEqual([
      [100, 0],
      [100, 0],
    ]);
    const barbs = argsOf(ctx, 'lineTo');
    expect(barbs).toHaveLength(2);
    // Symmetric about the shaft, and behind the tip.
    const [a, b] = barbs;
    if (!a || !b) throw new Error('missing barbs');
    expect(a[0]).toBeCloseTo(b[0] ?? 0, 6);
    expect(a[0] ?? 0).toBeLessThan(100);
    expect(a[1] ?? 0).toBeCloseTo(-(b[1] ?? 0), 6);
  });

  test('opens and strokes its own path, so the caller shaft is already committed', () => {
    const ctx = recordingContext();
    strokeArrowHead(asContext(ctx), { start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, lineWidth: 2 });
    expect(ctx.calls[0]?.op).toBe('beginPath');
    expect(ctx.calls[ctx.calls.length - 1]?.op).toBe('stroke');
  });
});

describe('renderOp', () => {
  test('subtracts the scroll offset to get viewport coordinates', () => {
    const ctx = recordingContext();
    renderOp(asContext(ctx), rect({ startX: 100, startY: 500, endX: 200, endY: 600 }), 40, 400);
    expect(argsOf(ctx, 'strokeRect')).toEqual([[60, 100, 100, 100]]);
  });

  test('normalises a rectangle dragged backwards into a positive box', () => {
    const ctx = recordingContext();
    renderOp(asContext(ctx), rect({ startX: 200, startY: 600, endX: 100, endY: 500 }), 0, 0);
    expect(argsOf(ctx, 'strokeRect')).toEqual([[100, 500, 100, 100]]);
  });

  test('scales coordinates and sizes together', () => {
    const ctx = recordingContext();
    renderOp(asContext(ctx), rect({ startX: 100, startY: 100, endX: 200, endY: 200 }), 0, 0, 2);
    expect(argsOf(ctx, 'strokeRect')).toEqual([[200, 200, 200, 200]]);
    expect(ctx.lineWidth).toBe(4);
  });

  test('draws a line between its endpoints and no arrow head unless asked', () => {
    const ctx = recordingContext();
    renderOp(asContext(ctx), line({ startX: 10, startY: 20, endX: 110, endY: 20 }), 0, 0);
    expect(argsOf(ctx, 'moveTo')).toEqual([[10, 20]]);
    expect(argsOf(ctx, 'lineTo')).toEqual([[110, 20]]);
  });

  test('adds two barbs for an arrow', () => {
    const ctx = recordingContext();
    renderOp(asContext(ctx), line({ arrow: true }), 0, 0);
    // The shaft plus both barbs.
    expect(argsOf(ctx, 'lineTo')).toHaveLength(3);
  });

  test('draws a circle at its scaled centre and radius', () => {
    const ctx = recordingContext();
    renderOp(asContext(ctx), circle({ centerX: 100, centerY: 200, radius: 40 }), 0, 100, 2);
    const [arc] = argsOf(ctx, 'arc');
    expect(arc?.slice(0, 3)).toEqual([200, 300, 80]);
  });

  test('draws text at its own scaled origin and font size', () => {
    const ctx = recordingContext();
    const text = { ...base, tool: 'text' as const, text: 'note', x: 50, y: 60, fontSize: 16 };
    renderOp(asContext(ctx), text, 10, 20, 2);
    expect(argsOf(ctx, 'fillText:note')).toEqual([[90, 100]]);
    expect(String(ctx.font)).toContain('32px');
  });

  test('carries a freehand op composite mode onto the context', () => {
    // The eraser paints with destination-out; losing it turns the eraser into a pen.
    const ctx = recordingContext();
    renderOp(
      asContext(ctx),
      {
        ...base,
        tool: 'eraser',
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 10 },
          { x: 20, y: 0 },
        ],
        compositeOperation: 'destination-out',
      },
      0,
      0,
    );
    expect(ctx.globalCompositeOperation).toBe('destination-out');
    expect(ctx.calls.some((c) => c.op === 'fill')).toBe(true);
  });

  test('defaults the composite mode for a shape that carries none', () => {
    const ctx = recordingContext();
    renderOp(asContext(ctx), rect(), 0, 0);
    expect(ctx.globalCompositeOperation).toBe('source-over');
  });

  test('draws nothing for the ops rendered as DOM', () => {
    for (const tool of ['comment', 'selection'] as const) {
      const ctx = recordingContext();
      const op =
        tool === 'comment'
          ? { ...base, tool, num: 1, text: '', x: 0, y: 0, ts: 0 }
          : { ...base, tool, text: '', rects: [], ts: 0 };
      renderOp(asContext(ctx), op, 0, 0);
      expect(ctx.calls).toEqual([]);
    }
  });

  test('draws nothing for an empty freehand path, but does draw a single-point dot', () => {
    const empty = recordingContext();
    renderOp(asContext(empty), freehand([]), 0, 0);
    expect(empty.calls.some((c) => c.op === 'fill')).toBe(false);

    // One point is a tap, and perfect-freehand gives it a round outline.
    const dot = recordingContext();
    renderOp(asContext(dot), freehand([{ x: 5, y: 5 }]), 0, 0);
    expect(dot.calls.some((c) => c.op === 'fill')).toBe(true);
  });

  test('always balances save with restore', () => {
    for (const op of [rect(), line(), circle(), freehand([{ x: 0, y: 0 }])]) {
      const ctx = recordingContext();
      renderOp(asContext(ctx), op, 0, 0);
      expect(ctx.calls.filter((c) => c.op === 'save')).toHaveLength(1);
      expect(ctx.calls.filter((c) => c.op === 'restore')).toHaveLength(1);
    }
  });
});

describe('redrawCanvas', () => {
  const canvasWith = (ctx: ReturnType<typeof recordingContext>) =>
    ({ getContext: () => ctx }) as unknown as HTMLCanvasElement;

  test('clears in CSS pixels, not the device-pixel buffer size', () => {
    // The context carries a DPR transform, so clearing against `canvas.width`
    // would over-clear on a Retina screen.
    const ctx = recordingContext();
    redrawCanvas(canvasWith(ctx), []);
    expect(argsOf(ctx, 'clearRect')).toEqual([[0, 0, window.innerWidth, window.innerHeight]]);
  });

  test('culls an op that is nowhere near the viewport', () => {
    const ctx = recordingContext();
    redrawCanvas(canvasWith(ctx), [rect({ startX: 0, startY: 90_000, endX: 100, endY: 90_100 })]);
    expect(argsOf(ctx, 'strokeRect')).toEqual([]);
  });

  test('draws an op inside the viewport', () => {
    const ctx = recordingContext();
    redrawCanvas(canvasWith(ctx), [rect({ startX: 10, startY: 20, endX: 110, endY: 60 })]);
    expect(argsOf(ctx, 'strokeRect')).toEqual([[10, 20, 100, 40]]);
  });

  test('gives up quietly when the canvas has no 2D context', () => {
    const blind = { getContext: () => null } as unknown as HTMLCanvasElement;
    expect(() => redrawCanvas(blind, [rect()])).not.toThrow();
  });
});
