import { cn } from '@marklayer/types';
import { useSignal, useSignalEffect } from '@preact/signals';
import type { TargetedEvent } from 'preact';
import { useCallback, useRef } from 'preact/hooks';
import { secondaryBtn, submitBtn, textareaCls } from '../lib/buttons';
import { glass } from '../lib/glass';
import { getSelector, isExtensionElement, pickElementAtPoint, snapshotElement } from '../lib/selector';
import { activeTool, addToInspectorStack, inspectorStack, outputDetail, toast } from '../lib/state';

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
function elementsInMarquee(rect: { left: number; top: number; right: number; bottom: number }): Element[] {
  const all = document.body.getElementsByTagName('*');
  const candidates: Element[] = [];
  const minIntersection = 0.5;
  for (const el of all) {
    if (isExtensionElement(el)) continue;
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

export function SelectedOutline({ rect }: { rect: DOMRect }) {
  return (
    <div
      class="fixed pointer-events-none rounded-sm
             animate-[fadeIn_140ms_ease-out]"
      style={{
        left: rect.left - 2,
        top: rect.top - 2,
        width: rect.width + 4,
        height: rect.height + 4,
        background: 'color-mix(in oklch, var(--ml-state-green) 12%, transparent)',
        boxShadow:
          '0 0 0 1.5px var(--ml-state-green), 0 0 0 4px color-mix(in oklch, var(--ml-state-green) 18%, transparent), 0 0 18px color-mix(in oklch, var(--ml-state-green) 22%, transparent)',
      }}
    />
  );
}

export function MultiSelectPopover({
  count,
  rect,
  onCommit,
  onCancel,
}: {
  count: number;
  /** Anchor rect (the marquee, in viewport coords) to position the popover near. */
  rect: { left: number; top: number; right: number; bottom: number } | null;
  onCommit: (comment: string) => void;
  onCancel: () => void;
}) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const setTaRef = useCallback((el: HTMLTextAreaElement | null) => {
    taRef.current = el;
    el?.focus();
  }, []);

  const panelW = 300;
  const margin = 12;
  const cx = rect ? (rect.left + rect.right) / 2 : innerWidth / 2;
  const left = Math.max(margin, Math.min(cx - panelW / 2, innerWidth - panelW - margin));
  const top = rect
    ? Math.max(margin, Math.min(rect.bottom + 16, innerHeight - 200 - margin))
    : Math.max(margin, innerHeight / 2 - 80);

  return (
    <div
      class={cn(
        'fixed z-2147483647 pointer-events-auto w-[300px] flex flex-col overflow-hidden',
        'animate-[fadeInDown_180ms_cubic-bezier(0.16,1,0.3,1)]',
        glass.surface,
        glass.font,
      )}
      style={{ left, top }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div class="px-4 pt-3.5 pb-1.5 flex items-center justify-between">
        <span class="text-[10.5px] text-ml-glass-fg/65 font-bold uppercase tracking-[0.08em]">
          {count} element{count === 1 ? '' : 's'} selected
        </span>
        <span
          class="inline-flex items-center justify-center w-2 h-2 rounded-full"
          style={{
            background: 'var(--ml-state-green)',
            boxShadow: '0 0 0 3px color-mix(in oklch, var(--ml-state-green) 22%, transparent)',
          }}
          role="img"
          aria-label="Multi-select active"
          title="Multi-select active — your note will apply to every highlighted element."
        />
      </div>

      <div class="px-3.5 pb-2.5">
        <textarea
          ref={setTaRef}
          placeholder="What should change across these elements?"
          rows={2}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              onCommit(taRef.current?.value.trim() ?? '');
            } else if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              onCancel();
            }
          }}
          class={cn(textareaCls, 'w-full min-h-10 max-h-[120px]', glass.font)}
          style={{ fieldSizing: 'content', boxSizing: 'border-box' }}
        />
      </div>

      <div class={cn(glass.divider, 'mx-3.5')} />

      <div class="flex items-center justify-between gap-2 px-3 py-2.5">
        <button
          type="button"
          onClick={onCancel}
          class={cn(secondaryBtn, 'border-transparent hover:border-transparent')}
        >
          Cancel
        </button>
        <button type="button" onClick={() => onCommit(taRef.current?.value.trim() ?? '')} class={submitBtn}>
          Add ↵
        </button>
      </div>
    </div>
  );
}

export function MultiInspectLayer() {
  const drag = useSignal<DragState | null>(null);
  const selected = useSignal<SelectedEl[]>([]);
  /** Bumped on scroll/resize so outlines reposition with the page. */
  const tick = useSignal(0);

  // Reset selection whenever the user leaves this tool.
  useSignalEffect(() => {
    if (activeTool.value !== 'multiInspect') {
      selected.value = [];
      drag.value = null;
    }
  });

  // Keep outlines glued to elements during scroll/resize.
  useSignalEffect(() => {
    if (activeTool.value !== 'multiInspect') return;
    const onScroll = () => {
      tick.value++;
    };
    window.addEventListener('scroll', onScroll, { passive: true, capture: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  });

  // Crosshair cursor while active.
  useSignalEffect(() => {
    if (activeTool.value !== 'multiInspect') return;
    document.body.style.cursor = 'crosshair';
    return () => {
      document.body.style.cursor = '';
    };
  });

  const toggleEl = (el: Element) => {
    if (isExtensionElement(el)) return;
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

  const onPointerDown = (e: TargetedEvent<HTMLDivElement, PointerEvent>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const initialEl = pickElementAtPoint(e.clientX, e.clientY);
    drag.value = {
      startX: e.clientX,
      startY: e.clientY,
      curX: e.clientX,
      curY: e.clientY,
      initialEl,
      dragged: false,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: TargetedEvent<HTMLDivElement, PointerEvent>) => {
    const d = drag.value;
    if (!d) return;
    const dragged = d.dragged || Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > DRAG_THRESHOLD;
    drag.value = { ...d, curX: e.clientX, curY: e.clientY, dragged };
  };

  const onPointerUp = (e: TargetedEvent<HTMLDivElement, PointerEvent>) => {
    const d = drag.value;
    if (!d) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    drag.value = null;
    if (!d.dragged) {
      // Click — toggle the element under the original pointerdown. ⌘/⇧/Alt
      // are no-ops here (every click in this tool is additive by design),
      // but holding Alt is a shortcut to "remove only" if it's already in.
      if (d.initialEl) toggleEl(d.initialEl);
      return;
    }
    const left = Math.min(d.startX, d.curX);
    const right = Math.max(d.startX, d.curX);
    const top = Math.min(d.startY, d.curY);
    const bottom = Math.max(d.startY, d.curY);
    const els = elementsInMarquee({ left, top, right, bottom });
    if (els.length) addElsToSelection(els);
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

  // Marquee preview (only render once we've crossed the click→drag threshold).
  let marquee: { left: number; top: number; width: number; height: number } | null = null;
  if (d?.dragged) {
    marquee = {
      left: Math.min(d.startX, d.curX),
      top: Math.min(d.startY, d.curY),
      width: Math.abs(d.curX - d.startX),
      height: Math.abs(d.curY - d.startY),
    };
  }

  // Bounding rect across all selected elements — used to anchor the popover.
  let boundingRect: { left: number; top: number; right: number; bottom: number } | null = null;
  for (const { el } of sel) {
    if (!el.isConnected) continue;
    const r = el.getBoundingClientRect();
    if (!boundingRect) {
      boundingRect = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    } else {
      boundingRect.left = Math.min(boundingRect.left, r.left);
      boundingRect.top = Math.min(boundingRect.top, r.top);
      boundingRect.right = Math.max(boundingRect.right, r.right);
      boundingRect.bottom = Math.max(boundingRect.bottom, r.bottom);
    }
  }

  return (
    <>
      <div
        data-marklayer-inspect=""
        class="fixed inset-0 z-2147483645"
        style={{ cursor: 'crosshair', touchAction: 'none' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />

      {sel.map(({ el, selector }) =>
        el.isConnected ? <SelectedOutline key={selector} rect={el.getBoundingClientRect()} /> : null,
      )}

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
    </>
  );
}
