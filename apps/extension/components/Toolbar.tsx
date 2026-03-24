import { useSignalEffect } from '@preact/signals';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
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
  undo,
} from '../lib/state';

const COLORS = ['#b462f5', '#f43f5e', '#f97316', '#facc15', '#22c55e', '#3b82f6', '#ffffff', '#1e1e1e'];
const LINE_WIDTHS = [1, 2, 3, 5, 8, 12, 20];

function Tooltip({ text, shortcut }: { text: string; shortcut?: string }) {
  return (
    <div
      class="absolute bottom-full left-1/2 -translate-x-1/2 mb-2.5 pointer-events-none
                opacity-0 group-hover:opacity-100 scale-90 group-hover:scale-100
                transition-all duration-150 ease-out z-10"
    >
      <div class={`${glass.surfaceSmall} !rounded-[10px] px-2.5 py-1.5 flex items-center gap-2 whitespace-nowrap`}>
        <span class="text-[11px] text-ml-glass-fg/70 font-medium tracking-[0.01em]">{text}</span>
        {shortcut && (
          <kbd
            class="text-[10px] text-ml-glass-fg/35 bg-ml-glass-accent/[0.06] border border-ml-glass-fg/[0.08]
                      rounded-[5px] px-1.5 py-0.5 font-mono leading-none"
          >
            {shortcut}
          </kbd>
        )}
      </div>
    </div>
  );
}

function ToolBtn({
  name,
  active,
  onClick,
  tip,
  shortcut,
  accent,
  accentColor,
}: {
  name: string;
  active?: boolean;
  onClick: () => void;
  tip: string;
  shortcut?: string;
  accent?: boolean;
  accentColor?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      class={`group relative appearance-none border-none p-2 rounded-xl cursor-pointer
              leading-none inline-flex items-center justify-center min-w-[36px] min-h-[36px]
              transition-all duration-150 ease-out
              hover:bg-ml-glass-fg/[0.08] hover:shadow-[inset_0_0.5px_0_var(--ml-glass-border)]
              active:bg-ml-glass-fg/[0.04] active:scale-[0.94]
              ${
                active
                  ? accent
                    ? 'shadow-[inset_0_0_0_1px_var(--ml-glass-border),inset_0_0.5px_0_var(--ml-glass-border)]'
                    : 'bg-ml-glass-fg/[0.1] text-ml-glass-fg shadow-[inset_0_0.5px_0_var(--ml-glass-border)]'
                  : 'bg-transparent text-ml-glass-fg/45'
              }`}
      style={
        active && accent && accentColor
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

export function Toolbar() {
  const [collapsed, setCollapsed] = useState(true);
  const [showColors, setShowColors] = useState(false);
  const [dragging, setDragging] = useState(false);
  const offsetRef = useRef({ x: 0, y: 0 });
  const tbRef = useRef<HTMLDivElement>(null);

  const lbl = (t: string) => t[0].toUpperCase() + t.slice(1);

  // Fade toolbar while actively drawing
  useSignalEffect(() => {
    const active = isDrawingActive.value;
    tbRef.current?.animate({ opacity: active ? 0.15 : 1 }, { duration: 250, easing: 'ease-out', fill: 'forwards' });
  });

  const startDrag = useCallback((e: MouseEvent | TouchEvent) => {
    e.stopPropagation();
    if ('touches' in e) e.preventDefault();
    const tb = tbRef.current;
    if (!tb) return;
    setDragging(true);
    const r = tb.getBoundingClientRect();
    const c = 'touches' in e ? e.touches[0] : e;
    offsetRef.current = { x: c.clientX - r.left, y: c.clientY - r.top };
    // Cancel entrance animation and override CSS class positioning
    for (const a of tb.getAnimations()) a.cancel();
    Object.assign(tb.style, {
      animation: 'none',
      transform: 'none',
      left: `${r.left}px`,
      bottom: 'auto',
      top: `${r.top}px`,
    });
  }, []);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent | TouchEvent) => {
      if ('cancelable' in e && e.cancelable) e.preventDefault();
      const tb = tbRef.current;
      if (!tb) return;
      const c = 'touches' in e ? e.touches[0] : e;
      const r = tb.getBoundingClientRect();
      const x = Math.min(Math.max(c.clientX - offsetRef.current.x, 0), innerWidth - r.width);
      const y = Math.min(Math.max(c.clientY - offsetRef.current.y, 0), innerHeight - r.height);
      tb.style.left = `${x}px`;
      tb.style.top = `${y}px`;
    };
    const endDrag = () => setDragging(false);
    document.addEventListener('mousemove', onMove, { passive: false });
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('mouseup', endDrag);
    document.addEventListener('touchend', endDrag);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('mouseup', endDrag);
      document.removeEventListener('touchend', endDrag);
    };
  }, [dragging]);

  const acts = [
    {
      id: 'share',
      icon: 'share',
      label: 'Share',
      fn: () => {
        showShareDialog.value = true;
      },
    },
    {
      id: 'download',
      icon: 'download',
      label: 'Export PNG',
      fn: () => {
        onExportPng.value?.();
      },
    },
  ];

  const hist = [
    { id: 'undo', icon: 'undo', tip: 'Undo', shortcut: '⌘Z', fn: undo },
    { id: 'redo', icon: 'redo', tip: 'Redo', shortcut: '⌘⇧Z', fn: redo },
    { id: 'clear', icon: 'clear', tip: 'Clear all', fn: clearAll },
  ];

  return (
    <div
      ref={tbRef}
      class={`fixed bottom-5 left-1/2 z-[2147483646] select-none
              ${glass.surface} ${glass.font}
              p-2.5 text-ml-glass-fg/80 max-w-[calc(100dvw-24px)] w-max`}
      style={{ animation: 'toolbarIn 0.35s cubic-bezier(0.16, 1, 0.3, 1) both' }}
    >
      <div class="flex flex-col gap-1.5">
        {/* Main row */}
        <div class="flex items-center gap-0.5">
          {/* Tools */}
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

          {/* Separator */}
          <div class={glass.sep} />

          {/* Colors + Width */}
          <div class="flex gap-1.5 items-center">
            <div class="group relative">
              <button
                type="button"
                aria-label="Pick color"
                onClick={() => setShowColors(!showColors)}
                class="w-6 h-6 rounded-full border-2 border-ml-glass-fg/[0.12] cursor-pointer
                       transition-all duration-150 hover:scale-110 hover:border-ml-glass-fg/25"
                style={{ background: color.value }}
              />
              {showColors && (
                <div
                  class={`absolute bottom-full left-1/2 -translate-x-1/2 mb-2.5 z-10
                             ${glass.surfaceSmall} !rounded-[10px] p-2 flex gap-1.5`}
                >
                  {COLORS.map((c) => (
                    <button
                      type="button"
                      key={c}
                      onClick={() => {
                        setColor(c);
                        setShowColors(false);
                      }}
                      class={`w-5 h-5 rounded-full border-2 cursor-pointer transition-all duration-150
                              hover:scale-125
                              ${
                                color.value === c
                                  ? 'border-ml-glass-fg/60 scale-110'
                                  : 'border-ml-glass-fg/[0.08] hover:border-ml-glass-fg/25'
                              }`}
                      style={{ background: c }}
                    />
                  ))}
                </div>
              )}
              <Tooltip text="Color" />
            </div>
            <div class="group relative">
              <select
                aria-label="Stroke width"
                value={lineWidth.value}
                onChange={(e) => (lineWidth.value = +(e.target as HTMLSelectElement).value)}
                class={`h-7 px-2 rounded-lg border border-ml-glass-fg/[0.08] bg-ml-glass-accent/[0.05]
                        text-ml-glass-fg/50 text-[11px] font-medium cursor-pointer outline-none
                        transition-all duration-150
                        hover:border-ml-glass-fg/[0.16] hover:bg-ml-glass-accent/[0.08] hover:text-ml-glass-fg/80
                        ${glass.font}`}
              >
                {LINE_WIDTHS.map((v) => (
                  <option key={v} value={v} class="bg-[oklch(0.13_0.01_280)] text-[oklch(0.85_0_0)]">
                    {v}px
                  </option>
                ))}
              </select>
              <Tooltip text="Stroke" />
            </div>
          </div>

          {/* Separator */}
          <div class={glass.sep} />

          {/* History */}
          <div class="flex gap-0.5 items-center">
            {hist.map((a) => (
              <ToolBtn key={a.id} name={a.icon} onClick={a.fn} tip={a.tip} shortcut={a.shortcut} />
            ))}
          </div>

          {/* Grip handle */}
          <div
            onMouseDown={startDrag}
            onTouchStart={startDrag}
            class="w-3.5 h-6 cursor-grab shrink-0 opacity-30 mx-1
                   hover:opacity-50 transition-opacity duration-200
                   bg-[radial-gradient(circle,var(--ml-glass-grip)_0.8px,transparent_0.8px)]
                   [background-size:5px_5px] bg-center bg-repeat"
            style={dragging ? { cursor: 'grabbing' } : undefined}
          />

          {/* Chevron toggle */}
          <button
            type="button"
            aria-label={collapsed ? 'Expand toolbar' : 'Collapse toolbar'}
            onClick={() => setCollapsed(!collapsed)}
            class="appearance-none bg-transparent border-none text-ml-glass-fg/20 cursor-pointer p-1.5
                   inline-flex place-items-center rounded-lg transition-all duration-150
                   hover:text-ml-glass-fg/50 hover:bg-ml-glass-accent/[0.07]"
          >
            <Icon name={collapsed ? 'chevDown' : 'chevUp'} size={12} />
          </button>
        </div>

        {/* Actions row */}
        {!collapsed && (
          <div
            class={`flex items-center gap-0.5 pt-1.5 ${glass.divider.replace('h-px', 'border-t border-ml-glass-fg/[0.04]')}`}
          >
            {acts.map((a) => (
              <ToolBtn key={a.id} name={a.icon} onClick={a.fn} tip={a.label} />
            ))}
            <ToolBtn
              name={theme.value === 'dark' ? 'moon' : 'sun'}
              onClick={cycleTheme}
              tip={theme.value === 'system' ? 'System' : theme.value === 'dark' ? 'Dark' : 'Light'}
            />
          </div>
        )}
      </div>
    </div>
  );
}
