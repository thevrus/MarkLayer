import { beforeEach, describe, expect, test } from 'bun:test';
import { effect } from '@preact/signals';
import { createStrokeEngine, type EraserHooks } from './stroke-engine';
import { isDrawingActive } from './tool-state';
import { TOOLS, toolPaintsCanvas } from './tools';
import type { DrawOp, Point, Tool } from './types';

/** Records what lands on the canvas; the snapshot restore is what proves a preview is not additive. */
function fakeContext() {
  const calls: string[] = [];
  const ctx = {
    canvas: { width: 10, height: 10 },
    lineWidth: 0,
    getImageData: () => {
      calls.push('snapshot');
      return {};
    },
    putImageData: () => calls.push('restore'),
    save() {},
    restore() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    arc() {},
    closePath() {},
    fill() {},
    stroke: () => calls.push('stroke'),
    strokeRect: () => calls.push('strokeRect'),
  };
  return { ctx, calls };
}

function setup({ tool, scroll = { x: 0, y: 0 }, eraser }: { tool: Tool; scroll?: Point; eraser?: EraserHooks }) {
  const { ctx, calls } = fakeContext();
  const committed: DrawOp[] = [];
  const engine = createStrokeEngine({
    // @ts-expect-error a recording stand-in: the engine only touches what is stubbed above
    context: () => ctx,
    toDoc: ({ x, y }) => ({ x: x + scroll.x, y: y + scroll.y }),
    offset: () => scroll,
    tool: () => tool,
    color: () => '#ff0000',
    lineWidth: () => 4,
    commit: (op) => committed.push(op),
    eraser,
  });
  return { engine, committed, calls, scroll };
}

const drag = (engine: ReturnType<typeof setup>['engine'], points: Point[], shift = false) => {
  const [first, ...rest] = points;
  if (!first) return;
  engine.down({ client: first, shift });
  for (const client of rest.slice(0, -1)) engine.move({ client, shift });
  engine.up({ client: rest.at(-1) ?? first, shift });
};

const zigzag = Array.from({ length: 40 }, (_, i) => ({ x: i * 2, y: i % 2 ? 0.2 : 0 }));

describe('createStrokeEngine', () => {
  beforeEach(() => {
    isDrawingActive.value = false;
  });

  test('a tool that does not draw leaves the press to the page', () => {
    const { engine } = setup({ tool: 'navigate' });
    expect(engine.down({ client: { x: 0, y: 0 }, shift: false })).toBe(false);
    expect(engine.drawing).toBe(false);
    expect(isDrawingActive.value).toBe(false);
  });

  test('takes the press for exactly the tools the canvas is shown for', () => {
    // A mismatch swallows a click meant for the page, or lets a stroke fall through it.
    const taken = TOOLS.filter((tool) => setup({ tool }).engine.down({ client: { x: 0, y: 0 }, shift: false }));
    expect(taken).toEqual(TOOLS.filter(toolPaintsCanvas));
    expect(taken.length).toBeGreaterThan(0);
    isDrawingActive.value = false;
  });

  test('pen strokes are simplified, eraser masks keep every point', () => {
    const pen = setup({ tool: 'pen' });
    drag(pen.engine, zigzag);
    const eraser = setup({ tool: 'eraser' });
    drag(eraser.engine, zigzag);

    const [penOp] = pen.committed;
    const [eraserOp] = eraser.committed;
    if (penOp?.tool !== 'pen' || eraserOp?.tool !== 'eraser') throw new Error('expected freehand ops');
    expect(penOp.points.length).toBeLessThan(zigzag.length);
    expect(eraserOp.points).toHaveLength(zigzag.length);
    expect(eraserOp.compositeOperation).toBe('destination-out');
  });

  test('highlight stores its translucent colour and wider line', () => {
    const { engine, committed } = setup({ tool: 'highlight' });
    drag(engine, zigzag);
    expect(committed[0]).toMatchObject({ color: 'rgba(255,0,0,0.4)', lineWidth: 8 });
  });

  test('a click without a drag ends the stroke cleanly', () => {
    const { engine, committed } = setup({ tool: 'pen' });
    engine.down({ client: { x: 5, y: 5 }, shift: false });
    engine.up({ client: { x: 5, y: 5 }, shift: false });
    expect(isDrawingActive.value).toBe(false);
    expect(engine.drawing).toBe(false);
    // Press and release at one spot is a dot for a pen, and nothing for a shape.
    expect(committed).toHaveLength(1);

    const shape = setup({ tool: 'rectangle' });
    drag(shape.engine, [
      { x: 5, y: 5 },
      { x: 5, y: 5 },
    ]);
    expect(shape.committed).toEqual([]);
  });

  test('Shift locks freehand to a straight constrained line from the start', () => {
    const { engine, committed } = setup({ tool: 'pen' });
    drag(
      engine,
      [
        { x: 0, y: 0 },
        { x: 50, y: 3 },
        { x: 100, y: 2 },
      ],
      true,
    );
    const [line] = committed;
    if (line?.tool !== 'pen') throw new Error('expected a pen op');
    expect(line.points).toHaveLength(2);
    expect(line.points[0]).toEqual({ x: 0, y: 0 });
    expect(line.points[1]?.y).toBe(0);
  });

  test('Shift constrains a shape, in document space', () => {
    const { engine, committed } = setup({ tool: 'line', scroll: { x: 0, y: 500 } });
    drag(
      engine,
      [
        { x: 10, y: 10 },
        { x: 110, y: 12 },
      ],
      true,
    );
    expect(committed[0]).toMatchObject({ tool: 'line', startX: 10, startY: 510, endY: 510 });
  });

  test('releasing Shift mid-stroke keeps the points gathered before it', () => {
    const { engine, committed } = setup({ tool: 'pen' });
    engine.down({ client: { x: 0, y: 0 }, shift: false });
    engine.move({ client: { x: 10, y: 40 }, shift: false });
    engine.setShift(true);
    engine.move({ client: { x: 20, y: 80 }, shift: true });
    engine.setShift(false);
    engine.up({ client: { x: 30, y: 0 }, shift: false });

    const [stroke] = committed;
    if (stroke?.tool !== 'pen') throw new Error('expected a pen op');
    expect(stroke.points).toContainEqual({ x: 10, y: 40 });
    expect(stroke.points).not.toContainEqual({ x: 20, y: 80 });
  });

  test('a page scrolled under a held shape stretches it to the pointer', () => {
    const { engine, committed, scroll } = setup({ tool: 'rectangle' });
    engine.down({ client: { x: 0, y: 0 }, shift: false });
    scroll.y = 300;
    engine.up({ client: { x: 50, y: 50 }, shift: false });
    expect(committed[0]).toMatchObject({ startY: 0, endY: 350 });
  });

  test('the tool at press owns the stroke, whatever a key does mid-drag', () => {
    let tool: Tool = 'rectangle';
    const { ctx } = fakeContext();
    const committed: DrawOp[] = [];
    const engine = createStrokeEngine({
      // @ts-expect-error a recording stand-in: the engine only touches what is stubbed above
      context: () => ctx,
      toDoc: (p) => p,
      offset: () => ({ x: 0, y: 0 }),
      tool: () => tool,
      color: () => '#000000',
      lineWidth: () => 2,
      commit: (op) => committed.push(op),
    });
    engine.down({ client: { x: 0, y: 0 }, shift: false });
    tool = 'pen';
    engine.up({ client: { x: 9, y: 9 }, shift: false });
    expect(committed[0]?.tool).toBe('rectangle');
  });

  test('every preview starts from the snapshot, so a drag does not pile up', () => {
    const { engine, calls } = setup({ tool: 'rectangle' });
    engine.down({ client: { x: 0, y: 0 }, shift: false });
    engine.move({ client: { x: 5, y: 5 }, shift: false });
    engine.move({ client: { x: 6, y: 6 }, shift: false });
    expect(calls).toEqual(['snapshot', 'restore', 'strokeRect', 'restore', 'strokeRect']);
  });

  test('release flips drawing off and commits in one batch', () => {
    const { engine } = setup({ tool: 'rectangle' });
    engine.down({ client: { x: 0, y: 0 }, shift: false });
    const seen: boolean[] = [];
    const stop = effect(() => {
      seen.push(isDrawingActive.value);
    });
    engine.up({ client: { x: 9, y: 9 }, shift: false });
    stop();
    expect(seen).toEqual([true, false]);
  });

  test('the eraser reaches DOM ops at the shared radius and is told when the stroke ends', () => {
    const log: string[] = [];
    const eraser: EraserHooks = {
      begin: () => log.push('begin'),
      at: ({ at, radius }) => log.push(`${at.x}@${radius}`),
      end: () => log.push('end'),
    };
    const { engine } = setup({ tool: 'eraser', eraser });
    drag(engine, [
      { x: 0, y: 0 },
      { x: 7, y: 0 },
      { x: 8, y: 0 },
    ]);
    // eraserDiameter(4) = 15, so 7.5 either side of the path.
    expect(log).toEqual(['begin', '7@7.5', 'end']);
  });
});
