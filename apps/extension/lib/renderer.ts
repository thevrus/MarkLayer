import getStroke from 'perfect-freehand';
import { captureScale } from './anchor';
import { FREEHAND } from './state';
import type { DrawOp, Point, Tool } from './types';

const ANGLE_SNAP_TOOLS = new Set<Tool>(['line', 'arrow', 'pen', 'highlight', 'eraser']);

// Figma-style Shift constraint: line/arrow/freehand snap to 45° increments;
// rectangle locks to a square. Pure — callers gate on the Shift-held state.
export function constrainEnd(tool: Tool, sx: number, sy: number, cx: number, cy: number): Point {
  const dx = cx - sx;
  const dy = cy - sy;
  if (ANGLE_SNAP_TOOLS.has(tool)) {
    const dist = Math.hypot(dx, dy);
    if (dist === 0) return { x: cx, y: cy };
    const step = Math.PI / 4;
    const snapped = Math.round(Math.atan2(dy, dx) / step) * step;
    return { x: sx + Math.cos(snapped) * dist, y: sy + Math.sin(snapped) * dist };
  }
  if (tool === 'rectangle') {
    const size = Math.max(Math.abs(dx), Math.abs(dy));
    return { x: sx + (dx < 0 ? -size : size), y: sy + (dy < 0 ? -size : size) };
  }
  return { x: cx, y: cy };
}

export function hexToRgba(hex: string, a = 1) {
  // Defensive: callers should pass `#RRGGBB` or `#RGB`, but state has historically
  // accepted user-typed values. Bail to opaque-black on malformed input rather than
  // silently producing the wrong color (e.g. parseInt('abc', 16) → blue-ish).
  if (!hex.startsWith('#')) return `rgba(0,0,0,${a})`;
  let h = hex.slice(1);
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  if (h.length !== 6) return `rgba(0,0,0,${a})`;
  const n = parseInt(h, 16);
  if (Number.isNaN(n)) return `rgba(0,0,0,${a})`;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export function simplify(pts: Point[], tol = 1): Point[] {
  if (pts.length <= 2) return pts;
  const sq = tol * tol;
  const d2 = (p: Point, a: Point, b: Point) => {
    let [dx, dy] = [b.x - a.x, b.y - a.y];
    if (dx || dy) {
      const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy);
      dx = t > 1 ? p.x - b.x : t > 0 ? p.x - (a.x + t * dx) : p.x - a.x;
      dy = t > 1 ? p.y - b.y : t > 0 ? p.y - (a.y + t * dy) : p.y - a.y;
    } else {
      dx = p.x - a.x;
      dy = p.y - a.y;
    }
    return dx * dx + dy * dy;
  };
  const rec = (lo: number, hi: number, out: Point[]) => {
    let mx = 0,
      idx = 0;
    for (let i = lo + 1; i < hi; i++) {
      const d = d2(pts[i], pts[lo], pts[hi]);
      if (d > mx) {
        mx = d;
        idx = i;
      }
    }
    if (mx > sq) {
      if (idx - lo > 1) rec(lo, idx, out);
      out.push(pts[idx]);
      if (hi - idx > 1) rec(idx, hi, out);
    }
  };
  const out = [pts[0]];
  rec(0, pts.length - 1, out);
  out.push(pts[pts.length - 1]);
  return out;
}

export function opBounds(op: DrawOp) {
  const isFreehand = op.tool === 'pen' || op.tool === 'eraser' || op.tool === 'highlight';
  const pad = isFreehand ? (op.lineWidth ?? 2) * 1.5 : (op.lineWidth ?? 2) / 2;
  switch (op.tool) {
    case 'pen':
    case 'eraser':
    case 'highlight': {
      if (!op.points?.length) return null;
      let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
      for (const { x, y } of op.points) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
      return {
        x: x0 - pad,
        y: y0 - pad,
        w: x1 - x0 + pad * 2,
        h: y1 - y0 + pad * 2,
      };
    }
    case 'rectangle':
      return {
        x: Math.min(op.startX, op.endX) - pad,
        y: Math.min(op.startY, op.endY) - pad,
        w: Math.abs(op.endX - op.startX) + pad * 2,
        h: Math.abs(op.endY - op.startY) + pad * 2,
      };
    case 'line': {
      // Arrow heads extend past the endpoint at any angle (±π/6); pad on all
      // sides so culling doesn't clip the head when an arrow's tip sits near
      // a viewport edge. Mirrors `headLen` in renderOp.
      const headPad = op.arrow ? Math.max(10, (op.lineWidth ?? 2) * 4) : 0;
      const totalPad = pad + headPad;
      return {
        x: Math.min(op.startX, op.endX) - totalPad,
        y: Math.min(op.startY, op.endY) - totalPad,
        w: Math.abs(op.endX - op.startX) + totalPad * 2,
        h: Math.abs(op.endY - op.startY) + totalPad * 2,
      };
    }
    case 'circle':
      return {
        x: op.centerX - op.radius - pad,
        y: op.centerY - op.radius - pad,
        w: (op.radius + pad) * 2,
        h: (op.radius + pad) * 2,
      };
    case 'comment':
    case 'selection':
    case 'area':
    case 'inspect':
      return null; // rendered as DOM
    default:
      return null;
  }
}

export function inView(b: ReturnType<typeof opBounds>, vx: number, vy: number, vw: number, vh: number) {
  return !b || (b.x + b.w > vx && b.x < vx + vw && b.y + b.h > vy && b.y < vy + vh);
}

/**
 * Closest-point distance test between a circle (cx, cy, r) and an axis-aligned
 * rect (rx, ry, rw, rh). True when the circle overlaps or contains any part
 * of the rect. Used by the eraser tool to hit-test DOM ops (areas, selection
 * rects, inspect rects, comment pins as zero-size rects).
 */
export function circleHitsRect(cx: number, cy: number, r: number, rx: number, ry: number, rw: number, rh: number) {
  const nx = Math.max(rx, Math.min(cx, rx + rw));
  const ny = Math.max(ry, Math.min(cy, ry + rh));
  const dx = cx - nx;
  const dy = cy - ny;
  return dx * dx + dy * dy <= r * r;
}

/**
 * Render a single op onto the canvas.
 *
 * `ox`, `oy` are the scroll offsets (subtracted from doc coords to get
 * viewport coords). `scale` applies a uniform multiplier to every coordinate
 * + stroke width, used when the op was drawn at a different viewport width
 * than the current one — see `captureScale` in anchor.ts.
 */
export function renderOp(c: CanvasRenderingContext2D, op: DrawOp, ox: number, oy: number, scale = 1) {
  if (op.tool === 'comment' || op.tool === 'selection') return;
  const sx = (n: number) => n * scale - ox;
  const sy = (n: number) => n * scale - oy;
  if (op.tool === 'text') {
    c.save();
    c.font = `${op.fontSize * scale}px -apple-system, BlinkMacSystemFont, "SF Pro Display", "Geist", system-ui, sans-serif`;
    c.fillStyle = op.color;
    c.textBaseline = 'top';
    c.fillText(op.text, sx(op.x), sy(op.y));
    c.restore();
    return;
  }
  c.save();
  Object.assign(c, {
    strokeStyle: op.color,
    fillStyle: op.color,
    lineWidth: op.lineWidth * scale,
    lineCap: 'round',
    lineJoin: 'round',
    globalCompositeOperation: ('compositeOperation' in op ? op.compositeOperation : undefined) ?? 'source-over',
  });
  if (FREEHAND.has(op.tool) && 'points' in op) {
    const pts = op.points;
    if (pts?.length) {
      const outline = getStroke(
        pts.map((p) => [sx(p.x), sy(p.y)]),
        {
          size: op.lineWidth * 2.5 * scale,
          thinning: 0,
          smoothing: 0.5,
          streamline: 0,
        },
      );
      if (outline.length > 1) {
        c.beginPath();
        c.moveTo(outline[0][0], outline[0][1]);
        for (let i = 1; i < outline.length; i++) c.lineTo(outline[i][0], outline[i][1]);
        c.closePath();
        c.fill();
      }
    }
  } else {
    c.beginPath();
    switch (op.tool) {
      case 'rectangle': {
        // Normalize to positive width/height so a right-to-left or
        // bottom-to-top drag still produces a clean stroked rect — Canvas
        // accepts negative dimensions but some browsers' AA paths render
        // the trailing edge subtly differently with negatives.
        const rx = Math.min(op.startX, op.endX);
        const ry = Math.min(op.startY, op.endY);
        const rw = Math.abs(op.endX - op.startX);
        const rh = Math.abs(op.endY - op.startY);
        c.strokeRect(sx(rx), sy(ry), rw * scale, rh * scale);
        break;
      }
      case 'line': {
        const ax = sx(op.startX),
          ay = sy(op.startY);
        const bx = sx(op.endX),
          by = sy(op.endY);
        c.moveTo(ax, ay);
        c.lineTo(bx, by);
        c.stroke();
        if (op.arrow) {
          const angle = Math.atan2(by - ay, bx - ax);
          const headLen = Math.max(10, op.lineWidth * 4 * scale);
          c.beginPath();
          c.moveTo(bx, by);
          c.lineTo(bx - headLen * Math.cos(angle - Math.PI / 6), by - headLen * Math.sin(angle - Math.PI / 6));
          c.moveTo(bx, by);
          c.lineTo(bx - headLen * Math.cos(angle + Math.PI / 6), by - headLen * Math.sin(angle + Math.PI / 6));
          c.stroke();
        }
        break;
      }
      case 'circle':
        c.arc(sx(op.centerX), sy(op.centerY), op.radius * scale, 0, Math.PI * 2);
        c.stroke();
        break;
    }
  }
  c.restore();
}

export function redrawCanvas(canvas: HTMLCanvasElement, ops: DrawOp[]) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return;
  // Buffer is sized at devicePixelRatio (see Canvas resize) and the context
  // carries a DPR transform, so clear/cull math uses CSS px — `canvas.width`
  // would over-cull on Retina by clearing/culling against device-px extents.
  ctx.clearRect(0, 0, innerWidth, innerHeight);
  const [vx, vy, vw, vh] = [scrollX, scrollY, innerWidth, innerHeight];
  for (const op of ops) {
    const scale = captureScale(op.captureViewport);
    const bounds = opBounds(op);
    const scaledBounds =
      bounds && scale !== 1
        ? { x: bounds.x * scale, y: bounds.y * scale, w: bounds.w * scale, h: bounds.h * scale }
        : bounds;
    if (inView(scaledBounds, vx, vy, vw, vh)) renderOp(ctx, op, vx, vy, scale);
  }
}
