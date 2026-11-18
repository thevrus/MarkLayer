import { isPrimaryPress } from './pointer';
import type { StrokeEngine } from './stroke-engine';

const input = (e: PointerEvent) => ({ client: { x: e.clientX, y: e.clientY }, shift: e.shiftKey });

/** Pen-down from mouse, touch or Pencil. */
export function strokeDown({ engine, e }: { engine: StrokeEngine; e: PointerEvent }) {
  if (isPrimaryPress(e)) engine.down(input(e));
}

/** Window-level move/up for a stroke; a second finger landing mid-stroke (pinch) must not steer or end it. */
export function bindStrokeMoves(engine: StrokeEngine) {
  const onMove = (e: PointerEvent) => {
    if (e.isPrimary && engine.drawing) engine.move(input(e));
  };
  const onUp = (e: PointerEvent) => {
    if (e.isPrimary) engine.up(input(e));
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
  return () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
  };
}
