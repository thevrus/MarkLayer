import { FREEHAND } from './state';
import type { DrawOp, Point } from './types';

export function hexToRgba(hex: string, a = 1) {
  const n = parseInt(hex.slice(1), 16);
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

function opBounds(op: DrawOp) {
  const pad = (op.lineWidth ?? 2) / 2;
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
    case 'line':
      return {
        x: Math.min(op.startX, op.endX) - pad,
        y: Math.min(op.startY, op.endY) - pad,
        w: Math.abs(op.endX - op.startX) + pad * 2,
        h: Math.abs(op.endY - op.startY) + pad * 2,
      };
    case 'circle':
      return {
        x: op.centerX - op.radius - pad,
        y: op.centerY - op.radius - pad,
        w: (op.radius + pad) * 2,
        h: (op.radius + pad) * 2,
      };
    case 'comment':
    case 'selection':
      return null; // rendered as DOM
    default:
      return null;
  }
}

function inView(b: ReturnType<typeof opBounds>, vx: number, vy: number, vw: number, vh: number) {
  return !b || (b.x + b.w > vx && b.x < vx + vw && b.y + b.h > vy && b.y < vy + vh);
}

export function renderOp(c: CanvasRenderingContext2D, op: DrawOp, ox: number, oy: number) {
  if (op.tool === 'comment' || op.tool === 'selection') return;
  if (op.tool === 'text') {
    c.save();
    c.font = `${op.fontSize}px -apple-system, BlinkMacSystemFont, "SF Pro Display", "Inter", system-ui, sans-serif`;
    c.fillStyle = op.color;
    c.textBaseline = 'top';
    c.fillText(op.text, op.x - ox, op.y - oy);
    c.restore();
    return;
  }
  c.save();
  Object.assign(c, {
    strokeStyle: op.color,
    fillStyle: op.color,
    lineWidth: op.lineWidth,
    lineCap: 'round',
    lineJoin: 'round',
    globalCompositeOperation: ('compositeOperation' in op ? op.compositeOperation : undefined) ?? 'source-over',
  });
  c.beginPath();
  if (FREEHAND.has(op.tool)) {
    const pts = 'points' in op ? (op.points as Point[]) : [];
    if (pts?.length) {
      c.moveTo(pts[0].x - ox, pts[0].y - oy);
      if (pts.length === 2) {
        c.lineTo(pts[1].x - ox, pts[1].y - oy);
      } else {
        for (let i = 1; i < pts.length - 1; i++) {
          c.quadraticCurveTo(
            pts[i].x - ox,
            pts[i].y - oy,
            (pts[i].x + pts[i + 1].x) / 2 - ox,
            (pts[i].y + pts[i + 1].y) / 2 - oy,
          );
        }
        c.lineTo(pts[pts.length - 1].x - ox, pts[pts.length - 1].y - oy);
      }
      c.stroke();
    }
  } else {
    switch (op.tool) {
      case 'rectangle':
        c.strokeRect(op.startX - ox, op.startY - oy, op.endX - op.startX, op.endY - op.startY);
        break;
      case 'line': {
        const ax = op.startX - ox,
          ay = op.startY - oy;
        const bx = op.endX - ox,
          by = op.endY - oy;
        c.moveTo(ax, ay);
        c.lineTo(bx, by);
        c.stroke();
        if (op.arrow) {
          const angle = Math.atan2(by - ay, bx - ax);
          const headLen = Math.max(10, op.lineWidth * 4);
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
        c.arc(op.centerX - ox, op.centerY - oy, op.radius, 0, Math.PI * 2);
        c.stroke();
        break;
    }
  }
  c.restore();
}

export function redrawCanvas(canvas: HTMLCanvasElement, ops: DrawOp[]) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const [vx, vy, vw, vh] = [scrollX, scrollY, canvas.width, canvas.height];
  for (const op of ops) {
    if (inView(opBounds(op), vx, vy, vw, vh)) renderOp(ctx, op, vx, vy);
  }
}
