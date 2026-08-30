import { Toggle } from '@base-ui/react/toggle';
import { Toolbar as BaseToolbar } from '@base-ui/react/toolbar';
import { cn } from '@marklayer/types';
import { signal, useSignalEffect } from '@preact/signals';
import type { ComponentChildren, RefObject } from 'preact';
import { useCallback, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { track } from '../lib/analytics';
import { geist } from '../lib/geist';
import { glass } from '../lib/glass';
import { Icon } from '../lib/icons';
import { prefersReducedMotion } from '../lib/media';
import {
  activeTool,
  clearAll,
  color,
  colorName,
  connectionStatus,
  ensureScrollTickListener,
  inspectorStack,
  isDrawingActive,
  moveTool,
  operations,
  redo,
  SHORTCUTS,
  scrollTick,
  selectTool,
  showSettings,
  showShareDialog,
  toggleToolbarMinimized,
  toolbarMinimized,
  toolOrder,
  undo,
} from '../lib/state';
import type { Tool } from '../lib/types';
import { SettingsPanel } from './SettingsPanel';
import { Tooltip } from './Tooltip';

/** Geist icon metrics: 16px on a 1.5 stroke, the weight Geist draws at. */
const GLYPH = { size: 16, strokeWidth: 1.5 } as const;

/**
 * A toolbar action. `Toolbar.Button` is what carries the roving tabindex, so
 * the whole bar is one tab stop with arrow keys moving between controls — we
 * only dress it.
 */
function Ctl({
  icon,
  children,
  tip,
  shortcut,
  onClick,
  on,
  anchor,
  action,
}: {
  icon?: string;
  /** A glyph other than an icon — the colour swatch is the only one so far. */
  children?: ComponentChildren;
  tip: string;
  shortcut?: string;
  onClick: () => void;
  /** Selected — Geist's inverted primary fill. */
  on?: boolean;
  anchor?: string;
  /**
   * What this control is, for the toolbar usage count. Omitted where the action
   * reports itself from `lib/state` — undo, redo, clear and the settings panel
   * all have keyboard and off-toolbar paths that a button here cannot see.
   */
  action?: string;
}) {
  return (
    <BaseToolbar.Button
      onClick={() => {
        if (action) track('toolbar_action', { action });
        onClick();
      }}
      aria-label={tip}
      data-ml-anchor={anchor}
      className={cn(geist.ctl, on ? geist.ctlOn : geist.ctlIdle)}
    >
      {children ?? (icon && <Icon name={icon} {...GLYPH} />)}
      <Tooltip text={tip} shortcut={shortcut} />
    </BaseToolbar.Button>
  );
}

/**
 * A tool in the picker. `Toggle` carries the `aria-pressed` semantics; the
 * pressed state itself is read from `activeTool`, so there is one source of
 * truth for which tool is selected.
 */
function ToolToggle({
  tool,
  tip,
  shortcut,
  reorderIndex,
  onReorderPointerDown,
  onSelect,
  draggingTool,
}: {
  tool: Tool;
  tip: string;
  shortcut?: string;
  reorderIndex: number;
  onReorderPointerDown: (e: PointerEvent, tool: string, index: number) => void;
  onSelect: (tool: Tool) => void;
  /** The tool being dragged, if any — both "am I moving" and "is a drag on" come from it. */
  draggingTool: string | null;
}) {
  const dragging = draggingTool === tool;
  const on = activeTool.value === tool;
  return (
    <Toggle
      pressed={on}
      // Un-pressing is ignored: there is always exactly one active tool, so a
      // click on the selected one holds it rather than clearing the selection.
      onPressedChange={(pressed: boolean) => {
        if (pressed) onSelect(tool);
      }}
      aria-label={tip}
      data-tool={tool}
      data-dragging={dragging ? '' : undefined}
      onPointerDown={(e: PointerEvent) => onReorderPointerDown(e, tool, reorderIndex)}
      className={cn(
        geist.ctl,
        // Same two recipes every other control in the bar uses, so a token change
        // lands on the whole row rather than half of it.
        on ? geist.ctlOn : geist.ctlIdle,
        // Picked up: it keeps its size and lifts on the shell's own shadow, so
        // nothing about the row's rhythm changes while it travels — and the press
        // fill stays off, because the drag owns the pointer.
        dragging && 'active:bg-transparent z-10 cursor-grabbing [box-shadow:var(--ds-shadow-menu)]',
      )}
    >
      <Icon name={tool} {...GLYPH} />
      {/* Disabled, not unmounted: tearing every tooltip out of the tree at the
          moment a reorder starts costs a hitch on the first frame of the drag. */}
      <Tooltip text={tip} shortcut={shortcut} disabled={draggingTool !== null} />
    </Toggle>
  );
}

type DragApi = {
  dragging: boolean;
  start: (e: PointerEvent) => void;
  reset: () => void;
};

/**
 * Mounted for the lifetime of any toolbar drag. The web viewer renders the
 * target page in an iframe, and an iframe swallows the pointer stream the
 * moment the cursor crosses into it — our `document` listeners go quiet and
 * the toolbar freezes until the cursor comes back out, which is what read as
 * lag in preview mode but never on the landing page. A transparent layer in
 * *our* document keeps every move in one stream, and carries the grabbing
 * cursor so it doesn't flicker back to the page's cursor mid-drag.
 */
const dragShieldActive = signal(false);

function DragShield() {
  if (!dragShieldActive.value) return null;
  return <div aria-hidden="true" class="fixed inset-0 z-2147483645" style={{ cursor: 'grabbing' }} />;
}

/** Keep a captured pointer's events flowing to us even over foreign content. */
function capturePointer(target: EventTarget | null, pointerId: number) {
  if (!(target instanceof Element)) return;
  try {
    target.setPointerCapture(pointerId);
  } catch {
    // The pointer can already be gone (fast tap, cancelled gesture) — the
    // shield and the document listeners still carry the drag on their own.
  }
}

/**
 * Sample the pointer on every move but run `onFrame` at most once per frame:
 * pointermove fires faster than the display refreshes (and in bursts after a
 * busy frame), so acting on each event just piles up work the compositor
 * throws away. `flush` lands the last sample instead of dropping the frame.
 */
function pointerSampler(e: PointerEvent, onFrame: (x: number, y: number) => void) {
  let frame = 0;
  let px = e.clientX;
  let py = e.clientY;
  const run = () => {
    frame = 0;
    onFrame(px, py);
  };
  return {
    sample(ev: PointerEvent) {
      px = ev.clientX;
      py = ev.clientY;
      if (!frame) frame = requestAnimationFrame(run);
    },
    flush() {
      if (!frame) return;
      cancelAnimationFrame(frame);
      run();
    },
  };
}

function useDrag(ref: RefObject<HTMLElement | null>): DragApi {
  const [dragging, setDragging] = useState(false);

  const start = useCallback(
    (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const el = ref.current;
      if (!el) return;
      e.stopPropagation();

      const pointerId = e.pointerId;

      // Measure FIRST so r reflects the toolbar's current on-screen
      // position (Tailwind's `left-1/2` + `-translate-x-1/2` together).
      // We then atomically swap to absolute coords + cleared transforms in
      // one synchronous batch — no paint happens between mutations, so the
      // toolbar stays put.
      const r = el.getBoundingClientRect();
      const w = r.width;
      const h = r.height;
      const baseX = r.left;
      const baseY = r.top;
      const offX = e.clientX - baseX;
      const offY = e.clientY - baseY;

      // Cancel WAAPI animations (entrance scale, fade) and clear the legacy
      // `transform`. We pin `left`/`top` once to the current position and
      // drive movement via the `translate` CSS property — changes to
      // `translate` are compositor-only, while changes to `left`/`top`
      // would invalidate layout on every pointermove and re-rasterize the
      // expensive backdrop-filter, which made the drag feel laggy.
      for (const a of el.getAnimations()) a.cancel();
      el.style.transform = 'none';
      el.style.translate = '0 0';
      el.style.left = `${baseX}px`;
      el.style.top = `${baseY}px`;
      el.style.bottom = 'auto';

      const sampler = pointerSampler(e, (px, py) => {
        const x = Math.min(Math.max(px - offX, 0), innerWidth - w);
        const y = Math.min(Math.max(py - offY, 0), innerHeight - h);
        el.style.translate = `${x - baseX}px ${y - baseY}px`;
      });

      // Capture, shield and document listeners are three belts for one brace:
      // capture keeps the stream on us, the shield keeps the cursor over our
      // own document, and listening on `document` (rather than the grip)
      // survives the grip being repositioned under the pointer.
      // Filtering by pointerId ignores secondary pointers (multi-touch).
      const onMove = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        if (ev.cancelable) ev.preventDefault();
        sampler.sample(ev);
      };

      const onEnd = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onEnd);
        document.removeEventListener('pointercancel', onEnd);
        // Land on the last sampled position instead of dropping the frame.
        sampler.flush();
        dragShieldActive.value = false;
        setDragging(false);
      };

      // Attach synchronously — a state-change-triggered useEffect would
      // miss the first pointermoves and jump the toolbar on first move.
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onEnd);
      document.addEventListener('pointercancel', onEnd);
      capturePointer(e.currentTarget, pointerId);
      dragShieldActive.value = true;
      setDragging(true);
    },
    [ref],
  );

  const reset = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.left = '';
    el.style.top = '';
    el.style.bottom = '';
    el.style.transform = '';
    el.style.translate = '';
  }, [ref]);

  // A drag swaps the toolbar off `bottom-5` onto absolute `left`/`top`, clamped
  // once against the viewport it was dragged in. Nothing revisits that, so a
  // later shrink — a window resize, DevTools opening — leaves the bar hanging
  // past the bottom edge with no grip left to pull it back. `scrollTick` already
  // coalesces resize into a signal, so the re-clamp rides it rather than adding
  // a second listener.
  useSignalEffect(() => {
    scrollTick.value;
    ensureScrollTickListener();
    const el = ref.current;
    // No inline `top` means the drag never ran and `bottom-5` still owns it.
    if (!el?.style.top) return;
    const r = el.getBoundingClientRect();
    const x = Math.min(Math.max(r.left, 0), Math.max(0, innerWidth - r.width));
    const y = Math.min(Math.max(r.top, 0), Math.max(0, innerHeight - r.height));
    if (x === r.left && y === r.top) return;
    // Zeroing `translate` lets `left`/`top` carry the whole position, so the
    // clamp lands exactly instead of compounding with the drag's own offset.
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.translate = '0 0';
  });

  return { dragging, start, reset };
}

function DragGrip({ drag }: { drag: DragApi }) {
  return (
    <div
      onPointerDown={drag.start}
      aria-hidden="true"
      class={cn(
        'inline-flex items-center justify-center h-8 w-5 shrink-0 cursor-grab touch-none',
        // Grey-900, not the muted grey-600 Geist uses for decorative marks:
        // the grip is a real control and has to clear 3:1 on both surfaces.
        'text-(--ds-gray-900) hover:text-(--ds-gray-1000) transition-colors duration-150 ease-out',
      )}
      style={drag.dragging ? { cursor: 'grabbing' } : undefined}
    >
      {/* 14px, not the 16px every other glyph gets: six filled dots carry more
          ink than a 1.5 stroke, so matching the box would out-weigh the row. */}
      <Icon name="grip" size={14} />
      <Tooltip text="Drag to move" />
    </div>
  );
}

const TOOL_LABELS: Partial<Record<Tool, string>> = {
  navigate: 'Move',
  multiInspect: 'Multi-select',
};
const lbl = (t: Tool) => TOOL_LABELS[t] ?? t.charAt(0).toUpperCase() + t.slice(1);

// Undo/redo/clear report themselves from `lib/state` so the keyboard path is
// counted too — a wrapper here would have counted only the button.
const HISTORY_ACTIONS = [
  { id: 'undo', icon: 'undo', tip: 'Undo', shortcut: '⌘Z', fn: undo },
  { id: 'redo', icon: 'redo', tip: 'Redo', shortcut: '⌘⇧Z', fn: redo },
  { id: 'clear', icon: 'clear', tip: 'Clear all', fn: clearAll },
];

const SHARE_ACTION = {
  id: 'share',
  icon: 'share',
  tip: 'Share',
  fn: () => {
    showShareDialog.value = true;
  },
};

function ConnectionDot() {
  const status = connectionStatus.value;
  // Surface the dot only as an alert — connected is the expected steady state.
  if (!status || status === 'connected') return null;
  const colors = {
    connecting: 'var(--ds-amber-700)',
    disconnected: 'var(--ds-red-700)',
  } as const;
  const labels = {
    connecting: 'Reconnecting…',
    disconnected: 'Disconnected',
  } as const;
  const c = colors[status];
  return (
    <span
      role="status"
      // A full-height slot so the dot sits on the same axis as the controls.
      class="inline-flex items-center justify-center h-8 w-4 shrink-0"
      title={labels[status]}
    >
      <span
        class="w-1.5 h-1.5 rounded-full"
        style={{
          backgroundColor: c,
          boxShadow: `0 0 0 3px color-mix(in oklab, ${c} 20%, transparent)`,
          animation:
            status === 'disconnected' || prefersReducedMotion() ? undefined : 'mlStatusPulse 2.4s ease-in-out infinite',
        }}
      />
      <span class="sr-only">{labels[status]}</span>
    </span>
  );
}

function CountBadge({ value }: { value: number }) {
  if (value <= 0) return null;
  return (
    <span
      class="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full inline-flex items-center justify-center
             text-micro font-semibold tabular-nums leading-none pointer-events-none"
      style={{
        background: 'var(--ds-blue-800)',
        color: '#fff',
        // Cut out of the bar rather than shadowed onto it.
        boxShadow: '0 0 0 2px var(--ds-background-100)',
      }}
    >
      {value > 99 ? '99+' : value}
    </span>
  );
}

/**
 * The color the drawing tools are using. It reads out the live value and
 * opens the panel that holds the palette — the selected-tool fill stays
 * monochrome, so this is where the color lives in the bar.
 */
function ColorChip() {
  const tip = `Color · ${colorName(color.value)}`;
  return (
    <Ctl
      tip={tip}
      action="color"
      onClick={() => {
        showSettings.value = !showSettings.value;
      }}
    >
      <span
        class="w-3 h-3 rounded-sm"
        // Self-colored inner edge: it defines the swatch against both surfaces
        // without a border that would fight the color it is reporting.
        style={{ background: color.value, boxShadow: 'inset 0 0 0 1px color-mix(in oklab, #000 20%, transparent)' }}
      />
    </Ctl>
  );
}

function MinimizedToolbar({ onExpand, drag }: { onExpand: () => void; drag: DragApi }) {
  return (
    <BaseToolbar.Root data-ml-tb="row" className="flex items-center gap-1">
      <Ctl icon={activeTool.value} on onClick={onExpand} tip="Expand toolbar" action="expand" />
      <DragGrip drag={drag} />
    </BaseToolbar.Root>
  );
}

function useFlipReorder(deps: unknown[]) {
  const containerRef = useRef<HTMLDivElement>(null);
  const prevRectsRef = useRef<Map<string, DOMRect>>(new Map());

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const buttons = container.querySelectorAll<HTMLElement>('[data-tool]:not([data-dragging])');
    // Snapshot visual rects FIRST (before cancelling any in-flight animations).
    // For elements mid-FLIP, this captures the actual visual position the user
    // is seeing, so the next animation can resume from there without a jump.
    const visualPrev = new Map<string, DOMRect>();
    for (const btn of buttons) {
      const tool = btn.dataset.tool;
      if (tool) visualPrev.set(tool, btn.getBoundingClientRect());
    }
    // Now cancel any in-flight animations, then measure layout-only rects.
    // After cancel, the inline transform is gone — the rect equals the post-
    // reorder CSS layout position, which is the target of the new animation.
    if (!prefersReducedMotion()) {
      for (const btn of buttons) {
        for (const a of btn.getAnimations()) {
          // Leave CSS-declared animations running. `getAnimations()` returns
          // those too, so cancelling everything here silently killed the landing
          // page's staggered entrance on exactly the buttons this hook manages:
          // the tools sat fully drawn while the rest of the bar animated in.
          // Imperative FLIP transforms and in-flight transitions are still
          // cancelled, and those are what actually skew the measurement below.
          if ('animationName' in a) continue;
          a.cancel();
        }
      }
      for (const btn of buttons) {
        const tool = btn.dataset.tool;
        if (!tool) continue;
        const prev = prevRectsRef.current.get(tool) ?? visualPrev.get(tool);
        const visual = visualPrev.get(tool);
        const cur = btn.getBoundingClientRect();
        if (!prev || !visual || !cur) continue;
        // Use the visual mid-animation position if it differs from the last
        // committed layout (i.e., a previous FLIP was still in flight).
        const fromLeft = Math.abs(visual.left - prev.left) > 0.5 ? visual.left : prev.left;
        const fromTop = Math.abs(visual.top - prev.top) > 0.5 ? visual.top : prev.top;
        const dx = fromLeft - cur.left;
        const dy = fromTop - cur.top;
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
        btn.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }], {
          duration: 280,
          easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
        });
      }
    }
    // Record final layout rects (post-cancel) as the reference for next render.
    const next = new Map<string, DOMRect>();
    for (const btn of buttons) {
      const tool = btn.dataset.tool;
      if (tool) next.set(tool, btn.getBoundingClientRect());
    }
    prevRectsRef.current = next;
  }, deps);

  return containerRef;
}

function useToolReorder(containerRef: RefObject<HTMLDivElement | null>) {
  const [draggingTool, setDraggingTool] = useState<string | null>(null);
  const suppressClickRef = useRef(false);

  const onPointerDown = useCallback(
    (e: PointerEvent, tool: string, fromIndex: number) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.stopPropagation();
      const pointerId = e.pointerId;
      const startX = e.clientX;
      const startY = e.clientY;
      let activated = false;
      let to = fromIndex;

      // Cursor-follow state, captured at activation.
      let draggedBtn: HTMLElement | null = null;
      let itemStep = 0;
      let firstSlotCentre = 0;
      let slotCount = 0;
      let activationCx = 0;
      let activationCy = 0;
      let lastDx = 0;
      let lastDy = 0;

      const activate = (cx: number, cy: number) => {
        activated = true;
        setDraggingTool(tool);
        // Snapshot the slot geometry once. The slots themselves never move
        // during a reorder — only which button sits in each does — so a single
        // measurement is enough for the whole drag. Re-measuring per move used
        // to force a synchronous relayout on every event AND read rects while
        // the FLIP animations were still running, so the drop target flickered
        // between two indices as the buttons crossed.
        const container = containerRef.current;
        if (container) {
          const all = Array.from(container.querySelectorAll<HTMLElement>('[data-tool]'));
          slotCount = all.length;
          const r0 = all[0]?.getBoundingClientRect();
          const r1 = all[1]?.getBoundingClientRect();
          firstSlotCentre = r0 ? r0.left + r0.width / 2 : 0;
          // Slot pitch — distance between consecutive buttons. Used both to
          // pick the drop index and to cancel out the CSS-slot displacement
          // caused by optimistic reorders, so the dragged button stays glued
          // to the cursor.
          itemStep = r0 && r1 ? r1.left - r0.left : (r0?.width ?? 0);
          draggedBtn = all[fromIndex] ?? null;
          if (draggedBtn) {
            draggedBtn.style.willChange = 'translate';
            // Capture only once the drag is real, so a plain click on a tool
            // keeps its untouched default pointerdown → pointerup → click path.
            capturePointer(draggedBtn, pointerId);
          }
        }
        activationCx = cx;
        activationCy = cy;
      };

      const sampler = pointerSampler(e, (px, py) => {
        // Nearest slot to the cursor, straight from the snapshotted pitch — no
        // DOM reads, so the move handler never invalidates layout.
        const next =
          itemStep > 0 ? Math.min(Math.max(Math.round((px - firstSlotCentre) / itemStep), 0), slotCount - 1) : to;
        if (next !== to) {
          // Optimistically reorder so the user sees a live preview; FLIP
          // smooths each cross for the OTHER buttons (the dragged button is
          // excluded via [data-dragging] and its position is set manually).
          moveTool(to, next);
          to = next;
        }
        // Cursor-follow: translate the dragged button so the cursor stays at
        // the same point on it. Compensate for slot drift caused by optimistic
        // reorders — when `to` moves by 1, the button's CSS slot shifts by
        // itemStep, so we subtract that to keep visual position smooth.
        if (draggedBtn) {
          lastDx = (fromIndex - to) * itemStep + (px - activationCx);
          lastDy = py - activationCy;
          draggedBtn.style.translate = `${lastDx}px ${lastDy}px`;
        }
      });

      const onMove = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        if (!activated) {
          if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 4) return;
          activate(ev.clientX, ev.clientY);
          dragShieldActive.value = true;
        }
        sampler.sample(ev);
      };

      const onEnd = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onEnd);
        document.removeEventListener('pointercancel', onEnd);
        // A pending frame implies the drag activated; land it before settling.
        sampler.flush();
        if (!activated) return;
        dragShieldActive.value = false;
        // Spring-back: animate translate from cursor offset to 0 with a slight
        // overshoot. We clear inline `translate` first so once the WAAPI ends
        // (no fill) the element settles to CSS default (0) — no jump back to
        // lastDx as inline reasserts.
        if (draggedBtn) {
          const btn = draggedBtn;
          btn.style.translate = '';
          const settle = btn.animate([{ translate: `${lastDx}px ${lastDy}px` }, { translate: '0 0' }], {
            duration: 320,
            easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
          });
          // Hold the hint until the spring lands, then drop it — a permanent
          // will-change keeps a compositor layer alive for nothing.
          settle.finished.finally(() => {
            btn.style.willChange = '';
          });
        }
        setDraggingTool(null);
        // The click that follows pointerup may fire on a different element
        // than where pointerdown landed (because the dragged button moved).
        // Set a flag now and clear after the click has had a chance to
        // dispatch — setTimeout(0) runs after the synthesized click event.
        suppressClickRef.current = true;
        setTimeout(() => {
          suppressClickRef.current = false;
        }, 0);
      };

      // Listen on document — pointermove on the button itself stops firing
      // once the cursor leaves it, and the button is being repositioned under
      // the pointer as slots swap. Capture (set at activation) and the shield
      // keep an iframe under the cursor from taking the stream away mid-drag.
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onEnd);
      document.addEventListener('pointercancel', onEnd);
    },
    [containerRef],
  );

  const consumeClickSuppression = () => {
    if (!suppressClickRef.current) return false;
    suppressClickRef.current = false;
    return true;
  };

  return { draggingTool, onPointerDown, consumeClickSuppression };
}

function ExpandedToolbar({ onMinimize, drag }: { onMinimize: () => void; drag: DragApi }) {
  const tools = toolOrder.value;
  const toolsRef = useFlipReorder([tools]);
  const reorder = useToolReorder(toolsRef);

  // `data-ml-tb` hooks the landing page's staggered entrance
  // (apps/worker/web/style.css). Attributes only: nothing reads them here, and
  // the animation is scoped to `.lp-toolbar-in`, so the Viewer and the
  // extension are unaffected.
  return (
    <BaseToolbar.Root data-ml-tb="row" className="flex items-center gap-1">
      {/* Each `Toggle` is controlled from `activeTool` directly rather than wrapped
          in a `ToggleGroup`: the signal is already the single source of the pressed
          state, and the group's composite machinery — a childList MutationObserver
          that re-sorts every button with `compareDocumentPosition` on each render —
          re-ran on every slot crossing of a reorder, on top of the FLIP pass. */}
      <div ref={toolsRef} data-ml-tb="tools" class="flex gap-1 items-center">
        {tools.map((t, i) => {
          const showStackBadge = t === 'inspect' && inspectorStack.value.length > 0;
          const isDragging = reorder.draggingTool === t;
          const toggle = (
            <ToolToggle
              key={t}
              tool={t}
              tip={lbl(t)}
              shortcut={SHORTCUTS[t]}
              reorderIndex={i}
              onReorderPointerDown={reorder.onPointerDown}
              // The click that lands a reorder must not also switch tools.
              onSelect={(next) => {
                if (!reorder.consumeClickSuppression()) selectTool({ tool: next, via: 'toolbar' });
              }}
              draggingTool={reorder.draggingTool}
            />
          );
          if (!showStackBadge) return toggle;
          return (
            <span key={t} class={cn('relative inline-flex', isDragging && 'z-10')}>
              {toggle}
              <CountBadge value={inspectorStack.value.length} />
            </span>
          );
        })}
      </div>

      <BaseToolbar.Separator className={geist.sep} />

      <ColorChip />

      <BaseToolbar.Group aria-label="History" data-ml-tb="history" className="flex gap-1 items-center">
        {HISTORY_ACTIONS.map((a) => (
          <Ctl key={a.id} icon={a.icon} onClick={a.fn} tip={a.tip} shortcut={a.shortcut} />
        ))}
      </BaseToolbar.Group>

      {(operations.value.length > 0 || inspectorStack.value.length > 0) && (
        <>
          <BaseToolbar.Separator className={geist.sep} />
          <Ctl icon={SHARE_ACTION.icon} onClick={SHARE_ACTION.fn} tip={SHARE_ACTION.tip} action="share" />
        </>
      )}

      <DragGrip drag={drag} />

      <ConnectionDot />

      <Ctl icon="minimize" onClick={onMinimize} tip="Minimize" action="minimize" />

      <Ctl
        icon="settings"
        on={showSettings.value}
        onClick={() => {
          showSettings.value = !showSettings.value;
        }}
        tip="Settings"
        anchor="settings"
      />
    </BaseToolbar.Root>
  );
}

export function Toolbar() {
  const minimized = toolbarMinimized.value;
  const tbRef = useRef<HTMLDivElement>(null);
  const flipFromRef = useRef<DOMRect | null>(null);
  const drag = useDrag(tbRef);
  const fadeAnimRef = useRef<Animation | null>(null);

  // One-shot entrance on first mount (skipped under prefers-reduced-motion).
  // useLayoutEffect runs before paint, so `fill: 'both'` applies the start
  // keyframe synchronously without a one-frame flash at full size.
  // We animate the individual `scale` property (CSS Transform L2) instead of
  // `transform`, so the Tailwind `-translate-x-1/2` keeps centering us — a full
  // `transform` keyframe would replace that translate and shift the toolbar.
  useLayoutEffect(() => {
    const tb = tbRef.current;
    if (!tb || prefersReducedMotion()) return;
    tb.animate(
      [
        { opacity: 0, scale: 0.94 },
        { opacity: 1, scale: 1 },
      ],
      { duration: 240, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', fill: 'both' },
    );
  }, []);

  const onToggleMinimize = () => {
    const tb = tbRef.current;
    if (tb) {
      for (const a of tb.getAnimations()) a.cancel();
      flipFromRef.current = tb.getBoundingClientRect();
      if (minimized) drag.reset();
    }
    toggleToolbarMinimized();
  };

  useLayoutEffect(() => {
    const tb = tbRef.current;
    const before = flipFromRef.current;
    if (!tb || !before) return;
    flipFromRef.current = null;
    if (prefersReducedMotion()) return;
    const after = tb.getBoundingClientRect();
    const dx = before.left - after.left;
    const dy = before.top - after.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(before.width - after.width) < 1) return;
    const baseT = getComputedStyle(tb).transform;
    const base = baseT === 'none' ? '' : ` ${baseT}`;
    tb.style.overflow = 'hidden';
    const anim = tb.animate(
      [
        {
          transform: `translate(${dx}px, ${dy}px)${base}`,
          width: `${before.width}px`,
          height: `${before.height}px`,
        },
        {
          transform: `translate(0, 0)${base}`,
          width: `${after.width}px`,
          height: `${after.height}px`,
        },
      ],
      { duration: 320, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
    );
    // .finally runs on both finish and cancel, so overflow is always restored
    anim.finished.finally(() => {
      tb.style.overflow = '';
    });
  }, [minimized]);

  useSignalEffect(() => {
    const active = isDrawingActive.value;
    // Cancel previous fade so animations don't accumulate on the element
    fadeAnimRef.current?.cancel();
    const reduce = prefersReducedMotion();
    fadeAnimRef.current =
      tbRef.current?.animate(
        { opacity: active ? 0.15 : 1 },
        { duration: reduce ? 0 : 250, easing: 'ease-out', fill: 'forwards' },
      ) ?? null;
  });

  return (
    <>
      <div
        ref={tbRef}
        class={cn(
          'fixed bottom-5 left-1/2 -translate-x-1/2 z-2147483646 select-none',
          geist.surface,
          glass.font,
          // 4px gutter, which is what makes the 8px control radius concentric
          // with the shell's 12px. Same in both states, so the FLIP between
          // them only has width to animate.
          'text-(--ds-gray-1000) max-w-[calc(100dvw-24px)] w-max p-1',
        )}
      >
        {minimized ? (
          <MinimizedToolbar onExpand={onToggleMinimize} drag={drag} />
        ) : (
          <ExpandedToolbar onMinimize={onToggleMinimize} drag={drag} />
        )}
      </div>
      <DragShield />
      <SettingsPanel />
    </>
  );
}
