/**
 * The zoom slider's scale: ten notches either side of 100%, 5% apart below it and
 * 10% above. Zooming out and zooming in get the same travel, 100% sits at the
 * centre, and every stop reads as a round number.
 */
export const ZOOM_NOTCHES = 10;

/** One ⌘+/⌘− press. Five notches lands on the old presets: 50, 75, 100, 150, 200%. */
export const ZOOM_LARGE_STEP = 5;

/** Percent per notch below 100% and above it. */
const OUT_PCT = 5;
const IN_PCT = 10;

/** Fractional off a stop: an auto fit lands between them, or past either end. */
export function zoomToNotch(zoom: number): number {
  const pct = Math.round(zoom * 100);
  return (pct - 100) / (pct <= 100 ? OUT_PCT : IN_PCT);
}

export function notchToZoom(notch: number): number {
  return (100 + notch * (notch <= 0 ? OUT_PCT : IN_PCT)) / 100;
}

/** Where the thumb sits: clamped, because an auto fit can fall outside the scale. */
export function thumbNotch(zoom: number): number {
  return Math.max(-ZOOM_NOTCHES, Math.min(ZOOM_NOTCHES, zoomToNotch(zoom)));
}

/** A stored zoom, if it is a stop on the scale; anything else is stale or hand-edited. */
export function zoomStop(zoom: number): number | null {
  const notch = zoomToNotch(zoom);
  return Number.isInteger(notch) && Math.abs(notch) <= ZOOM_NOTCHES ? notchToZoom(notch) : null;
}

/**
 * The next large stop past `from` in `dir`, or null at the end of the scale.
 * Strictly past: stepping from a stop has to leave it, not land back on it.
 */
export function nextLargeStop({ from, dir }: { from: number; dir: 1 | -1 }): number | null {
  const at = zoomToNotch(from) / ZOOM_LARGE_STEP;
  const past = (dir > 0 ? Math.floor(at) + 1 : Math.ceil(at) - 1) * ZOOM_LARGE_STEP;
  // From a fit outside the scale, the first step lands on its near end.
  const next = dir > 0 ? Math.max(past, -ZOOM_NOTCHES) : Math.min(past, ZOOM_NOTCHES);
  return Math.abs(next) <= ZOOM_NOTCHES ? notchToZoom(next) : null;
}
