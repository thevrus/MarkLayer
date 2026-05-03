import { cn } from '@marklayer/types';
import { useSignalEffect } from '@preact/signals';
import type { RefObject } from 'preact';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { glass } from '../lib/glass';
import { Icon } from '../lib/icons';
import {
  activeTool,
  clearAll,
  color,
  cycleTheme,
  isDrawingActive,
  lineWidth,
  onExportPng,
  redo,
  SHORTCUTS,
  setColor,
  showShareDialog,
  TOOLS,
  theme,
  toggleToolbarMinimized,
  toolbarMinimized,
  undo,
} from '../lib/state';
import { Tooltip } from './Tooltip';

const COLORS = ['#b462f5', '#f43f5e', '#f97316', '#facc15', '#22c55e', '#3b82f6', '#ffffff', '#1e1e1e'];
const LINE_WIDTHS = [1, 2, 3, 5, 8, 12, 20];

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
}: {
  name: string;
  active?: boolean;
  onClick: () => void;
  tip: string;
  shortcut?: string;
  accent?: boolean;
  accentColor?: string;
  round?: boolean;
}) {
  const variant = !active ? 'idle' : accent ? 'accent' : 'plain';
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={tip}
      class={cn(
        'group relative appearance-none border-none p-2 cursor-pointer',
        'leading-none inline-flex items-center justify-center min-w-[36px] min-h-[36px]',
        'transition-all duration-150 ease-out outline-none',
        'hover:bg-ml-glass-fg/[0.08] hover:shadow-[inset_0_0.5px_0_var(--ml-glass-border)]',
        'active:bg-ml-glass-fg/[0.04] active:scale-[0.94]',
        'focus-visible:ring-2 focus-visible:ring-ml-glass-fg/40 focus-visible:ring-offset-0',
        round ? 'rounded-full' : 'rounded-xl',
        TOOLBTN_VARIANTS[variant],
      )}
      style={
        variant === 'accent' && accentColor
          ? {
              color: accentColor,
              background: `color-mix(in oklch, ${accentColor} 18%, transparent)`,
            }
          : undefined
      }
    >
      <Icon name={name} />
      <Tooltip text={tip} shortcut={shortcut} />
    </button>
  );
}

type DragApi = {
  dragging: boolean;
  start: (e: MouseEvent | TouchEvent) => void;
  reset: () => void;
};

function useDrag(ref: RefObject<HTMLElement | null>): DragApi {
  const [dragging, setDragging] = useState(false);
  const offsetRef = useRef({ x: 0, y: 0 });

  const start = useCallback(
    (e: MouseEvent | TouchEvent) => {
      e.stopPropagation();
      if ('touches' in e) e.preventDefault();
      const el = ref.current;
      if (!el) return;
      setDragging(true);
      const r = el.getBoundingClientRect();
      const c = 'touches' in e ? e.touches[0] : e;
      offsetRef.current = { x: c.clientX - r.left, y: c.clientY - r.top };
      for (const a of el.getAnimations()) a.cancel();
      Object.assign(el.style, {
        transform: 'none',
        left: `${r.left}px`,
        bottom: 'auto',
        top: `${r.top}px`,
      });
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
  }, [ref]);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent | TouchEvent) => {
      if ('cancelable' in e && e.cancelable) e.preventDefault();
      const el = ref.current;
      if (!el) return;
      const c = 'touches' in e ? e.touches[0] : e;
      const r = el.getBoundingClientRect();
      const x = Math.min(Math.max(c.clientX - offsetRef.current.x, 0), innerWidth - r.width);
      const y = Math.min(Math.max(c.clientY - offsetRef.current.y, 0), innerHeight - r.height);
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
    };
    const end = () => setDragging(false);
    document.addEventListener('mousemove', onMove, { passive: false });
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('mouseup', end);
    document.addEventListener('touchend', end);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('mouseup', end);
      document.removeEventListener('touchend', end);
    };
  }, [dragging, ref]);

  return { dragging, start, reset };
}

function DragGrip({ drag }: { drag: DragApi }) {
  return (
    <div
      onMouseDown={drag.start}
      onTouchStart={drag.start}
      aria-hidden="true"
      class={cn(
        'w-3 h-5 cursor-grab shrink-0 opacity-30 mx-1',
        'hover:opacity-50 transition-opacity duration-200',
        'bg-[radial-gradient(circle,var(--ml-glass-grip)_0.8px,transparent_0.8px)]',
        '[background-size:5px_5px] bg-center bg-repeat',
      )}
      style={drag.dragging ? { cursor: 'grabbing' } : undefined}
    />
  );
}

function ColorPicker() {
  const [open, setOpen] = useState(false);
  return (
    <div class="group relative">
      <button
        type="button"
        aria-label="Pick color"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        class={cn(
          'w-6 h-6 rounded-full border-2 border-ml-glass-fg/[0.12] cursor-pointer',
          'transition-all duration-150 hover:scale-110 hover:border-ml-glass-fg/25',
        )}
        style={{ background: color.value }}
      />
      {open && (
        <div
          role="menu"
          class={cn(
            'absolute bottom-full left-1/2 -translate-x-1/2 mb-2.5 z-10',
            glass.surfaceSmall,
            '!rounded-[10px] p-2 flex gap-1.5',
          )}
        >
          {COLORS.map((c) => (
            <button
              type="button"
              key={c}
              role="menuitemradio"
              aria-label={`Color ${c}`}
              aria-checked={color.value === c}
              onClick={() => {
                setColor(c);
                setOpen(false);
              }}
              class={cn(
                'w-5 h-5 rounded-full border-2 cursor-pointer transition-all duration-150 hover:scale-125',
                color.value === c
                  ? 'border-ml-glass-fg/60 scale-110'
                  : 'border-ml-glass-fg/[0.08] hover:border-ml-glass-fg/25',
              )}
              style={{ background: c }}
            />
          ))}
        </div>
      )}
      <Tooltip text="Color" />
    </div>
  );
}

function StrokeWidthSelect() {
  return (
    <div class="group relative">
      <select
        aria-label="Stroke width"
        value={lineWidth.value}
        onChange={(e) => (lineWidth.value = +e.currentTarget.value)}
        class={cn(
          'h-7 px-2 rounded-lg border border-ml-glass-fg/[0.08] bg-ml-glass-accent/[0.05]',
          'text-ml-glass-fg/50 text-[11px] font-medium cursor-pointer outline-none',
          'transition-all duration-150',
          'hover:border-ml-glass-fg/[0.16] hover:bg-ml-glass-accent/[0.08] hover:text-ml-glass-fg/80',
          'focus-visible:border-[oklch(0.65_0.15_300/0.5)] focus-visible:bg-ml-glass-accent/8',
          'focus-visible:text-ml-glass-fg/80',
          'focus-visible:shadow-[0_0_0_3px_oklch(0.65_0.15_300/0.18)]',
          glass.font,
        )}
      >
        {LINE_WIDTHS.map((v) => (
          <option key={v} value={v} class="bg-[oklch(0.13_0.01_280)] text-[oklch(0.85_0_0)]">
            {v}px
          </option>
        ))}
      </select>
      <Tooltip text="Stroke" />
    </div>
  );
}

const lbl = (t: string) => t[0].toUpperCase() + t.slice(1);

const HISTORY_ACTIONS = [
  { id: 'undo', icon: 'undo', tip: 'Undo', shortcut: '⌘Z', fn: undo },
  { id: 'redo', icon: 'redo', tip: 'Redo', shortcut: '⌘⇧Z', fn: redo },
  { id: 'clear', icon: 'clear', tip: 'Clear all', fn: clearAll },
];

const EXTRA_ACTIONS = [
  {
    id: 'share',
    icon: 'share',
    tip: 'Share',
    fn: () => {
      showShareDialog.value = true;
    },
  },
  {
    id: 'download',
    icon: 'download',
    tip: 'Export PNG',
    fn: () => {
      onExportPng.value?.();
    },
  },
];

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

function ExpandedToolbar({ onMinimize, drag }: { onMinimize: () => void; drag: DragApi }) {
  const [collapsed, setCollapsed] = useState(true);

  return (
    <div class="flex flex-col gap-1.5">
      <div class="flex items-center gap-0.5">
        <div class="flex gap-0.5 items-center">
          {TOOLS.map((t) => (
            <ToolBtn
              key={t}
              name={t}
              active={activeTool.value === t}
              onClick={() => (activeTool.value = t)}
              tip={lbl(t)}
              shortcut={SHORTCUTS[t]}
              accent={t !== 'navigate'}
              accentColor={color.value}
            />
          ))}
        </div>

        <div class={glass.sep} />

        <div class="flex gap-1.5 items-center">
          <ColorPicker />
          <StrokeWidthSelect />
        </div>

        <div class={glass.sep} />

        <div class="flex gap-0.5 items-center">
          {HISTORY_ACTIONS.map((a) => (
            <ToolBtn key={a.id} name={a.icon} onClick={a.fn} tip={a.tip} shortcut={a.shortcut} />
          ))}
        </div>

        <DragGrip drag={drag} />

        <ToolBtn name="minimize" onClick={onMinimize} tip="Minimize" />

        <button
          type="button"
          aria-label={collapsed ? 'Expand toolbar' : 'Collapse toolbar'}
          aria-expanded={!collapsed}
          onClick={() => setCollapsed(!collapsed)}
          class={cn(
            'appearance-none bg-transparent border-none text-ml-glass-fg/20 cursor-pointer p-1.5',
            'inline-flex place-items-center rounded-lg transition-all duration-150 outline-none',
            'hover:text-ml-glass-fg/50 hover:bg-ml-glass-accent/[0.07]',
            'focus-visible:ring-2 focus-visible:ring-ml-glass-fg/40',
          )}
        >
          <Icon name={collapsed ? 'chevDown' : 'chevUp'} size={12} />
        </button>
      </div>

      {!collapsed && (
        <div class="flex items-center gap-0.5 pt-1.5 border-t border-ml-glass-fg/[0.04]">
          {EXTRA_ACTIONS.map((a) => (
            <ToolBtn key={a.id} name={a.icon} onClick={a.fn} tip={a.tip} />
          ))}
          <ToolBtn
            name={theme.value === 'dark' ? 'moon' : 'sun'}
            onClick={cycleTheme}
            tip={theme.value === 'system' ? 'System' : theme.value === 'dark' ? 'Dark' : 'Light'}
          />
        </div>
      )}
    </div>
  );
}

export function Toolbar() {
  const minimized = toolbarMinimized.value;
  const tbRef = useRef<HTMLDivElement>(null);
  const flipFromRef = useRef<DOMRect | null>(null);
  const drag = useDrag(tbRef);
  const fadeAnimRef = useRef<Animation | null>(null);

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
    <div
      ref={tbRef}
      class={cn(
        'fixed bottom-5 left-1/2 -translate-x-1/2 z-2147483646 select-none',
        glass.surface,
        glass.font,
        'text-ml-glass-fg/80 max-w-[calc(100dvw-24px)] w-max',
        minimized ? 'p-1' : 'p-2.5',
      )}
    >
      {minimized ? (
        <MinimizedToolbar onExpand={onToggleMinimize} drag={drag} />
      ) : (
        <ExpandedToolbar onMinimize={onToggleMinimize} drag={drag} />
      )}
    </div>
  );
}
