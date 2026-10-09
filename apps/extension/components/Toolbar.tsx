import { Menu } from '@base-ui/react/menu';
import { Toggle } from '@base-ui/react/toggle';
import { Toolbar as BaseToolbar } from '@base-ui/react/toolbar';
import { cn } from '@marklayer/types';
import { signal, useSignalEffect } from '@preact/signals';
import type { ComponentChildren, RefObject } from 'preact';
import { useCallback, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { track } from '../lib/analytics';
import { GLYPH, geist } from '../lib/geist';
import { glass } from '../lib/glass';
import { Icon } from '../lib/icons';
import { prefersReducedMotion } from '../lib/media';
import { capturePointer, pointerSampler } from '../lib/pointer';
import { portalContainer } from '../lib/portal';
import {
  activeTool,
  clearAll,
  color,
  colorName,
  connectionStatus,
  copyOpenAnnotations,
  ensureScrollTickListener,
  groupFaces,
  inspectorStack,
  isDrawingActive,
  isToolGroup,
  moveSlot,
  openAnnotationTotal,
  operations,
  redo,
  SHORTCUTS,
  scrollTick,
  selectTool,
  showSettings,
  showShareDialog,
  slotOf,
  slotTool,
  TOOL_GROUPS,
  type ToolGroup,
  type ToolSlot,
  toggleToolbarMinimized,
  toolbarMinimized,
  undo,
  visibleSlots,
} from '../lib/state';
import type { Tool } from '../lib/types';
import { SettingsPanel } from './SettingsPanel';
import { ToolFan, useToolFan } from './ToolFan';
import { Tooltip } from './Tooltip';

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
  onPointerDown,
  tipDisabled,
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
  /** Arms a gesture that may pre-empt the click, as the collapsed bar's fan does. */
  onPointerDown?: (e: PointerEvent) => void;
  /** Hold the tooltip closed while a gesture owns the space it would cover. */
  tipDisabled?: boolean;
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
      onPointerDown={onPointerDown}
      aria-label={tip}
      data-ml-anchor={anchor}
      className={cn(geist.ctl, on ? geist.ctlOn : geist.ctlIdle)}
    >
      {children ?? (icon && <Icon name={icon} {...GLYPH} />)}
      <Tooltip text={tip} shortcut={shortcut} disabled={tipDisabled} />
    </BaseToolbar.Button>
  );
}

/**
 * A tool in the picker. `Toggle` carries the `aria-pressed` semantics; the
 * pressed state itself is read from `activeTool`, so there is one source of
 * truth for which tool is selected.
 */
function ToolToggle({
  slot,
  tip,
  shortcut,
  reorderIndex,
  onReorderPointerDown,
  onSelect,
  draggingSlot,
}: {
  slot: ToolSlot;
  tip: string;
  shortcut?: string;
  reorderIndex: number;
  onReorderPointerDown: (e: PointerEvent, slot: ToolSlot, index: number) => void;
  onSelect: (tool: Tool) => void;
  /** The slot being dragged, if any — both "am I moving" and "is a drag on" come from it. */
  draggingSlot: ToolSlot | null;
}) {
  const tool = slotTool(slot);
  const dragging = draggingSlot === slot;
  const on = slotOf(activeTool.value) === slot;
  return (
    <Toggle
      pressed={on}
      // Un-pressing is ignored: there is always exactly one active tool, so a
      // click on the selected one holds it rather than clearing the selection.
      onPressedChange={(pressed: boolean) => {
        if (pressed) onSelect(tool);
      }}
      aria-label={tip}
      onPointerDown={(e: PointerEvent) => onReorderPointerDown(e, slot, reorderIndex)}
      className={cn(
        geist.ctl,
        // Same two recipes every other control in the bar uses, so a token change
        // lands on the whole row rather than half of it.
        on ? geist.ctlOn : geist.ctlIdle,
        // The drag owns the pointer, so the press fill stays off while it travels.
        dragging && 'active:bg-transparent cursor-grabbing',
      )}
    >
      <Icon name={tool} {...GLYPH} />
      {/* Disabled, not unmounted: tearing every tooltip out of the tree at the
          moment a reorder starts costs a hitch on the first frame of the drag. */}
      <Tooltip text={tip} shortcut={shortcut} disabled={draggingSlot !== null} />
    </Toggle>
  );
}

/**
 * One reorderable position on the bar. It carries the slot's identity for the
 * drag and FLIP passes, so whatever sits beside the toggle — a group's chevron,
 * a count badge — travels with it. Picked up, it lifts on the shell's own
 * shadow at its own size, so the row's rhythm holds while it moves.
 */
function SlotFrame({
  slot,
  index,
  dragging,
  children,
}: {
  slot: ToolSlot;
  /** Position on the bar, exposed as `--tb-i` for the landing page's staggered entrance. */
  index: number;
  dragging: boolean;
  children: ComponentChildren;
}) {
  return (
    <span
      data-tool={slot}
      style={{ '--tb-i': index }}
      data-dragging={dragging ? '' : undefined}
      class={cn(
        'relative inline-flex items-center rounded-lg',
        dragging && 'z-10 bg-(--ds-background-100) [box-shadow:var(--ds-shadow-menu)]',
      )}
    >
      {children}
    </span>
  );
}

const GROUP_LABELS: Record<ToolGroup, string> = { draw: 'Drawing tools', shapes: 'Shape tools' };

/** The chevron beside a group's toggle, listing every member. */
function GroupMenu({ group }: { group: ToolGroup }) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <Menu.Root>
      <Menu.Trigger
        ref={triggerRef}
        aria-label={GROUP_LABELS[group]}
        className={cn(
          geist.ctl,
          geist.ctlIdle,
          'w-4 data-popup-open:bg-(--ds-gray-alpha-100) data-popup-open:text-(--ds-gray-1000)',
        )}
      >
        <Icon name="chevDown" size={12} strokeWidth={1.5} />
      </Menu.Trigger>
      <Menu.Portal container={portalContainer.value ?? undefined}>
        {/* Anchored to the slot, so the list lines up under the tool rather than the chevron. */}
        <Menu.Positioner
          anchor={() => triggerRef.current?.parentElement ?? null}
          side="top"
          align="start"
          sideOffset={10}
          collisionPadding={8}
          className="z-2147483647 outline-none"
        >
          <Menu.Popup className={cn(glass.menuPopup, geist.surface, glass.font, 'min-w-44 p-1 text-(--ds-gray-1000)')}>
            <Menu.RadioGroup value={groupFaces.value[group]} className="flex flex-col gap-px">
              {TOOL_GROUPS[group].map((t) => (
                <Menu.RadioItem
                  key={t}
                  value={t}
                  closeOnClick
                  onClick={() => selectTool({ tool: t, via: 'toolbar' })}
                  className={cn(
                    'flex items-center gap-2 w-full h-8 pl-1.5 pr-2.5 rounded-lg text-ui',
                    glass.menuItem,
                    glass.menuItemHighlight,
                  )}
                >
                  <span class="inline-flex w-3.5 shrink-0 justify-center">
                    <Menu.RadioItemIndicator className="inline-flex">
                      <Icon name="check" size={13} strokeWidth={1.5} />
                    </Menu.RadioItemIndicator>
                  </span>
                  <Icon name={t} {...GLYPH} />
                  <span class="flex-1 pr-6">{lbl(t)}</span>
                  {SHORTCUTS[t] && <span class="text-meta text-(--ds-gray-900)">{SHORTCUTS[t]}</span>}
                </Menu.RadioItem>
              ))}
            </Menu.RadioGroup>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
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

      const sampler = pointerSampler({
        event: e,
        onFrame: (px, py) => {
          const x = Math.min(Math.max(px - offX, 0), innerWidth - w);
          const y = Math.min(Math.max(py - offY, 0), innerHeight - h);
          el.style.translate = `${x - baseX}px ${y - baseY}px`;
        },
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
      capturePointer({ target: e.currentTarget, pointerId });
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

/**
 * Collapsed, the bar used to be a dead end: the one thing it could do was stop
 * being collapsed, so minimising to see the page cost you every tool. Pressing
 * the button and dragging now fans the first few tools out around it and
 * commits the one you release on, and the button previews that tool the whole
 * way — so the bar stays out of the way and still works.
 */
function MinimizedToolbar({ onExpand, drag }: { onExpand: () => void; drag: DragApi }) {
  const fan = useToolFan({
    setShield: (on) => {
      dragShieldActive.value = on;
    },
  });
  return (
    // `relative` is the fan's origin: it places itself from this box's left edge
    // and vertical centre, which is exactly where the button below sits.
    <BaseToolbar.Root data-ml-tb="row" className="relative flex items-center gap-1">
      <Ctl
        icon={fan.icon}
        on
        onClick={onExpand}
        onPointerDown={fan.onPointerDown}
        // Two verbs: the hold gesture is invisible otherwise, and this is the
        // only place to say so.
        tip="Expand · hold to pick a tool"
        // The tooltip sits exactly where the fan opens, so the hint gets out of
        // the way the moment the gesture it was describing actually starts.
        tipDisabled={fan.open}
        action="expand"
      />
      <ToolFan />
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
  const [draggingSlot, setDraggingSlot] = useState<ToolSlot | null>(null);
  const suppressClickRef = useRef(false);

  const onPointerDown = useCallback(
    (e: PointerEvent, slot: ToolSlot, fromIndex: number) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.stopPropagation();
      const pointerId = e.pointerId;
      const startX = e.clientX;
      const startY = e.clientY;
      let activated = false;
      let to = fromIndex;

      // Cursor-follow state, captured at activation.
      let draggedBtn: HTMLElement | null = null;
      /** Where the dragged slot's left edge lands at each index, the rest closing up around it. */
      let lefts: number[] = [];
      let originLeft = 0;
      let lastDx = 0;
      let lastDy = 0;

      const activate = () => {
        activated = true;
        setDraggingSlot(slot);
        // Snapshot the slot geometry once. The slots themselves never move
        // during a reorder — only which button sits in each does — so a single
        // measurement is enough for the whole drag. Re-measuring per move used
        // to force a synchronous relayout on every event AND read rects while
        // the FLIP animations were still running, so the drop target flickered
        // between two indices as the buttons crossed.
        const container = containerRef.current;
        if (container) {
          const all = Array.from(container.querySelectorAll<HTMLElement>('[data-tool]'));
          const rects = all.map((el) => el.getBoundingClientRect());
          const own = rects[fromIndex];
          // Slots differ in width — a group carries its chevron — so each landing
          // spot is laid out from the measured widths rather than one fixed pitch.
          if (own) {
            const [r0, r1] = rects;
            const gap = r0 && r1 ? r1.left - r0.right : 0;
            let x = r0?.left ?? own.left;
            lefts = [];
            for (const r of rects.filter((_, k) => k !== fromIndex)) {
              lefts.push(x);
              x += r.width + gap;
            }
            lefts.push(x);
            originLeft = own.left;
          }
          draggedBtn = all[fromIndex] ?? null;
          if (draggedBtn) {
            draggedBtn.style.willChange = 'translate';
            // Capture only once the drag is real, so a plain click on a tool
            // keeps its untouched default pointerdown → pointerup → click path.
            capturePointer({ target: draggedBtn, pointerId });
          }
        }
      };

      const sampler = pointerSampler({
        event: e,
        onFrame: (px, py) => {
          // Nearest landing spot to where the slot is being held, from the
          // snapshotted layout — no DOM reads, so moves never invalidate layout.
          const held = originLeft + (px - startX);
          let next = to;
          let nearest = Number.POSITIVE_INFINITY;
          for (const [k, left] of lefts.entries()) {
            if (Math.abs(left - held) < nearest) {
              nearest = Math.abs(left - held);
              next = k;
            }
          }
          const target = visibleSlots.value[next];
          if (next !== to && target) {
            // Optimistically reorder so the user sees a live preview; FLIP
            // smooths each cross for the OTHER buttons (the dragged button is
            // excluded via [data-dragging] and its position is set manually).
            moveSlot({ slot, to: target });
            to = next;
          }
          // Cursor-follow: offset the slot from wherever the reorder has put its
          // CSS position, so the cursor stays on the same point of it.
          if (draggedBtn) {
            lastDx = held - (lefts[to] ?? originLeft);
            lastDy = py - startY;
            draggedBtn.style.translate = `${lastDx}px ${lastDy}px`;
          }
        },
      });

      const onMove = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        if (!activated) {
          if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 4) return;
          activate();
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
        setDraggingSlot(null);
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

  return { draggingSlot, onPointerDown, consumeClickSuppression };
}

function ExpandedToolbar({ onMinimize, drag }: { onMinimize: () => void; drag: DragApi }) {
  const slots = visibleSlots.value;
  // The faces are read here so the FLIP pass re-runs when a group swaps its icon.
  const toolsRef = useFlipReorder([slots, groupFaces.value]);
  const reorder = useToolReorder(toolsRef);

  // `data-ml-tb` hooks the landing page's staggered entrance
  // (apps/worker/web/style.css). Attributes only: nothing reads them here, and
  // the animation is scoped to `.lp-toolbar-in`, so the Viewer and the
  // extension are unaffected.
  return (
    <BaseToolbar.Root data-ml-tb="row" className="flex items-center gap-1" style={{ '--tb-n': slots.length }}>
      {/* Each `Toggle` is controlled from `activeTool` directly rather than wrapped
          in a `ToggleGroup`: the signal is already the single source of the pressed
          state, and the group's composite machinery — a childList MutationObserver
          that re-sorts every button with `compareDocumentPosition` on each render —
          re-ran on every slot crossing of a reorder, on top of the FLIP pass. */}
      <div ref={toolsRef} data-ml-tb="tools" class="flex gap-1 items-center">
        {slots.map((t, i) => {
          const face = slotTool(t);
          return (
            <SlotFrame key={t} slot={t} index={i} dragging={reorder.draggingSlot === t}>
              <ToolToggle
                slot={t}
                tip={lbl(face)}
                shortcut={SHORTCUTS[face]}
                reorderIndex={i}
                onReorderPointerDown={reorder.onPointerDown}
                // The click that lands a reorder must not also switch tools.
                onSelect={(next) => {
                  if (!reorder.consumeClickSuppression()) selectTool({ tool: next, via: 'toolbar' });
                }}
                draggingSlot={reorder.draggingSlot}
              />
              {isToolGroup(t) && <GroupMenu group={t} />}
              {t === 'inspect' && <CountBadge value={inspectorStack.value.length} />}
            </SlotFrame>
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
          {openAnnotationTotal.value > 0 && (
            <Ctl
              icon="copy"
              onClick={() => copyOpenAnnotations({ ops: operations.value, url: location.href })}
              tip="Copy all open for AI"
              action="copy_all_for_ai"
            />
          )}
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
