import { cn } from '@marklayer/types';
import { useSignalEffect } from '@preact/signals';
import type { RefObject } from 'preact';
import { useCallback, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { glass } from '../lib/glass';
import { Icon } from '../lib/icons';
import {
  activeTool,
  clearAll,
  color,
  connectionStatus,
  inspectorStack,
  isDrawingActive,
  moveTool,
  operations,
  redo,
  SHORTCUTS,
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

const prefersReducedMotion = () =>
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

const TOOLBTN_VARIANTS = {
  idle: 'bg-transparent text-ml-glass-fg/45',
  accent: 'shadow-[inset_0_0_0_1px_var(--ml-glass-border),inset_0_0.5px_0_var(--ml-glass-border)]',
  plain: 'bg-ml-glass-fg/[0.1] text-ml-glass-fg shadow-[inset_0_0.5px_0_var(--ml-glass-border)]',
} as const;

function ToolBtn({
  name,
  active,
  onClick,
  tip,
  shortcut,
  accent,
  accentColor,
  round,
  reorderIndex,
  onReorderPointerDown,
  dragging,
  suppressTooltip,
  anchor,
}: {
  name: string;
  active?: boolean;
  onClick: () => void;
  tip: string;
  shortcut?: string;
  accent?: boolean;
  accentColor?: string;
  round?: boolean;
  reorderIndex?: number;
  onReorderPointerDown?: (e: PointerEvent, tool: string, index: number) => void;
  dragging?: boolean;
  suppressTooltip?: boolean;
  anchor?: string;
}) {
  const variant = !active ? 'idle' : accent ? 'accent' : 'plain';
  const reorderable = reorderIndex !== undefined && onReorderPointerDown !== undefined;
  const accentStyle =
    variant === 'accent' && accentColor
      ? {
          color: accentColor,
          background: `color-mix(in oklch, ${accentColor} 18%, transparent)`,
        }
      : undefined;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={tip}
      data-tool={reorderable ? name : undefined}
      data-dragging={dragging ? '' : undefined}
      data-ml-anchor={anchor}
      onPointerDown={reorderable ? (e) => onReorderPointerDown(e, name, reorderIndex) : undefined}
      class={cn(
        'group relative appearance-none border-none p-1.5 cursor-pointer touch-none',
        'leading-none inline-flex items-center justify-center min-w-7.5 min-h-7.5',
        'transition-[background,box-shadow,color,opacity,scale] duration-150 ease-out outline-none',
        'hover:bg-ml-glass-fg/[0.08] hover:shadow-[inset_0_0.5px_0_var(--ml-glass-border)]',
        !dragging && 'active:bg-ml-glass-fg/4 active:scale-[0.94]',
        'focus-visible:ring-2 focus-visible:ring-ml-glass-fg/40 focus-visible:ring-offset-0',
        round ? 'rounded-full' : 'rounded-xl',
        TOOLBTN_VARIANTS[variant],
        dragging && 'scale-110 z-10 cursor-grabbing shadow-[0_10px_28px_-6px_oklch(0_0_0/0.45)]',
      )}
      style={accentStyle}
    >
      <Icon name={name} />
      {!suppressTooltip && <Tooltip text={tip} shortcut={shortcut} />}
    </button>
  );
}

type DragApi = {
  dragging: boolean;
  start: (e: PointerEvent) => void;
  reset: () => void;
};

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

      // Listen on document — pointer capture on the grip is fragile when
      // the grip's parent (toolbar) is being repositioned mid-drag.
      // Filtering by pointerId ignores secondary pointers (multi-touch).
      const onMove = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        if (ev.cancelable) ev.preventDefault();
        const x = Math.min(Math.max(ev.clientX - offX, 0), innerWidth - w);
        const y = Math.min(Math.max(ev.clientY - offY, 0), innerHeight - h);
        el.style.translate = `${x - baseX}px ${y - baseY}px`;
      };

      const onEnd = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onEnd);
        document.removeEventListener('pointercancel', onEnd);
        setDragging(false);
      };

      // Attach synchronously — a state-change-triggered useEffect would
      // miss the first pointermoves and jump the toolbar on first move.
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onEnd);
      document.addEventListener('pointercancel', onEnd);
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

  return { dragging, start, reset };
}

function DragGrip({ drag }: { drag: DragApi }) {
  return (
    <div
      onPointerDown={drag.start}
      aria-hidden="true"
      class={cn(
        'w-3 h-5 cursor-grab shrink-0 opacity-30 mx-1 touch-none',
        'hover:opacity-50 transition-opacity duration-200',
        'bg-[radial-gradient(circle,var(--ml-glass-grip)_0.8px,transparent_0.8px)]',
        '[background-size:5px_5px] bg-center bg-repeat',
      )}
      style={drag.dragging ? { cursor: 'grabbing' } : undefined}
    />
  );
}

const TOOL_LABELS: Partial<Record<Tool, string>> = {
  multiInspect: 'Multi-select',
};
const lbl = (t: Tool) => TOOL_LABELS[t] ?? t[0].toUpperCase() + t.slice(1);

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
    connecting: 'var(--ml-state-yellow)',
    disconnected: 'var(--ml-state-red)',
  } as const;
  const labels = {
    connecting: 'Reconnecting…',
    disconnected: 'Disconnected',
  } as const;
  return (
    <span
      role="status"
      class="relative inline-flex items-center justify-center w-2 h-2 rounded-full mx-1.5 shrink-0"
      style={{
        color: colors[status],
        backgroundColor: colors[status],
        animation: status === 'disconnected' ? undefined : 'mlStatusPulse 2.4s ease-in-out infinite',
      }}
      title={labels[status]}
    >
      <span class="sr-only">{labels[status]}</span>
    </span>
  );
}

function CountBadge({ value }: { value: number }) {
  if (value <= 0) return null;
  return (
    <span
      class="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full inline-flex items-center justify-center
             text-[10px] font-bold tabular-nums leading-none pointer-events-none"
      style={{
        background: 'var(--ml-state-blue)',
        color: 'white',
        boxShadow: '0 0 0 2px var(--ml-glass-bg), 0 1px 3px oklch(0 0 0 / 0.25)',
      }}
    >
      {value > 99 ? '99+' : value}
    </span>
  );
}

function MinimizedToolbar({ onExpand, drag }: { onExpand: () => void; drag: DragApi }) {
  return (
    <div class="flex items-center gap-0.5">
      <ToolBtn
        name={activeTool.value}
        active
        accent={activeTool.value !== 'navigate'}
        accentColor={color.value}
        onClick={onExpand}
        tip="Expand toolbar"
        round
      />
      <DragGrip drag={drag} />
    </div>
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
        for (const a of btn.getAnimations()) a.cancel();
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
      let activationCx = 0;
      let activationCy = 0;
      let lastDx = 0;
      let lastDy = 0;

      const onMove = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        if (!activated) {
          if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 4) return;
          activated = true;
          setDraggingTool(tool);
          // Snapshot layout geometry so we can compute the dragged button's
          // visual offset from its current CSS slot on every pointermove
          // (slots don't move; the dragged button does).
          const container = containerRef.current;
          if (container) {
            const all = Array.from(container.querySelectorAll<HTMLElement>('[data-tool]'));
            const r0 = all[0]?.getBoundingClientRect();
            const r1 = all[1]?.getBoundingClientRect();
            // Slot pitch — distance between consecutive buttons. Used to
            // cancel out the CSS-slot displacement caused by optimistic
            // reorders so the dragged button stays glued to the cursor.
            itemStep = r0 && r1 ? r1.left - r0.left : (r0?.width ?? 0);
            draggedBtn = all[fromIndex] ?? null;
          }
          activationCx = ev.clientX;
          activationCy = ev.clientY;
        }
        const container = containerRef.current;
        if (!container) return;
        // Filtered to exclude the dragged button (which has data-dragging).
        // Each remaining button represents an insertion slot. The result `next`
        // is a target index in toolOrder for moveTool(): cursor before all → 0,
        // cursor past all → buttons.length (insert at end), otherwise the index
        // of the first non-dragged button whose midpoint is past the cursor.
        const buttons = container.querySelectorAll<HTMLElement>('[data-tool]:not([data-dragging])');
        let next = buttons.length;
        for (let i = 0; i < buttons.length; i++) {
          const r = buttons[i].getBoundingClientRect();
          if (ev.clientX < r.left + r.width / 2) {
            next = i;
            break;
          }
        }
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
          const dx = (fromIndex - to) * itemStep + (ev.clientX - activationCx);
          const dy = ev.clientY - activationCy;
          draggedBtn.style.translate = `${dx}px ${dy}px`;
          lastDx = dx;
          lastDy = dy;
        }
      };

      const onEnd = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onEnd);
        document.removeEventListener('pointercancel', onEnd);
        if (!activated) return;
        // Spring-back: animate translate from cursor offset to 0 with a slight
        // overshoot. We clear inline `translate` first so once the WAAPI ends
        // (no fill) the element settles to CSS default (0) — no jump back to
        // lastDx as inline reasserts.
        if (draggedBtn) {
          const btn = draggedBtn;
          btn.style.translate = '';
          btn.animate([{ translate: `${lastDx}px ${lastDy}px` }, { translate: '0 0' }], {
            duration: 320,
            easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
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
      // once the cursor leaves it (no pointer capture), and capture is
      // fragile when the button is being repositioned mid-drag.
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

  return (
    <div class="flex items-center gap-0.5">
      <div ref={toolsRef} class="flex gap-0.5 items-center">
        {tools.map((t) => {
          const realIndex = toolOrder.value.indexOf(t);
          const showStackBadge = t === 'inspect' && inspectorStack.value.length > 0;
          const isDragging = reorder.draggingTool === t;
          const onClick = () => {
            if (reorder.consumeClickSuppression()) return;
            activeTool.value = t;
          };
          const btn = (
            <ToolBtn
              key={t}
              name={t}
              active={activeTool.value === t}
              onClick={onClick}
              tip={lbl(t)}
              shortcut={SHORTCUTS[t]}
              accent={t !== 'navigate'}
              accentColor={color.value}
              reorderIndex={realIndex}
              onReorderPointerDown={reorder.onPointerDown}
              dragging={isDragging}
              suppressTooltip={reorder.draggingTool !== null}
            />
          );
          if (!showStackBadge) return btn;
          return (
            <span key={t} class={cn('relative inline-flex', isDragging && 'z-10')}>
              {btn}
              <CountBadge value={inspectorStack.value.length} />
            </span>
          );
        })}
      </div>

      <div class={glass.sep} />

      <div class="flex gap-0.5 items-center">
        {HISTORY_ACTIONS.map((a) => (
          <ToolBtn key={a.id} name={a.icon} onClick={a.fn} tip={a.tip} shortcut={a.shortcut} />
        ))}
      </div>

      {(operations.value.length > 0 || inspectorStack.value.length > 0) && (
        <>
          <div class={glass.sep} />
          <ToolBtn name={SHARE_ACTION.icon} onClick={SHARE_ACTION.fn} tip={SHARE_ACTION.tip} />
        </>
      )}

      <DragGrip drag={drag} />

      <ConnectionDot />

      <ToolBtn name="minimize" onClick={onMinimize} tip="Minimize" />

      <ToolBtn
        name="settings"
        active={showSettings.value}
        onClick={() => {
          showSettings.value = !showSettings.value;
        }}
        tip="Settings"
        anchor="settings"
      />
    </div>
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
          glass.surface,
          glass.font,
          'text-ml-glass-fg/80 max-w-[calc(100dvw-24px)] w-max',
          minimized ? 'p-1' : 'p-2',
        )}
      >
        {minimized ? (
          <MinimizedToolbar onExpand={onToggleMinimize} drag={drag} />
        ) : (
          <ExpandedToolbar onMinimize={onToggleMinimize} drag={drag} />
        )}
      </div>
      <SettingsPanel />
    </>
  );
}
