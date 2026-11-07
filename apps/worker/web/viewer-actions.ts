import { batch } from '@preact/signals';
import { capture } from './analytics';
import { focusedAnnotationId, showAnnotationPanel, showBoard } from './ui-state';

/** Shows an annotation's detail. Focus without the panel renders nothing, so the two are written together. */
export function openAnnotation(id: string) {
  batch(() => {
    focusedAnnotationId.value = id;
    showAnnotationPanel.value = true;
  });
}

/** Every door to the board. It replaces the panel rather than stacking over it. */
export function setBoardOpen({ open, via }: { open: boolean; via: string }) {
  if (showBoard.value === open) return;
  batch(() => {
    showBoard.value = open;
    if (open) showAnnotationPanel.value = false;
  });
  capture('board_toggled', { open, via });
}
