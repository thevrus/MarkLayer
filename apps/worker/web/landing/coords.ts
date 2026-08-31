import type { Point } from '@ext/lib/types';

/**
 * Pointer event to document-space point.
 *
 * Module scope rather than a `useCallback` in the page: the canvas, the cursor
 * broadcast and the text tool all need the same conversion, and hanging it off
 * one component's identity made it a dependency the other two had to be handed.
 */
export function canvasCoords(e: MouseEvent): Point {
  return { x: e.clientX + window.scrollX, y: e.clientY + window.scrollY };
}
