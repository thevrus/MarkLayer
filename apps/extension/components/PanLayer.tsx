import { cn } from '@marklayer/types';
import { useSignal } from '@preact/signals';
import { useRef } from 'preact/hooks';
import { panActive, panBy } from '../lib/state';

/**
 * Figma's hand tool. Covers the annotated surface while `H` is toggled on or Space
 * is held, and drag-scrolls it — the current drawing tool stays selected underneath,
 * so releasing Space puts you straight back to drawing.
 *
 * Positioning is a prop because the two hosts stack differently: the extension
 * floats over the live page, the web viewer sits inside the scaled iframe wrapper.
 */
export function PanLayer({ class: cls }: { class?: string }) {
  const dragging = useSignal(false);
  const last = useRef({ x: 0, y: 0 });

  if (!panActive.value) return null;

  const stopDrag = () => {
    dragging.value = false;
  };

  return (
    <div
      aria-hidden="true"
      class={cn('fixed inset-0 z-2147483646', cls)}
      style={{ cursor: dragging.value ? 'grabbing' : 'grab', touchAction: 'none' }}
      onPointerDown={(e) => {
        dragging.value = true;
        last.current = { x: e.clientX, y: e.clientY };
        e.currentTarget.setPointerCapture(e.pointerId);
        e.preventDefault();
      }}
      onPointerMove={(e) => {
        if (!dragging.value) return;
        panBy(last.current.x - e.clientX, last.current.y - e.clientY);
        last.current = { x: e.clientX, y: e.clientY };
      }}
      onPointerUp={stopDrag}
      onPointerCancel={stopDrag}
    />
  );
}
