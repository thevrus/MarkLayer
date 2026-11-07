import { useEffect, useRef } from 'preact/hooks';
import { toDoc } from './scroller';
import type { SelectionRect } from './types';

export interface CapturedSelection {
  text: string;
  /** In whatever space `toRect` maps to; document space by default. */
  rects: SelectionRect[];
  /** The final client rect, in the selection's own viewport, for placing a popover. */
  last: DOMRectReadOnly;
  /** Read now: once a popover takes focus the selection collapses and this context is gone. */
  el: Element | null;
}

const docRect = (cr: DOMRectReadOnly): SelectionRect => ({
  ...toDoc(cr),
  width: cr.width,
  height: cr.height,
});

// nodeType, not instanceof: a selection inside an iframe belongs to another realm.
const isElement = (node: Node): node is Element => node.nodeType === 1;

export function captureSelection({
  sel,
  toRect = docRect,
}: {
  sel: Selection | null;
  toRect?: (cr: DOMRectReadOnly) => SelectionRect | null;
}): CapturedSelection | null {
  if (!sel || sel.isCollapsed) return null;
  const text = sel.toString();
  if (!text.trim()) return null;

  const rects: SelectionRect[] = [];
  let last: DOMRectReadOnly | null = null;
  for (let i = 0; i < sel.rangeCount; i++) {
    for (const cr of sel.getRangeAt(i).getClientRects()) {
      const rect = toRect(cr);
      if (!rect) continue;
      rects.push(rect);
      // Tracked across ranges: a trailing range can contribute no rects at all.
      last = cr;
    }
  }
  if (!last) return null;
  const ancestor = sel.getRangeAt(0).commonAncestorContainer;
  return { text, rects, last, el: isElement(ancestor) ? ancestor : ancestor.parentElement };
}

/** Reads the page's selection on mouseup, one frame later so the rects are post-layout. */
export function useSelectionCapture(options: {
  armed: (e: MouseEvent) => boolean;
  toRect?: (cr: DOMRectReadOnly) => SelectionRect | null;
  onCapture: (captured: CapturedSelection) => void;
}): void {
  const latest = useRef(options);
  latest.current = options;

  useEffect(() => {
    const onMouseUp = (e: MouseEvent) => {
      if (!latest.current.armed(e)) return;
      // The common case is a plain click: answer it before scheduling a frame.
      if (window.getSelection()?.isCollapsed !== false) return;
      requestAnimationFrame(() => {
        const { toRect, onCapture } = latest.current;
        const captured = captureSelection({ sel: window.getSelection(), toRect });
        if (captured) onCapture(captured);
      });
    };
    window.addEventListener('mouseup', onMouseUp);
    return () => window.removeEventListener('mouseup', onMouseUp);
  }, []);
}
