import { CARD, escapeXml, MARK_AXIS, mark, SEPARATOR, SIGNATURE_MARK, TEXT_AXIS, TONE, TRACKING } from './og-svg';
import { collectTally, EMPTY_TALLY_LABEL, type OpTally, plural, tallyParts } from './og-tally';

/**
 * The mark at signature scale, running off the right edge and whole on every
 * other, in a tone barely above the ground.
 *
 * This is the whole of the card's artwork. It used to be a fallback behind a
 * panel that drew the person's own annotations, which was removed: an OG image
 * is fetched by every chat app and crawler that sees the link, so the geometry
 * travelled wherever the link did. What is left says a page was annotated and
 * how much, and shows nothing of what was said about it.
 */
function watermark(): string {
  return mark({ x: 792, top: 103, height: 424, fill: TONE.ghost });
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
 *
 * The space before each noun is non-breaking because XML collapses and trims
 * ordinary runs, which would jam the number against its word.
 */
function statsLine(tally: OpTally): string {
  const parts = tallyParts(tally);
  if (parts.length === 0) return `<tspan fill="${TONE.muted}">${EMPTY_TALLY_LABEL}</tspan>`;
  return parts
    .map(
      (p) =>
        `<tspan fill="${TONE.ink}" font-weight="500">${p.n}</tspan><tspan fill="${TONE.muted}">\u00a0${plural(p)}</tspan>`,
    )
    .join(SEPARATOR);
}

export interface OgCardParams {
  domain: string;
  /** Raw stored ops. Only counted, never drawn. */
  ops: unknown[];
  /** Favicon of the annotated page as a data URI, or null when it can't be had. */
  faviconUri: string | null;
}

/**
 * The share card: the site named across the middle, what was left on it counted
 * underneath, and the mark carrying the rest of the frame.
 *
 * Pure on purpose. Everything with a network or a renderer behind it lives in
 * og.ts, so the composition can be rendered and eyeballed without either.
 */
export function buildOgSvg({ domain, ops, faviconUri }: OgCardParams): string {
  const tally = collectTally(ops);

  // With no favicon the naming line has nothing to hang in the outer margin, so
  // it moves out to that axis rather than sit at an unexplained indent.
  const textX = faviconUri ? TEXT_AXIS : MARK_AXIS;
  const label = fitDomain(domain);
  const size = displaySize(label.length);
  const baseline = 366;
  const icon = 40;
  // The favicon centers on the domain's cap band, so the two read as one line.
  const iconY = baseline - size * 0.72 + (size * 0.72 - icon) / 2;

  return `<svg width="${CARD.width}" height="${CARD.height}" viewBox="0 0 ${CARD.width} ${CARD.height}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${CARD.width}" height="${CARD.height}" fill="${TONE.ground}"/>

  ${watermark()}

  ${mark({ ...SIGNATURE_MARK, fill: TONE.ink })}

  ${faviconUri ? `<image x="${MARK_AXIS}" y="${iconY.toFixed(1)}" width="${icon}" height="${icon}" href="${faviconUri}"/>` : ''}

  <text x="${textX}" y="${baseline}" font-family="Geist" font-size="${size}" font-weight="700" fill="${TONE.ink}" letter-spacing="${(TRACKING * size).toFixed(2)}">${escapeXml(label)}</text>
  <text x="${textX}" y="${baseline + 45}" font-family="Geist" font-size="20" letter-spacing="-0.1">${statsLine(tally)}</text>
</svg>`;
}
