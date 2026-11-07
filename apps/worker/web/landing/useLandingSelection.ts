import { useSelectionCapture } from '@ext/lib/selection-capture';
import { activeTool } from '@ext/lib/tool-state';
import { selectionPopover } from '../ui-state';

/** Turns a text selection on the page into the selection tool's popover. */
export function useLandingSelection(): void {
  useSelectionCapture({
    armed: () => activeTool.value === 'selection',
    onCapture: ({ text, rects, last }) => {
      selectionPopover.value = { text, rects, screenX: last.right, screenY: last.bottom, auto: false };
    },
  });
}
