import { type CapturedSelection, captureSelection, useSelectionCapture } from '@ext/lib/selection-capture';
import { captureTarget } from '@ext/lib/selector';
import { activeTool, selectionCaptureArmed } from '@ext/lib/tool-state';
import { frameViewport, useIframeOverlay } from '../iframeOverlay';
import { selectionPopover } from '../ui-state';
import { cssScale, iframeScrollY } from '../viewer-state';

/** Turns a text selection, on the host or in the frame, into the selection popover. */
export function useSelectionPopover({
  frameRef,
  innerRef,
}: {
  frameRef: { current: HTMLIFrameElement | null };
  innerRef: { current: HTMLDivElement | null };
}) {
  const open = ({
    captured: { text, rects, el },
    screen,
    auto,
  }: {
    captured: CapturedSelection;
    screen: { x: number; y: number };
    /** The selection alone opened this, so the popover must not take focus. */
    auto: boolean;
  }) => {
    const first = rects[0];
    if (!first) return;
    selectionPopover.value = {
      text,
      rects,
      screenX: screen.x,
      screenY: screen.y,
      target: el ? captureTarget({ el, anchor: { x: first.x, y: first.y }, selectedText: text }) : undefined,
      captureViewport: frameViewport(frameRef.current),
      auto,
    };
  };

  useSelectionCapture({
    armed: () => activeTool.value === 'selection',
    toRect: (cr) => {
      const inner = innerRef.current?.getBoundingClientRect();
      if (!inner) return null;
      const cs = cssScale.value;
      return {
        x: (cr.x - inner.left) / cs,
        y: (cr.y - inner.top) / cs + iframeScrollY.value,
        width: cr.width / cs,
        height: cr.height / cs,
      };
    },
    onCapture: (captured) =>
      open({ captured, screen: { x: captured.last.right, y: captured.last.bottom }, auto: false }),
  });

  useIframeOverlay(frameRef, ({ win }) => {
    const onMouseUp = () => {
      if (!selectionCaptureArmed.value) return;
      const auto = activeTool.value !== 'selection';
      requestAnimationFrame(() => {
        // Rects arrive in frame coordinates, so the popover needs the frame's offset and scale applied.
        const sy = iframeScrollY.value;
        const captured = captureSelection({
          sel: win.getSelection?.() ?? null,
          toRect: (cr) => ({ x: cr.x, y: cr.y + sy, width: cr.width, height: cr.height }),
        });
        if (!captured) return;
        const inner = innerRef.current?.getBoundingClientRect();
        const cs = cssScale.value;
        const { right, bottom } = captured.last;
        const screen = inner ? { x: right * cs + inner.left, y: bottom * cs + inner.top } : { x: right, y: bottom };
        open({ captured, screen, auto });
      });
    };
    win.addEventListener('mouseup', onMouseUp);
    return () => {
      try {
        win.removeEventListener('mouseup', onMouseUp);
      } catch {
        /* the frame has navigated out of the proxy */
      }
    };
  });
}
