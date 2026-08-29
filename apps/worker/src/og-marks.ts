import { arrowHeadBarbs, type DrawOp, drawOpSchema, type Point } from '@marklayer/types';

/**
 * The annotation geometry reduced to what a static OG card can paint. Ops arrive
 * as untrusted stored JSON, so every value that reaches an SVG attribute is
 * re-derived here (colors are reparsed into `#rrggbb`, coordinates are checked
 * finite) rather than interpolated through — the card is rendered from user data
 * and an attribute break-out would be an injection.
 */
type Mark =
  | { kind: 'stroke'; points: Point[]; color: string; width: number; round: boolean }
  | { kind: 'rect'; x: number; y: number; w: number; h: number; color: string; width: number; fill: number }
  | { kind: 'circle'; cx: number; cy: number; r: number; color: string; width: number }
  | { kind: 'pin'; x: number; y: number; color: string; label: string };

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Which line of the card's stat row an op counts toward. Exhaustive over the op
 * union on purpose: a tool added to `drawOpSchema` is a type error here rather
 * than an annotation that silently counts as nothing. `eraser` and `guide` are
 * `none` because neither is a thing someone said about the page.
 */
const TOOL_TALLY: Record<DrawOp['tool'], 'comments' | 'drawings' | 'notes' | 'none'> = {
  comment: 'comments',
  pen: 'drawings',
  highlight: 'drawings',
  rectangle: 'drawings',
  line: 'drawings',
  circle: 'drawings',
  text: 'notes',
  area: 'notes',
  selection: 'notes',
  inspect: 'notes',
  eraser: 'none',
  guide: 'none',
};

const isTallyTool = (t: string): t is DrawOp['tool'] => t in TOOL_TALLY;

/** Comment pins are screen-space in the app; they keep a fixed radius here too. */
const PIN_RADIUS = 15;
/** A lone small doodle still has to read at card size; a huge one must not blur. */
const MIN_SCALE = 0.02;
const MAX_SCALE = 2.2;
const MIN_STROKE = 1.8;
const MAX_STROKE = 16;
/** Long freehand ops carry thousands of points; a 1200px card cannot show them. */
const MAX_POINTS = 240;
/** Below this share of the window, the card crops in rather than show a bare page. */
const MIN_COVERAGE = 0.66;
const MAX_ZOOM = 2.6;

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const RGB = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*([\d.]+)\s*)?\)$/i;
const INK = { r: 0xed, g: 0xed, b: 0xed, a: 1 };

function channel(hex: string): number {
  return Number.parseInt(hex.length === 1 ? hex + hex : hex, 16);
}

function parseColor(raw: string): { r: number; g: number; b: number; a: number } | null {
  const value = raw.trim();
  const hex = HEX.exec(value);
  if (hex) {
    const body = hex[1];
    const step = body.length === 3 ? 1 : 2;
    return {
      r: channel(body.slice(0, step)),
      g: channel(body.slice(step, step * 2)),
      b: channel(body.slice(step * 2, step * 3)),
      a: 1,
    };
  }
  const rgb = RGB.exec(value);
  if (!rgb) return null;
  const [r, g, b] = [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  if (r > 255 || g > 255 || b > 255) return null;
  const a = rgb[4] === undefined ? 1 : Math.min(1, Math.max(0, Number(rgb[4])));
  return { r, g, b, a };
}

/**
 * How a translucent mark actually looks to the person who drew it: highlighter
 * strokes carry their alpha in `op.color`, and selection bands multiply, both
 * over a white page. Compositing them onto this black panel instead turns a
 * yellow highlight olive, so they are drawn opaque in their over-white color.
 */
function overWhite(raw: string, alpha?: number): string {
  const c = parseColor(raw) ?? INK;
  const t = 1 - (alpha ?? c.a);
  return `#${hex2(c.r + (255 - c.r) * t)}${hex2(c.g + (255 - c.g) * t)}${hex2(c.b + (255 - c.b) * t)}`;
}

function hex2(n: number): string {
  return Math.round(Math.min(255, Math.max(0, n)))
    .toString(16)
    .padStart(2, '0');
}

/**
 * The card's ground is black, so an annotation drawn in near-black would vanish.
 *
 * The test is the brightest channel, not relative luminance: a saturated red is
 * dark by luminance and perfectly visible here, and lifting it would wash out a
 * color the person deliberately chose. A color that fails is scaled up on all
 * three channels rather than mixed toward grey, which raises it to the floor
 * with its hue and saturation intact — a near-black navy comes back as navy, not
 * as blue-grey. True black has no ratio to scale, so it lands on the neutral.
 *
 * Also the sanitizing step: the return is always `#rrggbb`.
 */
export function liftColor(raw: string): string {
  const c = parseColor(raw) ?? INK;
  const brightest = Math.max(c.r, c.g, c.b);
  const floor = 0.42 * 255;
  if (brightest >= floor) return `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`;
  if (brightest === 0) return `#${hex2(INK.r)}${hex2(INK.g)}${hex2(INK.b)}`;
  const gain = floor / brightest;
  return `#${hex2(c.r * gain)}${hex2(c.g * gain)}${hex2(c.b * gain)}`;
}

function finite(...values: number[]): boolean {
  return values.every((v) => Number.isFinite(v));
}

function decimate(points: Point[]): Point[] {
  const clean = points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (clean.length <= MAX_POINTS) return clean;
  const stride = Math.ceil(clean.length / MAX_POINTS);
  const out = clean.filter((_, i) => i % stride === 0);
  const last = clean[clean.length - 1];
  if (last && out[out.length - 1] !== last) out.push(last);
  return out;
}

function boxOf({ ax, ay, bx, by }: { ax: number; ay: number; bx: number; by: number }): Rect {
  return { x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(bx - ax), h: Math.abs(by - ay) };
}

/**
 * Ops that carry no paintable geometry (`text` has no measurable box here,
 * `guide` spans the whole viewport, `eraser` removes rather than draws) are
 * counted for the stat line but never painted.
 */
function toMarks(op: DrawOp): Mark[] {
  const color = liftColor(op.color);
  const width = Number.isFinite(op.lineWidth) ? op.lineWidth : 3;
  switch (op.tool) {
    case 'pen':
    case 'highlight': {
      const points = decimate(op.points);
      if (points.length < 2) return [];
      const highlight = op.tool === 'highlight';
      return [{ kind: 'stroke', points, color: highlight ? overWhite(op.color) : color, width, round: !highlight }];
    }
    case 'rectangle': {
      if (!finite(op.startX, op.startY, op.endX, op.endY)) return [];
      const b = boxOf({ ax: op.startX, ay: op.startY, bx: op.endX, by: op.endY });
      return [{ kind: 'rect', ...b, color, width, fill: 0 }];
    }
    case 'line': {
      if (!finite(op.startX, op.startY, op.endX, op.endY)) return [];
      const shaft: Mark = {
        kind: 'stroke',
        points: [
          { x: op.startX, y: op.startY },
          { x: op.endX, y: op.endY },
        ],
        color,
        width,
        round: true,
      };
      if (!op.arrow) return [shaft];
      // A polyline through the tip: barb, tip, barb — one stroke rather than two.
      const start = { x: op.startX, y: op.startY };
      const end = { x: op.endX, y: op.endY };
      const [a, b] = arrowHeadBarbs({ start, end, lineWidth: width });
      return [shaft, { kind: 'stroke', points: [a, end, b], color, width, round: true }];
    }
    case 'circle': {
      if (!finite(op.centerX, op.centerY, op.radius) || op.radius <= 0) return [];
      return [{ kind: 'circle', cx: op.centerX, cy: op.centerY, r: op.radius, color, width }];
    }
    case 'comment': {
      if (op.parentId || !finite(op.x, op.y)) return [];
      const n = Math.round(op.num);
      return [{ kind: 'pin', x: op.x, y: op.y, color, label: n > 0 && n < 1000 ? String(n) : '' }];
    }
    case 'area': {
      if (!finite(op.startX, op.startY, op.endX, op.endY)) return [];
      const b = boxOf({ ax: op.startX, ay: op.startY, bx: op.endX, by: op.endY });
      return [{ kind: 'rect', ...b, color, width: 2, fill: 0.12 }];
    }
    case 'inspect': {
      const { x, y, width: w, height: h } = op.rect;
      if (!finite(x, y, w, h)) return [];
      return [{ kind: 'rect', x, y, w, h, color, width: 2, fill: 0.08 }];
    }
    case 'selection':
      return op.rects
        .filter((r) => finite(r.x, r.y, r.width, r.height))
        .map((r) => ({
          kind: 'rect',
          x: r.x,
          y: r.y,
          w: r.width,
          h: r.height,
          color: overWhite(op.color, 0.25),
          width: 0,
          fill: 1,
        }));
    default:
      return [];
  }
}

export interface OpTally {
  comments: number;
  drawings: number;
  notes: number;
}

interface Collected {
  marks: Mark[];
  tally: OpTally;
  /**
   * Width of the viewport the annotations were drawn on, when the ops recorded
   * one. It is what lets the card place a mark where it actually sat on the
   * page instead of floating it in a void.
   */
  viewportWidth: number | null;
}

/**
 * Parse stored ops into paintable marks and a tally. Ops that fail the schema
 * (rows written before a field existed) still count toward the tally off their
 * tool name — a legacy annotation gets a plainer card, never an empty one.
 */
export function collectMarks(stored: unknown[]): Collected {
  const marks: Mark[] = [];
  const tally: OpTally = { comments: 0, drawings: 0, notes: 0 };
  let viewportWidth: number | null = null;
  for (const raw of stored) {
    const parsed = drawOpSchema.safeParse(raw);
    const tool = parsed.success
      ? parsed.data.tool
      : raw && typeof raw === 'object' && 'tool' in raw && typeof raw.tool === 'string'
        ? raw.tool
        : null;
    const isReply = !!raw && typeof raw === 'object' && 'parentId' in raw && !!raw.parentId;
    const bucket = tool && isTallyTool(tool) ? TOOL_TALLY[tool] : 'none';
    if (bucket === 'comments') {
      if (!isReply) tally.comments++;
    } else if (bucket !== 'none') tally[bucket]++;
    if (!parsed.success) continue;
    marks.push(...toMarks(parsed.data));
    const width = parsed.data.captureViewport?.width;
    // The widest capture wins: a page annotated at two sizes reads correctly at
    // the larger one, where the narrower session's marks still land in bounds.
    if (width && Number.isFinite(width) && width > (viewportWidth ?? 0)) viewportWidth = width;
  }
  return { marks, tally, viewportWidth };
}

function markBounds(marks: Mark[]): Rect | null {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  const grow = (x: number, y: number) => {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  };
  for (const m of marks) {
    if (m.kind === 'stroke') for (const p of m.points) grow(p.x, p.y);
    else if (m.kind === 'rect') {
      grow(m.x, m.y);
      grow(m.x + m.w, m.y + m.h);
    } else if (m.kind === 'circle') {
      grow(m.cx - m.r, m.cy - m.r);
      grow(m.cx + m.r, m.cy + m.r);
    } else grow(m.x, m.y);
  }
  if (!finite(x0, y0, x1, y1)) return null;
  return { x: x0, y: y0, w: Math.max(x1 - x0, 1), h: Math.max(y1 - y0, 1) };
}

function clamp({ value, min, max }: { value: number; min: number; max: number }): number {
  return Math.min(max, Math.max(min, value));
}

function n(value: number): string {
  return (Math.round(value * 10) / 10).toString();
}

export interface Placement {
  /** Where the annotated page's left edge lands on the card, and how wide it is drawn. */
  page: { x: number; width: number };
  /** The part of that page the card actually shows — sets the crop. */
  visible: Rect;
  /** Width of the viewport the ops were drawn on, when they recorded one. */
  viewportWidth: number | null;
}

/**
 * Draw the marks where they sat on the page rather than packed into a box.
 *
 * The page is laid across `page.width` at the capture viewport's scale, then
 * panned so the annotations sit in the middle of what the card shows — the same
 * crop a person would pick. Two clamps keep it honest: the pan never reveals
 * ground outside the page horizontally, and never scrolls above the page's own
 * top. When the annotations are too tall to sit in the window at page scale the
 * card zooms out to hold them all, so nothing is ever half-cut.
 *
 * Pins keep a constant radius because they are screen-space in the product, so
 * the inset that keeps marks clear of the panel edge is bigger than a pin.
 */
export function renderMarks({ marks, page, visible, viewportWidth }: { marks: Mark[] } & Placement): string {
  const bounds = markBounds(marks);
  if (!bounds) return '';
  const inset = PIN_RADIUS + 9;
  // Ops recorded before capture viewports existed: assume a page at least wide
  // enough to hold everything drawn on it.
  const pageWidth = viewportWidth ?? Math.max(1024, bounds.x + bounds.w + 80);
  const pageScale = page.width / pageWidth;
  const fitScale = Math.min((visible.w - inset * 2) / bounds.w, (visible.h - inset * 2) / bounds.h);
  // Two comments in a corner of a 1440px page would sit true to scale and read
  // as an empty panel. When the annotations cover too little of the window the
  // card crops in on them, the way a person framing the screenshot would.
  const coverage = Math.max((bounds.w * pageScale) / visible.w, (bounds.h * pageScale) / visible.h);
  const zoom = coverage > 0 && coverage < MIN_COVERAGE ? Math.min(MIN_COVERAGE / coverage, MAX_ZOOM) : 1;
  const scale = clamp({ value: Math.min(pageScale * zoom, fitScale), min: MIN_SCALE, max: MAX_SCALE });

  const centered = (start: number, size: number, min: number, extent: number) =>
    start + (size - extent * scale) / 2 - min * scale;
  let ox = centered(visible.x, visible.w, bounds.x, bounds.w);
  let oy = centered(visible.y, visible.h, bounds.y, bounds.h);
  if (scale === pageScale) {
    // Panning is only allowed within the page: its left edge may not slide right
    // of the window, nor its right edge left of it.
    ox = clamp({ value: ox, min: visible.x + visible.w - page.width, max: page.x });
    // A page has no bottom, so only the top is held.
    oy = Math.min(oy, visible.y);
  }

  const X = (v: number) => n(ox + v * scale);
  const Y = (v: number) => n(oy + v * scale);
  const S = (v: number) => n(clamp({ value: v * scale, min: MIN_STROKE, max: MAX_STROKE }));

  const out: string[] = [];
  for (const m of marks) {
    if (m.kind === 'stroke') {
      const d = m.points.map((p, i) => `${i === 0 ? 'M' : 'L'}${X(p.x)} ${Y(p.y)}`).join(' ');
      const cap = m.round ? 'round' : 'butt';
      out.push(
        `<path d="${d}" fill="none" stroke="${m.color}" stroke-width="${S(m.width)}" stroke-linecap="${cap}" stroke-linejoin="round"/>`,
      );
    } else if (m.kind === 'rect') {
      const fill = m.fill > 0 ? `fill="${m.color}" fill-opacity="${m.fill}"` : 'fill="none"';
      const stroke = m.width > 0 ? ` stroke="${m.color}" stroke-width="${S(m.width)}"` : '';
      out.push(
        `<rect x="${X(m.x)}" y="${Y(m.y)}" width="${n(m.w * scale)}" height="${n(m.h * scale)}" rx="3" ${fill}${stroke}/>`,
      );
    } else if (m.kind === 'circle') {
      out.push(
        `<circle cx="${X(m.cx)}" cy="${Y(m.cy)}" r="${n(m.r * scale)}" fill="none" stroke="${m.color}" stroke-width="${S(m.width)}"/>`,
      );
    } else {
      // The product's pin: a filled disc with the thread number in white. The
      // baseline sits 0.36em below the center — Geist's cap height halved, so
      // the numeral is optically centered rather than hung off the box.
      const [cx, cy] = [ox + m.x * scale, oy + m.y * scale];
      out.push(`<circle cx="${n(cx)}" cy="${n(cy)}" r="${PIN_RADIUS}" fill="${m.color}"/>`);
      if (m.label)
        out.push(
          `<text x="${n(cx)}" y="${n(cy + 16 * 0.36)}" text-anchor="middle" font-family="Geist" font-size="16" font-weight="500" fill="#ffffff">${m.label}</text>`,
        );
    }
  }
  return out.join('\n      ');
}
