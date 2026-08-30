import { MARK_PATHS, MARK_TRANSFORM } from './brand';
import { collectMarks, type OpTally, renderMarks } from './og-marks';

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Where the artwork actually sits inside the 512 box: it fills neither the width
 * nor the height of it, so scaling the box alone would hang the mark off-center
 * from the wordmark beside it. These are the measured extents of the three paths
 * after `MARK_TRANSFORM`.
 */
const MARK_BOX = { x: 27.6, y: -3.4, w: 440.8, h: 423.4 };

/* Two axes, and everything on the card sits on one of them: the marks (the logo,
   the favicon) hang at the outer edge, the words start at the inner one. */
const MARK_AXIS = 72;
const TEXT_AXIS = 132;
const RIGHT_EDGE = 1128;

/**
 * The annotated page, drawn as a panel that runs off the right edge of the card.
 * It is laid out wider than the card shows on purpose: the page continues past
 * the frame the way a real one does, and the extra width gives the crop somewhere
 * to pan to when the annotations sit right of center.
 */
const PANEL = { x: 452, y: 58, height: 356, drawnWidth: 868 };

/** The mark alone, placed by the artwork's true extents rather than by its box. */
function mark({ x, top, height, fill }: { x: number; top: number; height: number; fill: string }): string {
  const k = height / MARK_BOX.h;
  const paths = MARK_PATHS.map((d) => `<path d="${d}"/>`).join('');
  return `<g transform="translate(${(x - MARK_BOX.x * k).toFixed(2)} ${(top - MARK_BOX.y * k).toFixed(2)}) scale(${k.toFixed(6)})" fill="${fill}">
    <g transform="${MARK_TRANSFORM}">${paths}</g>
  </g>`;
}

/**
 * What stands in for the page when a share carries no annotations at all: the
 * mark at signature scale, running off the right edge and whole on every other,
 * in a tone barely above the ground. An empty panel would be a placeholder box;
 * this is the one thing that is still true about the card.
 */
function watermark(): string {
  const height = 424;
  return mark({ x: 792, top: 103, height, fill: '#141414' });
}

/** Steps rather than a formula, so a domain never lands between two awkward sizes. */
function displaySize(length: number): number {
  if (length <= 18) return 62;
  if (length <= 26) return 50;
  if (length <= 34) return 41;
  if (length <= 44) return 34;
  return 29;
}

/**
 * Hostnames longer than the smallest step can hold. The trailing separator is
 * dropped first: slicing mid-label leaves a dot or a hyphen that the ellipsis
 * then follows, and `example….` reads as four dots rather than a truncation.
 */
function fitDomain(domain: string): string {
  if (domain.length <= 54) return domain;
  return `${domain.slice(0, 53).replace(/[.-]+$/, '')}…`;
}

/**
 * The tally as one line in two voices: the counts in white, their nouns in grey.
 * Hierarchy comes from the type, not from a row of chips.
 */
function statsLine(tally: OpTally): string {
  const parts = [
    { n: tally.comments, word: 'comment' },
    { n: tally.drawings, word: 'drawing' },
    { n: tally.notes, word: 'note' },
  ].filter((p) => p.n > 0);
  if (parts.length === 0) return '<tspan fill="#8f8f8f">Shared annotations</tspan>';
  // Non-breaking spaces: XML collapses and trims ordinary runs, so a plain ' · '
  // would render as a dot jammed between the words.
  const sep = '<tspan fill="#3d3d3d">\u00a0\u00a0·\u00a0\u00a0</tspan>';
  return parts
    .map(
      (p) =>
        `<tspan fill="#ffffff" font-weight="500">${p.n}</tspan><tspan fill="#8f8f8f">\u00a0${p.word}${p.n > 1 ? 's' : ''}</tspan>`,
    )
    .join(sep);
}

export interface OgCardParams {
  domain: string;
  /** Raw stored ops; parsed and sanitized in `collectMarks`. */
  ops: unknown[];
  /** Favicon of the annotated page as a data URI, or null when it can't be had. */
  faviconUri: string | null;
}

/**
 * The share card: the annotated page as a panel running off the right edge, the
 * person's own marks sitting on it where they drew them, and the site named
 * across the bottom. The artifact is the real data — nothing here stands in for
 * a screenshot, so no two cards look alike.
 *
 * Pure on purpose. Everything with a network or a renderer behind it lives in
 * og.ts, so the composition can be rendered and eyeballed without either.
 */
export function buildOgSvg({ domain, ops, faviconUri }: OgCardParams): string {
  const { marks, tally, viewportWidth } = collectMarks(ops);
  const visible = { x: PANEL.x, y: PANEL.y, w: RIGHT_EDGE + 72 - PANEL.x, h: PANEL.height };
  const artwork = renderMarks({
    marks,
    page: { x: PANEL.x, width: PANEL.drawnWidth },
    visible,
    viewportWidth,
  });

  // With no favicon the naming line has nothing to hang in the outer margin, so
  // it moves out to that axis rather than sit at an unexplained indent.
  const textX = faviconUri ? TEXT_AXIS : MARK_AXIS;
  const label = fitDomain(domain);
  const size = displaySize(label.length);
  // With no page to show, the naming block rises to the optical center rather
  // than sitting as a strip under an empty panel.
  const baseline = artwork ? 530 : 366;
  const icon = 40;
  // The favicon centers on the domain's cap band, so the two read as one line.
  const iconY = baseline - size * 0.72 + (size * 0.72 - icon) / 2;

  return `<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <clipPath id="panelClip">
      <rect x="${PANEL.x}" y="${PANEL.y}" width="${PANEL.drawnWidth}" height="${PANEL.height}" rx="14"/>
    </clipPath>
  </defs>

  <rect width="1200" height="630" fill="#000000"/>
${
  artwork
    ? `
  <g clip-path="url(#panelClip)">
    <rect x="${PANEL.x}" y="${PANEL.y}" width="${PANEL.drawnWidth}" height="${PANEL.height}" rx="14" fill="#0c0c0c"/>
    ${artwork}
  </g>`
    : watermark()
}

  ${mark({ x: MARK_AXIS, top: 54, height: 54, fill: '#ffffff' })}

  ${faviconUri ? `<image x="${MARK_AXIS}" y="${iconY.toFixed(1)}" width="${icon}" height="${icon}" href="${faviconUri}"/>` : ''}

  <text x="${textX}" y="${baseline}" font-family="Geist" font-size="${size}" font-weight="700" fill="#ffffff" letter-spacing="${(-size * 0.035).toFixed(2)}">${escapeXml(label)}</text>
  <text x="${textX}" y="${baseline + 45}" font-family="Geist" font-size="20" letter-spacing="-0.1">${statsLine(tally)}</text>
</svg>`;
}
