import { signal, useComputed, useSignal, useSignalEffect } from '@preact/signals';
import { useEffect, useRef } from 'preact/hooks';
import { activeTool } from './state';

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The pointer in marker-layer space, or null while it is off the page, a button
 * is down, or a tool is armed. Highlights stay pointer-transparent so the page
 * keeps its links and text selection; hovering them is a hit-test against this.
 */
export const markPointer = signal<{ x: number; y: number } | null>(null);

export function setMarkPointer(e: PointerEvent | MouseEvent, at: { x: number; y: number } | null) {
  markPointer.value = at && e.buttons === 0 && activeTool.peek() === 'navigate' ? at : null;
}

export const clearMarkPointer = () => {
  markPointer.value = null;
};

/** Long enough that reading across a highlight does not throw its card over the text. */
const HOVER_INTENT_MS = 300;

/** True once the pointer has rested on any of `boxes`, which are in marker-layer space. */
export function useMarkHover(boxes: readonly Box[]): boolean {
  const boxesRef = useRef(boxes);
  boxesRef.current = boxes;
  const over = useComputed(() => {
    const p = markPointer.value;
    return (
      !!p && boxesRef.current.some((b) => p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height)
    );
  });
  const open = useSignal(false);
  useSignalEffect(() => {
    if (!over.value) {
      open.value = false;
      return;
    }
    const t = setTimeout(() => {
      open.value = true;
    }, HOVER_INTENT_MS);
    return () => clearTimeout(t);
  });
  return open.value;
}

/** Feeds `markPointer` from the host page, whose viewport is the marker layer's space. */
export function useWindowMarkPointer() {
  useEffect(() => {
    const onMove = (e: PointerEvent) => setMarkPointer(e, { x: e.clientX, y: e.clientY });
    const onOut = (e: PointerEvent) => {
      if (!e.relatedTarget) clearMarkPointer();
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('pointerout', onOut);
    window.addEventListener('blur', clearMarkPointer);
    return () => {
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerout', onOut);
      window.removeEventListener('blur', clearMarkPointer);
    };
  }, []);
}
