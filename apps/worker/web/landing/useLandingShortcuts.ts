import { editableTarget } from '@ext/lib/dom';
import { bindKeymap, dismissTop, HISTORY_KEYS } from '@ext/lib/keymap';
import { redo, undo } from '@ext/lib/ops';
import { activeTool, selectTool } from '@ext/lib/tool-state';
import { TOOL_SHORTCUTS } from '@ext/lib/tools';
import { useSignalEffect } from '@preact/signals';
import { tinykeys } from 'tinykeys';
import { showAnnotationPanel } from '../ui-state';

const pd = (fn: () => void) => (e: KeyboardEvent) => {
  e.preventDefault();
  fn();
};

function onEscape(e: KeyboardEvent) {
  const field = editableTarget(e);
  if (field) {
    field.blur();
    return;
  }
  e.preventDefault();
  if (dismissTop()) return;
  if (showAnnotationPanel.value) showAnnotationPanel.value = false;
  else activeTool.value = 'navigate';
}

/** The page's keyboard layer: the product's own tool shortcuts, plus undo/redo. */
export function useLandingShortcuts(): void {
  useSignalEffect(() => {
    const unbind = bindKeymap({
      scope: window,
      bindings: [
        ...TOOL_SHORTCUTS.map(({ tool, pattern }) => ({
          keys: pattern,
          on: pd(() => selectTool({ tool, via: 'shortcut' })),
        })),
        ...HISTORY_KEYS.undo.keys.map((keys) => ({ keys, on: pd(undo) })),
        ...HISTORY_KEYS.redo.keys.map((keys) => ({ keys, on: pd(redo) })),
      ],
    });
    // Unlike the rest, Escape has to reach a field: it is how the URL box lets go of the keyboard.
    const unbindEscape = tinykeys(window, { Escape: onEscape }, { ignore: () => false });
    return () => {
      unbind();
      unbindEscape();
    };
  });
}
