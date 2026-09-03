import { MARK_ACCENT } from './brand';
import { OG_HEADING_ADVANCES_PACKED } from './og-fonts';
import { CARD, escapeXml, MARK_AXIS, mark, RIGHT_EDGE, SEPARATOR, SIGNATURE_MARK, TONE, TRACKING } from './og-svg';

/**
 * The heading is fitted, not stepped: the largest size at which it still holds
 * two lines wins. A short one lands near the ceiling and fills the frame, a long
 * one settles into two full lines rather than sitting small in the middle of an
 * empty card. Searched coarsely downward, which is why the step is 2px.
 */
const SIZE_MAX = 92;
const SIZE_MIN = 44;
const SIZE_STEP = 2;
const MAX_LINES = 2;
/**
 * A heading that still reads big on one line stays on one line: it spans the full
 * measure instead of breaking into a long first line and a short second one, which
 * strands a preposition at the break and empties the right half of the card. Below
 * this size a single line is too small to carry the card, and two lines win.
 */
const SINGLE_LINE_FLOOR = 64;
/** Leaves the right margin the slack the pin needs at the end of a full line. */
const HEADING_WIDTH = 1000;
const LINE_HEIGHT = 1.08;
/** Geist's caps reach roughly this far above the baseline. */
const CAP = 0.72;
/** The cap band of the heading block centers here: the midpoint between the
    mark's foot and the colophon's cap, which is what reads level. */
const OPTICAL_CENTER = 322;
const COLOPHON_BASELINE = 566;
/** Wide enough to over-measure anything outside the subset, never under-measure it. */
const FALLBACK_ADVANCE = 1100;

/** `<char><4 digits>` per entry, unpacked once. */
const ADVANCES = new Map<string, number>();
for (let i = 0; i + 5 <= OG_HEADING_ADVANCES_PACKED.length; i += 5) {
  ADVANCES.set(OG_HEADING_ADVANCES_PACKED[i] ?? '', Number(OG_HEADING_ADVANCES_PACKED.slice(i + 1, i + 5)));
}

/** Width in px of `text` set as the heading, tracking included. */
export function measure({ text, size }: { text: string; size: number }): number {
  let mille = 0;
  for (const ch of text) mille += (ADVANCES.get(ch) ?? FALLBACK_ADVANCE) + TRACKING * 1000;
  return (mille * size) / 1000;
}

/** Greedy fill. A word wider than the measure still gets its own line. */
function wrap({ words, size }: { words: string[]; size: number }): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && measure({ text: candidate, size }) > HEADING_WIDTH) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Cut back to a word boundary, not mid-word: `annotation tool fo…` reads as a
 * rendering fault, `annotation tool…` reads as a sentence that continues.
 *
 * Trailing separators go before the ellipsis too — cutting after one leaves a
 * comma or a hyphen that the ellipsis then follows, and `review,…` is debris.
 */
function truncate({ text, size }: { text: string; size: number }): string {
  const fits = (candidate: string) => measure({ text: candidate, size }) <= HEADING_WIDTH;
  const ellipsize = (body: string) => `${body.replace(/[\s,.;:—–-]+$/, '')}…`;

  const kept = text.split(' ');
  while (kept.length > 1) {
    kept.pop();
    const candidate = ellipsize(kept.join(' '));
    if (fits(candidate)) return candidate;
  }

  // One word too wide for the measure: there is no boundary left to fall back
  // to, so it is cut by character.
  const chars = [...text];
  while (chars.length > 1) {
    chars.pop();
    const candidate = ellipsize(chars.join(''));
    if (fits(candidate)) return candidate;
  }
  return '…';
}

export interface HeadingLayout {
  size: number;
  lines: string[];
}

/** The largest size at which the heading holds two lines, or the smallest cut to fit. */
export function layoutHeading(heading: string): HeadingLayout {
  const words = heading.split(/\s+/).filter(Boolean);
  if (words.length === 0) return { size: SIZE_MIN, lines: [] };
  const single = words.join(' ');

  for (let size = SIZE_MAX; size >= SINGLE_LINE_FLOOR; size -= SIZE_STEP) {
    if (measure({ text: single, size }) <= HEADING_WIDTH) return { size, lines: [single] };
  }

  for (let size = SIZE_MAX; size >= SIZE_MIN; size -= SIZE_STEP) {
    const lines = wrap({ words, size });
    if (lines.length <= MAX_LINES && lines.every((l) => measure({ text: l, size }) <= HEADING_WIDTH)) {
      return { size, lines };
    }
  }

  const lines = wrap({ words, size: SIZE_MIN }).slice(0, MAX_LINES);
  const last = lines[lines.length - 1];
  // Everything the cut dropped belongs to the line that ends the card, so the
  // ellipsis goes there rather than on whatever word happened to land last.
  if (last !== undefined) lines[lines.length - 1] = truncate({ text: last, size: SIZE_MIN });
  return { size: SIZE_MIN, lines };
}

interface Word {
  /** Offset from the line's start, in px at the laid-out size. */
  start: number;
  width: number;
  text: string;
}

/** The words of one line, with the x offset and width each will be drawn at. */
function words({ line, size }: { line: string; size: number }): Word[] {
  const out: Word[] = [];
  let cursor = 0;
  for (const token of line.split(' ')) {
    // The stroke goes under the letters, not under a trailing colon.
    const trimmed = token.replace(/^[^\p{L}\p{N}]+/u, '').replace(/[^\p{L}\p{N}]+$/u, '');
    if (trimmed) {
      const lead = token.slice(0, token.indexOf(trimmed));
      out.push({
        start: cursor + measure({ text: lead, size }),
        width: measure({ text: trimmed, size }),
        text: trimmed,
      });
    }
    cursor += measure({ text: `${token} `, size });
  }
  return out;
}

/**
 * Which word the stroke goes under. Our own name when the heading's last line
 * says it — that is what the page is about and what the reader should land on —
 * and otherwise the longest real word on that line, which is reliably the
 * operative one.
 *
 * The last line only, always. Two lines sit 1.08em apart, which leaves nowhere
 * near enough room for a stroke and a pin between them: annotating line one of
 * two put both straight through line two's letterforms.
 */
export function pickWord({ lines, size }: HeadingLayout): Word | undefined {
  const last = lines[lines.length - 1];
  if (last === undefined) return undefined;
  const all = words({ line: last, size });
  const brand = all.find((w) => w.text.toLowerCase() === 'marklayer');
  if (brand) return brand;
  const long = all.filter((w) => w.text.length >= 4);
  const pool = long.length > 0 ? long : all;
  return pool.reduce<Word | undefined>((best, w) => (best && best.width >= w.width ? best : w), undefined);
}

/** FNV-1a, so a heading always gets the same stroke back. */
function seedOf(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193) >>> 0;
  }
  return hash || 1;
}

function random(seed: number): () => number {
  let state = seed;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x100000000;
  };
}

const n = (v: number) => v.toFixed(1);

/**
 * The stroke under the word: one pass of a pen, not a rule. A hand does not draw
 * straight — it bows the line away from the letters through the middle, drifts
 * off level end to end, and wanders by a hair the whole way. All three are here,
 * and all three are seeded from the heading, so a page's card comes back
 * identical on every rebuild.
 *
 * Drawn as quadratics through the midpoints of the sampled points, which keeps
 * the curve smooth without the caps changing shape along it.
 */
function stroke({ x, y, width, size, seed }: { x: number; y: number; width: number; size: number; seed: number }) {
  const rand = random(seed);
  // The overshoot stops at the margins every other element on the card sits
  // inside. A stroke running into the margin reads as an overflow, not as a hand,
  // and one running off the edge is simply clipped.
  const from = Math.max(MARK_AXIS, x - 4 - width * 0.02);
  const to = Math.min(RIGHT_EDGE, x + width + 10 + width * 0.03);
  const span = to - from;
  // The bow always falls away from the word. Bowing up would crowd the
  // descenders the stroke was placed to clear.
  const bow = (0.55 + rand() * 0.75) * size * 0.055;
  const tilt = (rand() - 0.5) * size * 0.075;
  const wander = size * 0.022;

  const points = Array.from({ length: 7 }, (_, i) => {
    const t = i / 6;
    return {
      x: from + span * t,
      y: y + bow * Math.sin(Math.PI * t) + tilt * (t - 0.5) + (rand() - 0.5) * 2 * wander,
    };
  });

  const [first, ...rest] = points;
  if (!first) return { d: '', end: to };
  let d = `M ${n(first.x)} ${n(first.y)}`;
  for (let i = 0; i < rest.length - 1; i++) {
    const current = rest[i];
    const next = rest[i + 1];
    if (!current || !next) break;
    d += ` Q ${n(current.x)} ${n(current.y)} ${n((current.x + next.x) / 2)} ${n((current.y + next.y) / 2)}`;
  }
  const last = rest[rest.length - 1];
  if (last) d += ` T ${n(last.x)} ${n(last.y)}`;

  return {
    d: `<path d="${d}" fill="none" stroke="${MARK_ACCENT}" stroke-width="${n(Math.max(3.5, size * 0.075))}" stroke-linecap="round" stroke-linejoin="round"/>`,
    end: to,
  };
}

/** A comment pin, built the way the share card builds the real ones. */
const PIN_RADIUS = 19;
const PIN_LABEL = 20;
function pin({ cx, cy }: { cx: number; cy: number }): string {
  // 0.36em below the center is where Geist's digits actually sit centered; a
  // glyph's optical middle is not its box's. Weight 600, not the 500 the share
  // card's pins use: white on the accent is a 3.2:1 ratio, which needs the extra
  // stem to stay legible at the size a card is actually looked at.
  return `<circle cx="${n(cx)}" cy="${n(cy)}" r="${PIN_RADIUS}" fill="${MARK_ACCENT}"/>
  <text x="${n(cx)}" y="${n(cy + PIN_LABEL * 0.36)}" text-anchor="middle" font-family="Geist" font-size="${PIN_LABEL}" font-weight="600" fill="${TONE.ink}">1</text>`;
}

export interface PageOgCardParams {
  /** The page's own h1. */
  heading: string;
  /** Root-relative path, e.g. `/vs/markup-io`. Named on the card as itself. */
  path: string;
}

/**
 * The marketing pages' card: the page's heading set large, with the product's
 * own vocabulary drawn onto it — a pen stroke under the operative word and a
 * comment pinned to it. The artifact is the thing MarkLayer does, performed on
 * the page's own words, so no two pages share a card and none of it is a prop.
 *
 * Pure, like the share card's composer: no fonts, no rasterizer, no network, so
 * the composition can be rendered and looked at on its own.
 */
export function buildPageOgSvg({ heading, path }: PageOgCardParams): string {
  const layout = layoutHeading(heading);
  const { size, lines } = layout;

  const block = size * CAP + size * LINE_HEIGHT * Math.max(0, lines.length - 1);
  const firstBaseline = OPTICAL_CENTER + size * CAP - block / 2;

  const chosen = pickWord(layout);
  let annotation = '';
  if (chosen) {
    // The last line, always — `pickWord` never looks at any other.
    const baseline = firstBaseline + size * LINE_HEIGHT * (lines.length - 1);
    // Below the descenders, never through them: a line crossing the letterforms
    // reads as a strike-through rather than an underline.
    const y = baseline + size * 0.3;
    const x = MARK_AXIS + chosen.start;
    const drawn = stroke({ x, y, width: chosen.width, size, seed: seedOf(heading) });
    // The pin hangs off the tail of the stroke rather than beside it, which is
    // the one place on the line where it cannot land on a letter.
    const cx = Math.min(drawn.end + 4, RIGHT_EDGE - PIN_RADIUS);
    annotation = `${drawn.d}
  ${pin({ cx, cy: y + PIN_RADIUS + 5 })}`;
  }

  const heads = lines
    .map(
      (line, i) =>
        `<text x="${MARK_AXIS}" y="${n(firstBaseline + size * LINE_HEIGHT * i)}" font-family="Geist" font-size="${size}" font-weight="700" fill="${TONE.ink}" letter-spacing="${(TRACKING * size).toFixed(2)}">${escapeXml(line)}</text>`,
    )
    .join('\n  ');

  const trail = path && path !== '/' ? `${SEPARATOR}<tspan fill="${TONE.muted}">${escapeXml(path)}</tspan>` : '';

  return `<svg width="${CARD.width}" height="${CARD.height}" viewBox="0 0 ${CARD.width} ${CARD.height}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${CARD.width}" height="${CARD.height}" fill="${TONE.ground}"/>

  ${mark({ ...SIGNATURE_MARK, fill: TONE.ink })}

  ${heads}

  ${annotation}

  <text x="${MARK_AXIS}" y="${COLOPHON_BASELINE}" font-family="Geist" font-size="22" letter-spacing="-0.1"><tspan fill="${TONE.ink}" font-weight="500">marklayer.app</tspan>${trail}</text>
</svg>`;
}
