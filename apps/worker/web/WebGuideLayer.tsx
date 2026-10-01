import {
  GUIDE_HIT_PX,
  GuideHint,
  GuideLine,
  GuidePill,
  GuidePositionTag,
  GuidePreview,
  guideReadout,
} from '@ext/components/GuideLayer';
import { injectCrosshairCursor } from '@ext/lib/dom';
import { pickGuideAtPoint } from '@ext/lib/measure';
import { scrollOffset } from '@ext/lib/scroller';
import {
  activeTool,
  addGuide,
  clearGuides,
  flipGuide,
  guides,
  type Orientation,
  removeGuide,
  selectedGuideId,
  undo,
  updateGuide,
} from '@ext/lib/state';
import { useComputed, useSignal, useSignalEffect } from '@preact/signals';
import { createPortal } from 'preact/compat';
import { tinykeys } from 'tinykeys';
import { isElementNode, useIframeOverlay } from './iframeOverlay';
import { cssScale, frameRect, iframeScrollY } from './signals';

/** The frame's scroll offset, or none while the frame is not up. */
const off = (win: Window | null | undefined) => (win ? scrollOffset(win) : { x: 0, y: 0 });

export function WebGuideLayer({ frameRef }: { frameRef: { current: HTMLIFrameElement | null } }) {
  const cursor = useSignal<{ x: number; y: number } | null>(null);
  const shift = useSignal(false);
  const dragId = useSignal<string | null>(null);

  const toIframeDoc = (x: number, y: number) => {
    const win = frameRef.current?.contentWindow;
    return { x: x + off(win).x, y: y + off(win).y };
  };

  const toHostViewport = (x: number, y: number): { x: number; y: number } => {
    const fr = frameRect.peek();
    if (!fr) return { x, y };
    const s = cssScale.value;
    return { x: fr.left + x * s, y: fr.top + y * s };
  };

  const handlePointerMove = (iframeX: number, iframeY: number) => {
    if (activeTool.value !== 'guide') return;
    cursor.value = toHostViewport(iframeX, iframeY);
    const id = dragId.peek();
    if (id) {
      const g = guides.peek().find((p) => p.id === id);
      if (g) {
        const doc = toIframeDoc(iframeX, iframeY);
        updateGuide(id, g.orientation === 'vertical' ? doc.x : doc.y);
      }
    }
  };

  const handlePointerDown = (e: MouseEvent, iframeX: number, iframeY: number) => {
    if (activeTool.value !== 'guide') return;
    e.preventDefault();
    e.stopPropagation();
    const docPoint = toIframeDoc(iframeX, iframeY);
    const hit = pickGuideAtPoint(docPoint, guides.peek(), GUIDE_HIT_PX);
    if (hit) {
      selectedGuideId.value = hit.id;
      dragId.value = hit.id;
      return;
    }
    const orientation = e.shiftKey ? 'vertical' : 'horizontal';
    const position = orientation === 'vertical' ? docPoint.x : docPoint.y;
    const g = addGuide(orientation, position);
    selectedGuideId.value = g.id;
    dragId.value = g.id;
  };

  const deleteSelected = (e: KeyboardEvent) => {
    if (activeTool.value !== 'guide') return;
    const sel = selectedGuideId.peek() ?? guides.peek().at(-1)?.id;
    if (!sel) return;
    e.preventDefault();
    e.stopPropagation();
    removeGuide(sel);
  };
  const popLastGuide = (e: KeyboardEvent) => {
    if (activeTool.value !== 'guide' || !guides.peek().length) return;
    e.preventDefault();
    e.stopPropagation();
    undo();
  };
  const keyBindings = {
    Shift: () => {
      if (activeTool.value === 'guide') shift.value = true;
    },
    Escape: (e: KeyboardEvent) => {
      if (activeTool.value !== 'guide' || !guides.peek().length) return;
      e.preventDefault();
      e.stopPropagation();
      clearGuides();
    },
    Backspace: deleteSelected,
    Delete: deleteSelected,
    '$mod+KeyZ': popLastGuide,
  };
  const keyBindingsUp = {
    Shift: () => {
      shift.value = false;
    },
  };

  useIframeOverlay(frameRef, ({ win }) => {
    const onMove = (e: MouseEvent) => handlePointerMove(e.clientX, e.clientY);
    const onDown = (e: MouseEvent) => {
      if (!isElementNode(e.target)) return;
      handlePointerDown(e, e.clientX, e.clientY);
    };
    const onUp = () => {
      dragId.value = null;
    };
    // Off the frame, onto our chrome or out of the window: no line to place there.
    const onOut = (e: MouseEvent) => {
      if (!e.relatedTarget && !dragId.peek()) cursor.value = null;
    };
    win.addEventListener('mousemove', onMove, true);
    win.addEventListener('mouseout', onOut, true);
    win.addEventListener('mousedown', onDown, true);
    win.addEventListener('mouseup', onUp, true);
    const unbindDown = tinykeys(win as Window, keyBindings);
    const unbindUp = tinykeys(win as Window, keyBindingsUp, { event: 'keyup' });
    return () => {
      try {
        win.removeEventListener('mousemove', onMove, true);
        win.removeEventListener('mouseout', onOut, true);
        win.removeEventListener('mousedown', onDown, true);
        win.removeEventListener('mouseup', onUp, true);
        unbindDown();
        unbindUp();
      } catch {
        /* iframe may have navigated cross-origin */
      }
    };
  });

  // Keys follow focus, so they bind here too; the pointer stays with the frame. Over it the
  // host only ever hears our own chrome, and reading that as the page dropped a guide under
  // every click in a menu. Cleanup doubles as the tool-switch state reset.
  useSignalEffect(() => {
    if (activeTool.value !== 'guide') return;
    const onUp = () => {
      dragId.value = null;
    };
    const onBlur = () => {
      shift.value = false;
      dragId.value = null;
    };
    window.addEventListener('mouseup', onUp, true);
    window.addEventListener('blur', onBlur);
    const unbindDown = tinykeys(window, keyBindings);
    const unbindUp = tinykeys(window, keyBindingsUp, { event: 'keyup' });
    return () => {
      window.removeEventListener('mouseup', onUp, true);
      window.removeEventListener('blur', onBlur);
      unbindDown();
      unbindUp();
      cursor.value = null;
      shift.value = false;
      dragId.value = null;
      selectedGuideId.value = null;
    };
  });

  useSignalEffect(() => {
    if (activeTool.value !== 'guide') return;
    return injectCrosshairCursor(frameRef.current?.contentDocument);
  });

  // Memoized so the cursor-injection effect only re-fires when the resulting
  // cursor string actually changes — not on every mousemove tick.
  const guideCursor = useComputed<'ew-resize' | 'ns-resize' | null>(() => {
    if (activeTool.value !== 'guide') return null;
    const id = dragId.value;
    const dragged = id ? guides.value.find((g) => g.id === id) : null;
    let target: { orientation: Orientation } | null | undefined = dragged;
    const cur2 = cursor.value;
    const r = frameRect.value;
    if (!target && cur2 && r) {
      const sc = cssScale.value;
      const w = frameRef.current?.contentWindow;
      const pt = { x: (cur2.x - r.left) / sc + off(w).x, y: (cur2.y - r.top) / sc + off(w).y };
      target = pickGuideAtPoint(pt, guides.value, GUIDE_HIT_PX) ?? null;
    }
    if (!target) return null;
    return target.orientation === 'vertical' ? 'ew-resize' : 'ns-resize';
  });
  useSignalEffect(() => {
    const c = guideCursor.value;
    if (!c) return;
    const doc = frameRef.current?.contentDocument;
    if (!doc?.head) return;
    const style = doc.createElement('style');
    style.textContent = `*, *::before, *::after { cursor: ${c} !important; }`;
    doc.head.appendChild(style);
    return () => style.remove();
  });

  const isGuideTool = activeTool.value === 'guide';
  const cur = cursor.value;
  const orientation = shift.value ? 'vertical' : 'horizontal';
  const previewPos = cur ? (orientation === 'vertical' ? cur.x : cur.y) : 0;
  const dragging = !!dragId.value;

  void iframeScrollY.value;

  const bounds = frameRect.value;
  if (!bounds) return null;
  const s = cssScale.value;
  const win = frameRef.current?.contentWindow;
  const docCursor = cur
    ? { x: (cur.x - bounds.left) / s + off(win).x, y: (cur.y - bounds.top) / s + off(win).y }
    : null;
  const docToHost = (ori: Orientation, docPos: number): number =>
    ori === 'vertical' ? bounds.left + (docPos - off(win).x) * s : bounds.top + (docPos - off(win).y) * s;
  const hoveredGuide = docCursor ? pickGuideAtPoint(docCursor, guides.value, GUIDE_HIT_PX) : null;
  const showPreview = isGuideTool && !dragging && cur && !hoveredGuide;
  const selected = guides.value.find((g) => g.id === selectedGuideId.value) ?? null;
  const dragGuide = dragId.value ? guides.value.find((g) => g.id === dragId.value) : null;
  const readout = guideReadout({ dragGuide, orientation, preview: showPreview ? docCursor : null });

  return createPortal(
    <>
      {isGuideTool && !guides.value.length && !dragging && <GuideHint bounds={bounds} />}
      {guides.value.map((g) => (
        <GuideLine
          key={g.id}
          orientation={g.orientation}
          screenPosition={docToHost(g.orientation, g.position)}
          selected={g.id === selectedGuideId.value}
          hovered={isGuideTool && (g.id === hoveredGuide?.id || g.id === dragId.value)}
          bounds={bounds}
        />
      ))}
      {showPreview && <GuidePreview orientation={orientation} position={previewPos} bounds={bounds} />}
      {isGuideTool && cur && readout && <GuidePositionTag x={cur.x} y={cur.y} text={readout} />}
      {isGuideTool && selected && !dragging && (
        <GuidePill
          orientation={selected.orientation}
          screenPosition={docToHost(selected.orientation, selected.position)}
          bounds={bounds}
          onFlip={(e) => {
            const iframeX = (e.clientX - bounds.left) / s;
            const iframeY = (e.clientY - bounds.top) / s;
            const newPos = selected.orientation === 'vertical' ? iframeY + off(win).y : iframeX + off(win).x;
            flipGuide(selected.id, newPos);
          }}
          onDelete={() => removeGuide(selected.id)}
        />
      )}
    </>,
    document.body,
  );
}
