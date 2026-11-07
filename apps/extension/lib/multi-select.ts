import { useSignal, useSignalEffect } from '@preact/signals';
import { track } from './analytics';
import { addToInspectorStack, inspectorStack } from './inspector-stack';
import { outputDetail } from './prefs';
import { getSelector, snapshotElement } from './selector';
import { toast } from './toasts';
import { activeTool } from './tool-state';

export interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface DragState {
  startX: number;
  startY: number;
  curX: number;
  curY: number;
  /** Element captured at pointerdown — used when the gesture turns out to be a click, not a drag. */
  initialEl: Element | null;
  /** Whether this gesture has crossed the click→drag threshold. */
  dragged: boolean;
}

interface SelectedEl {
  el: Element;
  selector: string;
}

const DRAG_THRESHOLD = 4;

/**
 * Pick elements intersecting the marquee, then drop any that have an ancestor
 * also in the set — otherwise users get the row AND the row's text node wrapper
 * AND the parent list, which is rarely what they want.
 */
function elementsInMarquee({
  doc,
  rect,
  skip,
}: {
  doc: Document;
  rect: Bounds;
  skip?: (el: Element) => boolean;
}): Element[] {
  const all = doc.body.getElementsByTagName('*');
  const candidates: Element[] = [];
  const minIntersection = 0.5;
  for (const el of all) {
    if (skip?.(el)) continue;
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

const dragBounds = (d: DragState): Bounds => ({
  left: Math.min(d.startX, d.curX),
  top: Math.min(d.startY, d.curY),
  right: Math.max(d.startX, d.curX),
  bottom: Math.max(d.startY, d.curY),
});

/** The marquee as a box, in the coords the pointer reported. */
export function marqueeBox(d: DragState) {
  const { left, top, right, bottom } = dragBounds(d);
  return { left, top, width: right - left, height: bottom - top };
}

/** The rect enclosing all of `rects`, which is what the popover anchors to. */
export function boundsOf(rects: Bounds[]): Bounds | null {
  let bounds: Bounds | null = null;
  for (const r of rects) {
    bounds = bounds
      ? {
          left: Math.min(bounds.left, r.left),
          top: Math.min(bounds.top, r.top),
          right: Math.max(bounds.right, r.right),
          bottom: Math.max(bounds.bottom, r.bottom),
        }
      : { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  }
  return bounds;
}

/**
 * The multi-inspect tool's selection and marquee gesture. Pointer wiring stays with the
 * host: the extension listens on its own overlay, the viewer inside the framed page.
 */
export function useMultiSelect({ skip }: { skip?: (el: Element) => boolean } = {}) {
  const drag = useSignal<DragState | null>(null);
  const selected = useSignal<SelectedEl[]>([]);

  useSignalEffect(() => {
    if (activeTool.value !== 'multiInspect') {
      selected.value = [];
      drag.value = null;
    }
  });

  const toggleEl = (el: Element) => {
    if (skip?.(el)) return;
    const cur = selected.value;
    const idx = cur.findIndex((s) => s.el === el);
    if (idx >= 0) {
      selected.value = cur.slice(0, idx).concat(cur.slice(idx + 1));
    } else {
      selected.value = [...cur, { el, selector: getSelector(el) }];
    }
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

  const press = ({ x, y, el }: { x: number; y: number; el: Element | null }) => {
    drag.value = { startX: x, startY: y, curX: x, curY: y, initialEl: el, dragged: false };
  };

  const moveTo = (x: number, y: number) => {
    const d = drag.value;
    if (!d) return;
    const dragged = d.dragged || Math.hypot(x - d.startX, y - d.startY) > DRAG_THRESHOLD;
    drag.value = { ...d, curX: x, curY: y, dragged };
  };

  const release = (doc: Document) => {
    const d = drag.value;
    if (!d) return;
    drag.value = null;
    if (!d.dragged) {
      // A click toggles the element under the original pointerdown; modifiers change nothing.
      if (d.initialEl) toggleEl(d.initialEl);
      return;
    }
    const els = elementsInMarquee({ doc, rect: dragBounds(d), skip });
    if (els.length) {
      addElsToSelection(els);
      track('multi_inspect_marquee_used', { matched: els.length });
    }
  };

  const submit = (comment: string) => {
    const items = selected.value;
    if (!items.length) return;
    const detail = outputDetail.value;
    for (const { el, selector } of items) {
      if (!el.isConnected) continue;
      const snap = snapshotElement(el, selector, el.getBoundingClientRect(), detail);
      addToInspectorStack({ selector, comment, markdown: snap.markdown });
    }
    track('multi_inspect_submitted', { elements: items.length, has_note: comment.length > 0 });
    selected.value = [];
    activeTool.value = 'navigate';
    const stackCount = inspectorStack.value.length;
    toast(`Added ${items.length} element${items.length === 1 ? '' : 's'} (${stackCount} in stack)`, {
      type: 'success',
      duration: 2200,
    });
  };

  const cancel = () => {
    track('multi_inspect_cancelled', { elements: selected.peek().length });
    selected.value = [];
  };

  return { drag, selected, press, moveTo, release, submit, cancel };
}
