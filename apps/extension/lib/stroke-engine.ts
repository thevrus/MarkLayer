import { batch } from '@preact/signals';
import { nanoid } from 'nanoid';
import {
  constrainEnd,
  eraserDiameter,
  eraserWidth,
  hexToRgba,
  renderOp,
  shapeOp,
  simplify,
  strokeArrowHead,
} from './renderer';
import { isDrawingActive } from './tool-state';
import { FREEHAND, SHAPES } from './tools';
import type { DrawOp, FreehandOp, Point, Tool } from './types';

type Viewport = { width: number; height: number };
type StrokeTool = FreehandOp['tool'] | 'rectangle' | 'circle' | 'line' | 'arrow';

const HIGHLIGHT_ALPHA = 0.4;
const SIMPLIFY_TOLERANCE = 1.5;

const strokeWidth = ({ tool, lineWidth }: { tool: Tool; lineWidth: number }) => {
  if (tool === 'eraser') return eraserWidth(lineWidth);
  return tool === 'highlight' ? Math.max(8, lineWidth * 2) : lineWidth;
};

export function applyToolStyle(
  ctx: CanvasRenderingContext2D,
  { tool, color, lineWidth }: { tool: Tool; color: string; lineWidth: number },
) {
  ctx.lineCap = ctx.lineJoin = 'round';
  ctx.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';
  ctx.lineWidth = strokeWidth({ tool, lineWidth });
  if (tool === 'eraser') {
    ctx.strokeStyle = 'black';
    return;
  }
  ctx.strokeStyle = ctx.fillStyle = tool === 'highlight' ? hexToRgba(color, HIGHLIGHT_ALPHA) : color;
}

/** Hit-testing for what the eraser takes out besides canvas pixels. */
export interface EraserHooks {
  begin: () => void;
  at: (hit: { at: Point; radius: number }) => void;
  end: () => void;
}

export interface StrokeEngineConfig {
  context: () => CanvasRenderingContext2D | null;
  /** Reads the current scroll, so a page scrolled mid-stroke keeps the pen under the pointer. */
  toDoc: (client: Point) => Point;
  /** Where document space sits on the canvas: subtracted from every doc coordinate to paint it. */
  offset: () => Point;
  tool: () => Tool;
  color: () => string;
  lineWidth: () => number;
  commit: (op: DrawOp) => void;
  captureViewport?: () => Viewport;
  eraser?: EraserHooks;
}

interface Stroke {
  tool: StrokeTool;
  start: Point;
  client: Point;
  shift: boolean;
  snapshot: ImageData;
  /** Null for shapes, which keep no points. */
  path: FreehandOp | null;
  viewport: Viewport | undefined;
}

export interface StrokeEngine {
  readonly drawing: boolean;
  /** True when this press started a stroke, which is the caller's cue to swallow it. */
  down: (input: { client: Point; shift: boolean }) => boolean;
  move: (input: { client: Point; shift: boolean }) => void;
  up: (input: { client: Point; shift: boolean }) => void;
  setShift: (held: boolean) => void;
  preview: () => void;
  /** After the caller repaints mid-stroke: the scrolled marks become the new background. */
  resnapshot: () => void;
}

/**
 * The input state machine every drawing surface shares, in document space: press,
 * Shift-constrain, preview over a snapshot, and one op on release. Surfaces differ only
 * in the coordinate mapping they pass in.
 */
export function createStrokeEngine(config: StrokeEngineConfig): StrokeEngine {
  const { context, toDoc, offset, tool, color, lineWidth, commit, captureViewport, eraser } = config;
  let stroke: Stroke | null = null;

  const style = (ctx: CanvasRenderingContext2D, t: Tool) =>
    applyToolStyle(ctx, { tool: t, color: color(), lineWidth: lineWidth() });

  const endOf = (s: Stroke): Point => {
    const raw = toDoc(s.client);
    return s.shift ? constrainEnd(s.tool, s.start.x, s.start.y, raw.x, raw.y) : raw;
  };

  const paintShape = ({ ctx, s, off }: { ctx: CanvasRenderingContext2D; s: Stroke; off: Point }) => {
    const end = endOf(s);
    const from = { x: s.start.x - off.x, y: s.start.y - off.y };
    const to = { x: end.x - off.x, y: end.y - off.y };
    style(ctx, s.tool);
    ctx.beginPath();
    if (s.tool === 'rectangle') {
      ctx.strokeRect(from.x, from.y, to.x - from.x, to.y - from.y);
    } else if (s.tool === 'circle') {
      ctx.arc(from.x, from.y, Math.hypot(to.x - from.x, to.y - from.y), 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
      if (s.tool === 'arrow') strokeArrowHead(ctx, { start: from, end: to, lineWidth: ctx.lineWidth });
    }
  };

  const preview = () => {
    const ctx = context();
    if (!stroke || !ctx) return;
    ctx.putImageData(stroke.snapshot, 0, 0);
    const off = offset();
    const { path } = stroke;
    if (!path) {
      paintShape({ ctx, s: stroke, off });
      return;
    }
    // Points stay put while Shift is held, so releasing it resumes from the cursor.
    const first = path.points[0];
    if (stroke.shift && first) renderOp(ctx, { ...path, points: [first, endOf(stroke)] }, off.x, off.y);
    else if (path.points.length > 1) renderOp(ctx, path, off.x, off.y);
  };

  const finish = ({ s, end }: { s: Stroke; end: Point }): DrawOp | null => {
    if (s.path) {
      const first = s.path.points[0];
      const points = s.shift && first ? [first, end] : [...s.path.points, end];
      if (points.length < 2) return null;
      // Simplifying a destination-out mask costs pinpoint accuracy at its edges.
      return { ...s.path, points: s.path.tool === 'eraser' ? points : simplify(points, SIMPLIFY_TOLERANCE) };
    }
    if (!SHAPES.has(s.tool)) return null;
    return shapeOp({
      tool: s.tool,
      start: s.start,
      end,
      base: {
        id: nanoid(),
        color: color(),
        lineWidth: lineWidth(),
        ...(s.viewport && { captureViewport: s.viewport }),
      },
    });
  };

  return {
    get drawing() {
      return stroke !== null;
    },

    down({ client, shift }) {
      const t = tool();
      if (!FREEHAND.has(t) && !SHAPES.has(t)) return false;
      const ctx = context();
      if (!ctx) return false;
      isDrawingActive.value = true;
      style(ctx, t);
      const start = toDoc(client);
      const viewport = captureViewport?.();
      const snapshot = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
      const path: FreehandOp | null = FREEHAND.has(t)
        ? {
            id: nanoid(),
            tool: t,
            points: [start],
            color: t === 'highlight' ? hexToRgba(color(), HIGHLIGHT_ALPHA) : color(),
            lineWidth: strokeWidth({ tool: t, lineWidth: lineWidth() }),
            compositeOperation: t === 'eraser' ? 'destination-out' : 'source-over',
            ...(viewport && { captureViewport: viewport }),
          }
        : null;
      stroke = { tool: t, start, client, shift, snapshot, path, viewport };
      if (t === 'eraser') eraser?.begin();
      return true;
    },

    move({ client, shift }) {
      if (!stroke) return;
      stroke.client = client;
      stroke.shift = shift;
      const at = toDoc(client);
      if (stroke.tool === 'eraser') eraser?.at({ at, radius: eraserDiameter(lineWidth()) / 2 });
      if (stroke.path && !shift) stroke.path.points.push(at);
      preview();
    },

    up({ client, shift }) {
      const s = stroke;
      if (!s) return;
      stroke = null;
      s.client = client;
      s.shift = shift;
      const end = endOf(s);
      if (s.tool === 'eraser') eraser?.end();
      const ctx = context();
      ctx?.putImageData(s.snapshot, 0, 0);
      // One batch, so the redraw fires once with the new op present rather than
      // twice, the first time from a stale list.
      batch(() => {
        isDrawingActive.value = false;
        const op = finish({ s, end });
        if (op) commit(op);
      });
      ctx?.beginPath();
    },

    setShift(held) {
      if (!stroke || stroke.shift === held) return;
      stroke.shift = held;
      preview();
    },

    preview,

    resnapshot() {
      const ctx = context();
      if (!stroke || !ctx) return;
      stroke.snapshot = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
      preview();
    },
  };
}
