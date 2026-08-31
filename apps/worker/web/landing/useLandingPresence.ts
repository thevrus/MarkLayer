import { activeTool, onCursorMove } from '@ext/lib/state';
import type { SelectionRect } from '@ext/lib/types';
import { useEffect } from 'preact/hooks';
import { selectionPopover } from '../signals';
import { canvasCoords } from './coords';

/**
 * The two things the page does with a pointer besides draw: broadcast this
 * visitor's cursor to the other people on the board, and turn a text selection
 * into the selection tool's popover.
 */
export function useLandingPresence(): void {
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const pos = canvasCoords(e);
      onCursorMove.value?.(pos.x, pos.y, activeTool.value);
    };
    window.addEventListener('mousemove', handler);
    return () => window.removeEventListener('mousemove', handler);
  }, []);

  useEffect(() => {
    const onMouseUp = () => {
      if (activeTool.value !== 'selection') return;
      requestAnimationFrame(() => {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed || !sel.toString().trim()) return;
        const text = sel.toString();
        const rects: SelectionRect[] = [];
        for (let i = 0; i < sel.rangeCount; i++) {
          for (const cr of sel.getRangeAt(i).getClientRects()) {
            rects.push({ x: cr.x + window.scrollX, y: cr.y + window.scrollY, width: cr.width, height: cr.height });
          }
        }
        if (rects.length === 0) return;
        const lastCr = sel.getRangeAt(sel.rangeCount - 1).getClientRects();
        // A range can contribute no client rects (a collapsed boundary inside a
        // multi-range selection). `rects` is in document space and these anchor
        // the popover in viewport space, so there is nothing here to fall back
        // to — without a rect there is no place to put it.
        const last = lastCr[lastCr.length - 1];
        if (!last) return;
        selectionPopover.value = { text, rects, screenX: last.right, screenY: last.bottom, auto: false };
      });
    };
    window.addEventListener('mouseup', onMouseUp);
    return () => window.removeEventListener('mouseup', onMouseUp);
  }, []);
}
