import { InspectorStackPanel } from '@ext/components/InspectorLayer';
import { MultiSelectPopover, SelectedOutline } from '@ext/components/MultiInspectLayer';
import { getSelector, snapshotElement } from '@ext/lib/selector';
import { activeTool, addToInspectorStack, inspectorStack, outputDetail, toast } from '@ext/lib/state';
import { useSignal, useSignalEffect } from '@preact/signals';
import { createPortal } from 'preact/compat';
import { useRef } from 'preact/hooks';
import { isElementNode, toViewportRect, useIframeOverlay, useIframeRectSync } from './iframeOverlay';
import { cssScale } from './signals';

interface DragState {
  startX: number;
  startY: number;
  curX: number;
  curY: number;
  initialEl: Element | null;
  dragged: boolean;
}

interface SelectedEl {
  el: Element;
  selector: string;
}

const DRAG_THRESHOLD = 4;

/** Pick elements inside the iframe doc whose viewport rect intersects the marquee. */
function elementsInMarqueeInDoc(
  doc: Document,
  rect: { left: number; top: number; right: number; bottom: number },
): Element[] {
  const all = doc.body.getElementsByTagName('*');
  const candidates: Element[] = [];
  const minIntersection = 0.5;
  for (const el of all) {
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    const ix = Math.max(0, Math.min(r.right, rect.right) - Math.max(r.left, rect.left));
    const iy = Math.max(0, Math.min(r.bottom, rect.bottom) - Math.max(r.top, rect.top));
    const ia = ix * iy;
    if (ia <= 0) continue;
    if (ia / (r.width * r.height) < minIntersection) continue;
    candidates.push(el);
  }
  const set = new Set(candidates);
  return candidates.filter((el) => {
    let p = el.parentElement;
    while (p) {
      if (set.has(p)) return false;
      p = p.parentElement;
    }
    return true;
  });
}

export function WebMultiInspectLayer({ frameRef }: { frameRef: { current: HTMLIFrameElement | null } }) {
  const drag = useSignal<DragState | null>(null);
  const selected = useSignal<SelectedEl[]>([]);
  // Bumped on iframe rect-sync events so outlines reposition with the page.
  const tick = useSignal(0);
  const winRef = useRef<Window | null>(null);
  const docRef = useRef<Document | null>(null);

  useIframeOverlay(frameRef, ({ win, doc }) => {
    winRef.current = win;
    docRef.current = doc;

    const onPointerDown = (e: PointerEvent) => {
      if (activeTool.value !== 'multiInspect') return;
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const initialEl =
        isElementNode(e.target) && e.target !== doc.body && e.target !== doc.documentElement ? e.target : null;
      drag.value = {
        startX: e.clientX,
        startY: e.clientY,
        curX: e.clientX,
        curY: e.clientY,
        initialEl,
        dragged: false,
      };
      const target = isElementNode(e.target) ? e.target : doc.documentElement;
      try {
        target.setPointerCapture?.(e.pointerId);
      } catch {
        /* capture is best-effort */
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      const d = drag.value;
      if (!d) return;
      e.preventDefault();
      const dragged = d.dragged || Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > DRAG_THRESHOLD;
      drag.value = { ...d, curX: e.clientX, curY: e.clientY, dragged };
    };

    const onPointerUp = (e: PointerEvent) => {
      const d = drag.value;
      if (!d) return;
      e.preventDefault();
      e.stopPropagation();
      drag.value = null;
      if (!d.dragged) {
        if (d.initialEl) toggleEl(d.initialEl);
        return;
      }
      const left = Math.min(d.startX, d.curX);
      const right = Math.max(d.startX, d.curX);
      const top = Math.min(d.startY, d.curY);
      const bottom = Math.max(d.startY, d.curY);
      const els = elementsInMarqueeInDoc(doc, { left, top, right, bottom });
      if (els.length) addElsToSelection(els);
    };

    // Suppress page click handlers (links, etc.) while in multi-select.
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

  const toggleEl = (el: Element) => {
    const cur = selected.value;
    const idx = cur.findIndex((s) => s.el === el);
    if (idx >= 0) selected.value = cur.slice(0, idx).concat(cur.slice(idx + 1));
    else selected.value = [...cur, { el, selector: getSelector(el) }];
  };

  const addElsToSelection = (els: Element[]) => {
    if (!els.length) return;
    const cur = selected.value;
    const have = new Set(cur.map((s) => s.el));
    const additions: SelectedEl[] = [];
    for (const el of els) {
      if (have.has(el)) continue;
      additions.push({ el, selector: getSelector(el) });
      have.add(el);
    }
    if (additions.length) selected.value = [...cur, ...additions];
  };

  // Reset state when leaving the tool.
  useSignalEffect(() => {
    if (activeTool.value !== 'multiInspect') {
      drag.value = null;
      selected.value = [];
    }
  });

  // Crosshair cursor inside the iframe while active.
  useSignalEffect(() => {
    if (activeTool.value !== 'multiInspect') return;
    const doc = frameRef.current?.contentDocument;
    if (!doc?.head) return;
    const style = doc.createElement('style');
    style.textContent = '*, *::before, *::after { cursor: crosshair !important; }';
    doc.head.appendChild(style);
    return () => style.remove();
  });

  // Reposition outlines on iframe scroll/scale/resize.
  useIframeRectSync(
    () => activeTool.value === 'multiInspect',
    () => {
      tick.value++;
    },
  );

  const submit = (comment: string) => {
    const items = selected.value;
    if (!items.length) return;
    const detail = outputDetail.value;
    for (const { el, selector } of items) {
      if (!el.isConnected) continue;
      const snap = snapshotElement(el, selector, el.getBoundingClientRect(), detail);
      addToInspectorStack({ selector, comment, markdown: snap.markdown });
    }
    selected.value = [];
    activeTool.value = 'navigate';
    const stackCount = inspectorStack.value.length;
    toast(`Added ${items.length} element${items.length === 1 ? '' : 's'} (${stackCount} in stack)`, 'success', 2200);
  };

  const cancel = () => {
    selected.value = [];
  };

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
    const left = Math.min(d.startX, d.curX);
    const top = Math.min(d.startY, d.curY);
    const width = Math.abs(d.curX - d.startX);
    const height = Math.abs(d.curY - d.startY);
    marquee = { left: fr.left + left * s, top: fr.top + top * s, width: width * s, height: height * s };
  }

  // Selected outlines + bounding rect for popover anchor (host viewport coords).
  let boundingRect: { left: number; top: number; right: number; bottom: number } | null = null;
  const outlineRects: DOMRect[] = [];
  for (const { el } of sel) {
    if (!el.isConnected || !frame) continue;
    const r = toViewportRect(frame, el);
    outlineRects.push(r);
    if (!boundingRect) {
      boundingRect = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    } else {
      boundingRect.left = Math.min(boundingRect.left, r.left);
      boundingRect.top = Math.min(boundingRect.top, r.top);
      boundingRect.right = Math.max(boundingRect.right, r.right);
      boundingRect.bottom = Math.max(boundingRect.bottom, r.bottom);
    }
  }

  return createPortal(
    <>
      {outlineRects.map((r, i) => (
        <SelectedOutline key={i} rect={r} />
      ))}

      {marquee && (
        <div
          class="fixed z-2147483646 pointer-events-none rounded-[3px]"
          style={{
            left: marquee.left,
            top: marquee.top,
            width: marquee.width,
            height: marquee.height,
            background: 'color-mix(in oklch, var(--ml-state-green) 8%, transparent)',
            boxShadow:
              '0 0 0 1.5px color-mix(in oklch, var(--ml-state-green) 90%, transparent), 0 0 16px color-mix(in oklch, var(--ml-state-green) 18%, transparent)',
          }}
        />
      )}

      {sel.length > 0 && !d && (
        <MultiSelectPopover count={sel.length} rect={boundingRect} onCommit={submit} onCancel={cancel} />
      )}

      <InspectorStackPanel />
    </>,
    document.body,
  );
}
