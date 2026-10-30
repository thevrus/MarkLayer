import { nanoid } from 'nanoid';
import type { AreaRect } from './area-rect';
import { constrainEnd, simplify } from './renderer';
import type { DrawOp, Point } from './types';

export type MarkupTool = 'pen' | 'circle' | 'rectangle' | 'arrow';

/** The marks an area note can carry; each is an ordinary canvas op, drawn by the same `renderOp`. */
export const MARKUP_TOOLS: { tool: MarkupTool; label: string; icon: string }[] = [
  { tool: 'pen', label: 'Draw', icon: 'pen' },
  { tool: 'circle', label: 'Ellipse', icon: 'circle' },
  { tool: 'rectangle', label: 'Rectangle', icon: 'rectangle' },
  { tool: 'arrow', label: 'Arrow', icon: 'arrow' },
];

export function clampToRect({ p, r }: { p: Point; r: AreaRect }): Point {
  return { x: Math.min(Math.max(p.x, r.x), r.x + r.w), y: Math.min(Math.max(p.y, r.y), r.y + r.h) };
}

/**
 * The op for one finished or in-flight drag, in document coordinates. Shift snaps like the main
 * canvas; null for a drag too small to mean anything.
 */
export function markupOp({
  tool,
  points,
  style,
  shift,
}: {
  tool: MarkupTool;
  /** Every pointer position of the drag, first to last. */
  points: Point[];
  style: { color: string; lineWidth: number };
  shift: boolean;
}): DrawOp | null {
  const start = points[0];
  const last = points[points.length - 1];
  if (!start || !last) return null;
  const end = shift ? constrainEnd(tool, start.x, start.y, last.x, last.y) : last;
  const base = { id: nanoid(), ...style };

  switch (tool) {
    case 'pen': {
      const path = shift ? [start, end] : points;
      if (path.every((p) => p.x === start.x && p.y === start.y)) return null;
      return { ...base, tool: 'pen', points: simplify(path, 1.5), compositeOperation: 'source-over' };
    }
    case 'circle': {
      const radius = Math.hypot(end.x - start.x, end.y - start.y);
      return radius > 0 ? { ...base, tool: 'circle', centerX: start.x, centerY: start.y, radius } : null;
    }
    case 'rectangle':
      return start.x !== end.x && start.y !== end.y
        ? { ...base, tool: 'rectangle', startX: start.x, startY: start.y, endX: end.x, endY: end.y }
        : null;
    case 'arrow':
      return start.x !== end.x || start.y !== end.y
        ? { ...base, tool: 'line', arrow: true, startX: start.x, startY: start.y, endX: end.x, endY: end.y }
        : null;
  }
}
