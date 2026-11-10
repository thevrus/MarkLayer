/** Two opposing cursor pointers form the visual collaboration mark. */
export const MARK_PATHS = [
  'M48 52 L215 153 L163 173 L263 387 L218 409 L115 195 L80 234 Z',
  'M464 52 L297 153 L349 173 L249 387 L294 409 L397 195 L432 234 Z',
] as const;

/** Heavier, simpler cursor tips retain their shape at favicon sizes. */
export const SMALL_MARK_PATHS = [
  'M42 48 L220 155 L164 176 L266 386 L214 414 L108 201 L75 238 Z',
  'M470 48 L292 155 L348 176 L246 386 L298 414 L404 201 L437 238 Z',
] as const;

export const MARK_TRANSFORM = 'translate(0 0)';
export const MARK_BLUE = '#3278F6';
export const MARK_PURPLE = '#8B5CF6';
export const MARK_ACCENT = MARK_PURPLE;

/** Keep the existing explainer URL compatible. */
export const HOW_IT_WORKS_PATH = '/guides/how-marklayer-works';
