import { constrainEnd } from './renderer';

export interface AreaRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Box for an area drag: Shift locks a square, Alt mirrors the box around the press point. */
export function dragRect({
  sx,
  sy,
  px,
  py,
  shift,
  alt,
}: {
  sx: number;
  sy: number;
  px: number;
  py: number;
  shift: boolean;
  alt: boolean;
}): AreaRect {
  const { x: ex, y: ey } = shift ? constrainEnd('rectangle', sx, sy, px, py) : { x: px, y: py };
  const dx = Math.abs(ex - sx);
  const dy = Math.abs(ey - sy);
  if (alt) return { x: sx - dx, y: sy - dy, w: dx * 2, h: dy * 2 };
  return { x: Math.min(sx, ex), y: Math.min(sy, ey), w: dx, h: dy };
}
