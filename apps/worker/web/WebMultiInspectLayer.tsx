import { InspectorStackPanel } from '@ext/components/InspectorLayer';
import { MarqueeBox, MultiSelectPopover, SelectedOutline } from '@ext/components/MultiInspectLayer';
import { injectCrosshairCursor } from '@ext/lib/dom';
import { boundsOf, marqueeBox, useMultiSelect } from '@ext/lib/multi-select';
import { activeTool } from '@ext/lib/tool-state';
import { useSignal, useSignalEffect } from '@preact/signals';
import { createPortal } from 'preact/compat';
import { isElementNode, toViewportRect, useIframeOverlay, useIframeRectSync } from './iframeOverlay';
import { cssScale } from './viewer-state';

export function WebMultiInspectLayer({ frameRef }: { frameRef: { current: HTMLIFrameElement | null } }) {
  const { drag, selected, press, moveTo, release, submit, cancel } = useMultiSelect();
  // Bumped on iframe rect-sync events so outlines reposition with the page.
  const tick = useSignal(0);

  useIframeOverlay(frameRef, ({ win, doc }) => {
    const onPointerDown = (e: PointerEvent) => {
      if (activeTool.value !== 'multiInspect') return;
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const initialEl =
        isElementNode(e.target) && e.target !== doc.body && e.target !== doc.documentElement ? e.target : null;
      press({ x: e.clientX, y: e.clientY, el: initialEl });
      const target = isElementNode(e.target) ? e.target : doc.documentElement;
      try {
        target.setPointerCapture?.(e.pointerId);
      } catch {
        /* capture is best-effort */
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!drag.value) return;
      e.preventDefault();
      moveTo(e.clientX, e.clientY);
    };

    const onPointerUp = (e: PointerEvent) => {
      if (!drag.value) return;
      e.preventDefault();
      e.stopPropagation();
      release(doc);
    };

    const onClick = (e: MouseEvent) => {
      if (activeTool.value !== 'multiInspect') return;
      e.preventDefault();
      e.stopPropagation();
    };

    win.addEventListener('pointerdown', onPointerDown, true);
    win.addEventListener('pointermove', onPointerMove, true);
    win.addEventListener('pointerup', onPointerUp, true);
    win.addEventListener('pointercancel', onPointerUp, true);
    win.addEventListener('click', onClick, true);
    return () => {
      try {
        win.removeEventListener('pointerdown', onPointerDown, true);
        win.removeEventListener('pointermove', onPointerMove, true);
        win.removeEventListener('pointerup', onPointerUp, true);
        win.removeEventListener('pointercancel', onPointerUp, true);
        win.removeEventListener('click', onClick, true);
      } catch {
        /* iframe may have navigated */
      }
    };
  });

  useSignalEffect(() => {
    if (activeTool.value !== 'multiInspect') return;
    return injectCrosshairCursor(frameRef.current?.contentDocument);
  });

  useIframeRectSync(
    () => activeTool.value === 'multiInspect',
    () => {
      tick.value++;
    },
  );

  if (activeTool.value !== 'multiInspect') return null;

  // Read tick so outlines reposition on scroll/resize.
  tick.value;
  const sel = selected.value;
  const d = drag.value;
  const frame = frameRef.current;

  // Marquee preview, in iframe-viewport coords → host viewport coords.
  let marquee: { left: number; top: number; width: number; height: number } | null = null;
  if (d?.dragged && frame) {
    const fr = frame.getBoundingClientRect();
    const s = cssScale.value;
    const { left, top, width, height } = marqueeBox(d);
    marquee = { left: fr.left + left * s, top: fr.top + top * s, width: width * s, height: height * s };
  }

  // Selected outlines + bounding rect for popover anchor (host viewport coords).
  const outlineRects = frame ? sel.filter(({ el }) => el.isConnected).map(({ el }) => toViewportRect(frame, el)) : [];
  const boundingRect = boundsOf(outlineRects);

  return createPortal(
    <>
      {outlineRects.map((r, i) => (
        <SelectedOutline key={i} rect={r} />
      ))}

      {marquee && <MarqueeBox box={marquee} />}

      {sel.length > 0 && !d && (
        <MultiSelectPopover count={sel.length} rect={boundingRect} onCommit={submit} onCancel={cancel} />
      )}

      <InspectorStackPanel />
    </>,
    document.body,
  );
}
