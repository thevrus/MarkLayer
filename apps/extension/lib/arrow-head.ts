import type { Point } from '@marklayer/types/ops';

/**
 * How far an arrow head reaches back from the tip, at the width the shaft is
 * stroked at. Also the padding a culling box needs, since the head extends past
 * the endpoint at any angle.
 */
export const arrowHeadLength = (lineWidth: number) => Math.max(10, lineWidth * 4);

/** The two barbs of an arrow head: the live canvas preview and the committed render draw the same arrow. */
export function arrowHeadBarbs({
  start,
  end,
  lineWidth,
}: {
  start: Point;
  end: Point;
  lineWidth: number;
}): [Point, Point] {
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  const len = arrowHeadLength(lineWidth);
  const barb = (offset: number): Point => ({
    x: end.x - len * Math.cos(angle + offset),
    y: end.y - len * Math.sin(angle + offset),
  });
  return [barb(-Math.PI / 6), barb(Math.PI / 6)];
}
