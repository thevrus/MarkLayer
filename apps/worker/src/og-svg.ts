import { MARK_PATHS, MARK_TRANSFORM } from './brand';

export function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Where the artwork actually sits inside the 512 box: it fills neither the width
 * nor the height of it, so scaling the box alone would hang the mark off-center
 * from the wordmark beside it. These are the measured extents of the three paths
 * after `MARK_TRANSFORM`.
 */
export const MARK_BOX = { x: 27.6, y: -3.4, h: 423.4 };

/* Two axes, and everything on either card sits on one of them: the marks (the
   logo, the favicon) hang at the outer edge, the words start at the inner one. */
export const MARK_AXIS = 72;
export const TEXT_AXIS = 132;
export const RIGHT_EDGE = 1128;

export const CARD = { width: 1200, height: 630 };

/** Display tracking, as a fraction of the size. Both cards set their large type with it. */
export const TRACKING = -0.035;

/**
 * The cards' five tones. Both are drawn on black so the only colour on them can
 * belong to the annotation — the person's own ink on the share card, the drawn
 * stroke on the page card.
 */
export const TONE = {
  ground: '#000000',
  ink: '#ffffff',
  muted: '#8f8f8f',
  faint: '#3d3d3d',
  /** A tone barely above the ground: the watermark, an empty panel. */
  ghost: '#141414',
};

/**
 * The tally and the colophon both read as one line in two voices, so the dot
 * between their parts is defined once.
 *
 * Non-breaking spaces: XML collapses and trims ordinary runs, so a plain ' · '
 * would render as a dot jammed between the words.
 */
export const SEPARATOR = `<tspan fill="${TONE.faint}">\u00a0\u00a0·\u00a0\u00a0</tspan>`;

/** The mark alone, placed by the artwork's true extents rather than by its box. */
export function mark({ x, top, height, fill }: { x: number; top: number; height: number; fill: string }): string {
  const k = height / MARK_BOX.h;
  const paths = MARK_PATHS.map((d) => `<path d="${d}"/>`).join('');
  return `<g transform="translate(${(x - MARK_BOX.x * k).toFixed(2)} ${(top - MARK_BOX.y * k).toFixed(2)}) scale(${k.toFixed(6)})" fill="${fill}">
    <g transform="${MARK_TRANSFORM}">${paths}</g>
  </g>`;
}

/** The logo at the size both cards sign themselves with. */
export const SIGNATURE_MARK = { x: MARK_AXIS, top: 54, height: 54 };
