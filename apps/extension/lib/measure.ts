export interface RectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface DistanceOverlay {
  horizontal: { x1: number; x2: number; y: number; value: number } | null;
  vertical: { y1: number; y2: number; x: number; value: number } | null;
  connectors: { x1: number; y1: number; x2: number; y2: number }[];
}

export interface ContainerLines {
  top: { x: number; y1: number; y2: number; value: number };
  bottom: { x: number; y1: number; y2: number; value: number };
  left: { y: number; x1: number; x2: number; value: number };
  right: { y: number; x1: number; x2: number; value: number };
}

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

/**
 * Build the Figma-style distance overlay between two rects:
 * a horizontal/vertical pair of measurement lines (only on axes that don't
 * overlap), plus dashed connectors extending B's edges to meet the lines.
 */
export function getDistanceOverlay(a: RectLike, b: RectLike): DistanceOverlay {
  const aRight = a.left + a.width;
  const aBottom = a.top + a.height;
  const bRight = b.left + b.width;
  const bBottom = b.top + b.height;
  const aCenterX = a.left + a.width / 2;
  const aCenterY = a.top + a.height / 2;

  const separatedX = aRight <= b.left || bRight <= a.left;
  const separatedY = aBottom <= b.top || bBottom <= a.top;

  let horizontal: DistanceOverlay['horizontal'] = null;
  let vertical: DistanceOverlay['vertical'] = null;
  const connectors: DistanceOverlay['connectors'] = [];

  if (separatedX) {
    const aIsLeft = aRight <= b.left;
    const x1 = aIsLeft ? aRight : bRight;
    const x2 = aIsLeft ? b.left : a.left;
    const y = aCenterY;
    horizontal = { x1, x2, y, value: Math.abs(x2 - x1) };

    const edgeBX = aIsLeft ? b.left : bRight;
    if (y < b.top) connectors.push({ x1: edgeBX, y1: y, x2: edgeBX, y2: b.top });
    else if (y > bBottom) connectors.push({ x1: edgeBX, y1: y, x2: edgeBX, y2: bBottom });
  }

  if (separatedY) {
    const aIsTop = aBottom <= b.top;
    const y1 = aIsTop ? aBottom : bBottom;
    const y2 = aIsTop ? b.top : a.top;
    const x = aCenterX;
    vertical = { y1, y2, x, value: Math.abs(y2 - y1) };

    const edgeBY = aIsTop ? b.top : bBottom;
    if (x < b.left) connectors.push({ x1: x, y1: edgeBY, x2: b.left, y2: edgeBY });
    else if (x > bRight) connectors.push({ x1: x, y1: edgeBY, x2: bRight, y2: edgeBY });
  }

  const cleaned = connectors.filter((seg) => Math.abs(seg.x1 - seg.x2) > 0.5 || Math.abs(seg.y1 - seg.y2) > 0.5);

  return { horizontal, vertical, connectors: cleaned };
}

/**
 * Four dashed gap lines from a rect to its container's edges. Used when
 * Alt is held with no hover target (Figma-style: "where is this inside its
 * parent?"). `container` defaults to the viewport.
 */
export function getContainerLines(rect: RectLike, container: RectLike): ContainerLines {
  const right = rect.left + rect.width;
  const bottom = rect.top + rect.height;
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const containerRight = container.left + container.width;
  const containerBottom = container.top + container.height;

  const lineX = clamp(centerX, container.left, containerRight);
  const lineY = clamp(centerY, container.top, containerBottom);

  return {
    top: { x: lineX, y1: container.top, y2: rect.top, value: Math.max(0, rect.top - container.top) },
    bottom: { x: lineX, y1: bottom, y2: containerBottom, value: Math.max(0, containerBottom - bottom) },
    left: { y: lineY, x1: container.left, x2: rect.left, value: Math.max(0, rect.left - container.left) },
    right: { y: lineY, x1: right, x2: containerRight, value: Math.max(0, containerRight - right) },
  };
}

type Orientation = 'horizontal' | 'vertical';
interface GuideLike {
  id: string;
  orientation: Orientation;
  position: number;
}

/** Pixel distance from a point to a guide line in the same axis. */
export function guideDistance(orientation: Orientation, position: number, point: { x: number; y: number }) {
  return orientation === 'vertical' ? Math.abs(point.x - position) : Math.abs(point.y - position);
}

/** Returns the closest guide within `snapPx` of the cursor, or null. */
export function pickGuideAtPoint(point: { x: number; y: number }, guides: GuideLike[], snapPx = 6) {
  let best: GuideLike | null = null;
  let bestDist = snapPx + 1;
  for (const g of guides) {
    const d = guideDistance(g.orientation, g.position, point);
    if (d <= snapPx && d < bestDist) {
      best = g;
      bestDist = d;
    }
  }
  return best;
}

/** Direction for Tab / arrow traversal on the focused anchor. */
export type TraverseDir = 'parent' | 'child' | 'next' | 'prev';

/**
 * Walk to a neighboring element for keyboard traversal. Skips through the
 * caller's `isHostFn` (so we don't land on the extension UI). Returns null
 * when no valid neighbor exists.
 */
export function nextAnchorElement(
  current: Element,
  dir: TraverseDir,
  isHostElement: (el: Element) => boolean,
): Element | null {
  const isSkippable = (el: Element): boolean =>
    el === document.body || el === document.documentElement || isHostElement(el);

  if (dir === 'parent') {
    let p = current.parentElement;
    while (p && isSkippable(p)) p = p.parentElement;
    return p;
  }
  if (dir === 'child') {
    let c = current.firstElementChild;
    while (c && isSkippable(c)) c = c.nextElementSibling;
    return c;
  }
  if (dir === 'next') {
    let s = current.nextElementSibling;
    while (s && isSkippable(s)) s = s.nextElementSibling;
    return s;
  }
  let s = current.previousElementSibling;
  while (s && isSkippable(s)) s = s.previousElementSibling;
  return s;
}
