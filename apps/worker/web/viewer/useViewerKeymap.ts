import {
  bindFigmaKeys,
  bindKeymap,
  HISTORY_KEYS,
  type KeyBinding,
  pushDismisser,
  useDismissible,
} from '@ext/lib/keymap';
import { redo, undo } from '@ext/lib/ops';
import { useSignalEffect } from '@preact/signals';
import { refit, stepCanvasZoom, zoomCanvasTo } from '../deviceCamera';
import { focusedAnnotationId, showAnnotationPanel, showBoard, showInfoPanel } from '../ui-state';
import { setBoardOpen } from '../viewer-actions';
import { deviceOverview, isReadonly, stepZoom, viewerZoom } from '../viewer-state';
import { viewerEscape } from './viewerEscape';

type Handler = (e: KeyboardEvent) => void;

const pd =
  (fn: () => void): Handler =>
  (e) => {
    e.preventDefault();
    fn();
  };
const editing =
  (fn: Handler): Handler =>
  (e) => {
    if (!isReadonly.value) fn(e);
  };
const inOverview =
  (fn: () => void): Handler =>
  (e) => {
    if (deviceOverview.value) pd(fn)(e);
  };

const BINDINGS: KeyBinding[] = [
  { keys: '$mod+KeyR', on: editing(pd(() => window.location.reload())) },
  ...HISTORY_KEYS.undo.keys.map((keys) => ({ keys, on: editing(pd(undo)) })),
  ...HISTORY_KEYS.redo.keys.map((keys) => ({ keys, on: editing(pd(redo)) })),
  // The board is the same annotations in another arrangement, so a read-only guest
  // gets it too. ⌘B is free in a browser: the bookmarks bar is ⌘⇧B.
  { keys: '$mod+KeyB', on: pd(() => setBoardOpen({ open: !showBoard.value, via: 'shortcut' })) },
  // One owner per key: while the device canvas is up, zoom means its camera.
  { keys: '$mod+Equal', on: pd(() => (deviceOverview.value ? stepCanvasZoom(1) : stepZoom(1))) },
  { keys: '$mod+Minus', on: pd(() => (deviceOverview.value ? stepCanvasZoom(-1) : stepZoom(-1))) },
  {
    keys: '$mod+Digit0',
    on: pd(() => {
      if (deviceOverview.value) refit();
      else viewerZoom.value = 'auto';
    }),
  },
  { keys: 'Shift+Digit1', on: inOverview(refit) },
  { keys: 'Shift+Digit0', on: inOverview(() => zoomCanvasTo(1)) },
  { keys: 'Escape', on: viewerEscape },
];

export function useViewerKeymap() {
  useSignalEffect(() => {
    const unbind = bindKeymap({ scope: window, bindings: BINDINGS });
    // Zoom, panning and the Alt measure readout are navigation, so a read-only viewer keeps them.
    const unbindFigma = bindFigmaKeys({ target: window, guard: editing, viewGuard: (fn) => fn });
    return () => {
      unbind();
      unbindFigma();
    };
  });

  // Together in one effect, so the detail always sits above the panel that holds it.
  useSignalEffect(() => {
    const offs: (() => void)[] = [];
    if (showAnnotationPanel.value) {
      offs.push(
        pushDismisser(() => {
          showAnnotationPanel.value = false;
        }),
      );
    }
    if (focusedAnnotationId.value) {
      offs.push(
        pushDismisser(() => {
          focusedAnnotationId.value = null;
        }),
      );
    }
    return () => {
      for (const off of offs) off();
    };
  });

  useDismissible({
    open: showInfoPanel,
    close: () => {
      showInfoPanel.value = false;
    },
  });
}
