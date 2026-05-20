import {
  GUIDE_HIT_PX,
  GuideHint,
  GuideLine,
  GuidePill,
  GuidePositionTag,
  GuidePreview,
} from '@ext/components/GuideLayer';
import { injectCrosshairCursor } from '@ext/lib/dom';
import { pickGuideAtPoint } from '@ext/lib/measure';
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
import { cssScale, iframeScrollY } from './signals';

export function WebGuideLayer({ frameRef }: { frameRef: { current: HTMLIFrameElement | null } }) {
  const cursor = useSignal<{ x: number; y: number } | null>(null);
  const shift = useSignal(false);
  const dragId = useSignal<string | null>(null);

  const toIframeDoc = (x: number, y: number) => {
    const win = frameRef.current?.contentWindow;
    return { x: x + (win?.scrollX ?? 0), y: y + (win?.scrollY ?? 0) };
  };

  const toHostViewport = (x: number, y: number): { x: number; y: number } => {
    const frame = frameRef.current;
    if (!frame) return { x, y };
    const fr = frame.getBoundingClientRect();
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
    if (e.target instanceof Element && e.target.closest('[data-marklayer-overlay]')) return;
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
    win.addEventListener('mousemove', onMove, true);
    win.addEventListener('mousedown', onDown, true);
    win.addEventListener('mouseup', onUp, true);
    const unbindDown = tinykeys(win as Window, keyBindings);
    const unbindUp = tinykeys(win as Window, keyBindingsUp, { event: 'keyup' });
    return () => {
      try {
        win.removeEventListener('mousemove', onMove, true);
        win.removeEventListener('mousedown', onDown, true);
        win.removeEventListener('mouseup', onUp, true);
      } catch {
        /* iframe may have navigated */
      }
      unbindDown();
      unbindUp();
    };
  });

  // Host fallback: catches keys and (if focus is outside the iframe) mouse events.
  // Cleanup also doubles as the tool-switch state reset.
  useSignalEffect(() => {
    if (activeTool.value !== 'guide') return;
    const hostToIframeLocal = (hostX: number, hostY: number) => {
      const frame = frameRef.current;
      if (!frame) return null;
      const fr = frame.getBoundingClientRect();
      const inside = hostX >= fr.left && hostX <= fr.right && hostY >= fr.top && hostY <= fr.bottom;
      const s = cssScale.value;
      return { x: (hostX - fr.left) / s, y: (hostY - fr.top) / s, inside };
    };
    const onMove = (e: MouseEvent) => {
      const local = hostToIframeLocal(e.clientX, e.clientY);
      if (!local) return;
      handlePointerMove(local.x, local.y);
    };
    const onDown = (e: MouseEvent) => {
      const local = hostToIframeLocal(e.clientX, e.clientY);
      if (!local?.inside) return;
      handlePointerDown(e, local.x, local.y);
    };
    const onUp = () => {
      dragId.value = null;
    };
    const onBlur = () => {
      shift.value = false;
      dragId.value = null;
    };
    window.addEventListener('mousemove', onMove, true);
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('mouseup', onUp, true);
    window.addEventListener('blur', onBlur);
    const unbindDown = tinykeys(window, keyBindings);
    const unbindUp = tinykeys(window, keyBindingsUp, { event: 'keyup' });
    return () => {
      window.removeEventListener('mousemove', onMove, true);
      window.removeEventListener('mousedown', onDown, true);
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
    if (!target && cur2) {
      const f = frameRef.current;
      const r = f?.getBoundingClientRect();
      const sc = cssScale.value;
      const w = f?.contentWindow;
      if (r) {
        const pt = { x: (cur2.x - r.left) / sc + (w?.scrollX ?? 0), y: (cur2.y - r.top) / sc + (w?.scrollY ?? 0) };
        target = pickGuideAtPoint(pt, guides.value, GUIDE_HIT_PX) ?? null;
      }
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

  const frame = frameRef.current;
  const fr = frame?.getBoundingClientRect();
  const s = cssScale.value;
  const win = frame?.contentWindow;
  const docCursor =
    cur && fr
      ? { x: (cur.x - fr.left) / s + (win?.scrollX ?? 0), y: (cur.y - fr.top) / s + (win?.scrollY ?? 0) }
      : null;
  const docToHost = (ori: Orientation, docPos: number): number => {
    if (!fr) return docPos;
    return ori === 'vertical'
      ? fr.left + (docPos - (win?.scrollX ?? 0)) * s
      : fr.top + (docPos - (win?.scrollY ?? 0)) * s;
  };
  const hoveredGuide = docCursor ? pickGuideAtPoint(docCursor, guides.value, GUIDE_HIT_PX) : null;
  const showPreview = isGuideTool && !dragging && cur && !hoveredGuide;
  const selected = guides.value.find((g) => g.id === selectedGuideId.value) ?? null;
  const dragGuide = dragId.value ? guides.value.find((g) => g.id === dragId.value) : null;
  const bounds = fr ? { top: fr.top, left: fr.left, width: fr.width, height: fr.height } : undefined;

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
      {isGuideTool && cur && dragGuide && (
        <GuidePositionTag
          x={cur.x}
          y={cur.y}
          text={`${dragGuide.orientation === 'vertical' ? 'x' : 'y'}: ${Math.round(dragGuide.position)}px`}
        />
      )}
      {isGuideTool && selected && !dragging && (
        <GuidePill
          orientation={selected.orientation}
          screenPosition={docToHost(selected.orientation, selected.position)}
          bounds={bounds}
          onFlip={(e) => {
            if (!fr) return;
            const iframeX = (e.clientX - fr.left) / s;
            const iframeY = (e.clientY - fr.top) / s;
            const newPos =
              selected.orientation === 'vertical' ? iframeY + (win?.scrollY ?? 0) : iframeX + (win?.scrollX ?? 0);
            flipGuide(selected.id, newPos);
          }}
          onDelete={() => removeGuide(selected.id)}
        />
      )}
    </>,
    document.body,
  );
}
