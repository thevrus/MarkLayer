import { useEffect } from 'preact/hooks';
import { CommentLayer } from '../components/CommentLayer';
import { Toasts } from '../components/Toasts';
import { useOverlayHost } from '../components/useOverlayHost';
import { bindKeymap } from '../lib/keymap';
import { activeTool } from '../lib/tool-state';

/** The extension's overlay cut down to commenting: pins, the comment popover and toasts, nothing else. */
export function WidgetApp() {
  useOverlayHost();

  // tinykeys skips keys aimed at inputs, so an open comment keeps its own Escape.
  useEffect(
    () =>
      bindKeymap({
        scope: window,
        bindings: [
          {
            keys: 'Escape',
            on: () => {
              activeTool.value = 'navigate';
            },
          },
        ],
      }),
    [],
  );

  return (
    <div class="pointer-events-auto">
      <CommentLayer />
      <Toasts />
    </div>
  );
}
