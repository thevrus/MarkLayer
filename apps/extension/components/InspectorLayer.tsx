import { useComputed, useSignal, useSignalEffect } from '@preact/signals';
import { clsx } from 'clsx';
import { useCallback, useEffect, useRef } from 'preact/hooks';
import { glass } from '../lib/glass';
import { Icon } from '../lib/icons';
import { getSelector, type SelectedInfo, shortClassLabel, snapshotElement } from '../lib/selector';
import { activeTool, copyText } from '../lib/state';

export interface HoverState {
  el: Element;
  rect: DOMRect;
  /** Lazily filled after an 80ms debounce — `getSelector` walks the DOM. */
  selector: string | null;
}

export function HoverHighlight({ state }: { state: HoverState }) {
  const { rect } = state;
  return (
    <>
      <div
        class="fixed z-2147483646 pointer-events-none rounded-[2px]"
        style={{
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
          background: 'oklch(0.65 0.15 300 / 0.07)',
          boxShadow:
            '0 0 0 1.5px oklch(0.65 0.15 300 / 0.85), 0 0 0 4px oklch(0.65 0.15 300 / 0.16), 0 0 16px oklch(0.65 0.15 300 / 0.22)',
          transition: 'left 80ms ease, top 80ms ease, width 80ms ease, height 80ms ease',
        }}
      />
      <HoverTooltip state={state} />
    </>
  );
}

function HoverTooltip({ state }: { state: HoverState }) {
  const { el, rect, selector } = state;
  const tag = el.tagName.toLowerCase();
  const id = el.id;
  const classes = shortClassLabel(el);
  const top = Math.max(0, rect.top - 28);
  return (
    <div
      class="fixed z-2147483647 pointer-events-none inline-flex items-center gap-2 rounded-[8px]
             whitespace-nowrap font-mono text-[11px] leading-[1.1] tracking-[0.01em]"
      style={{
        left: rect.left,
        top,
        padding: '5px 9px 5px 6px',
        background: 'oklch(0.22 0.015 300 / 0.96)',
        color: 'oklch(0.92 0.01 300)',
        border: '1px solid oklch(1 0 0 / 0.06)',
        boxShadow:
          '0 1px 0 0 oklch(1 0 0 / 0.05) inset, 0 6px 20px oklch(0 0 0 / 0.35), 0 0 0 0.5px oklch(0 0 0 / 0.4)',
        backdropFilter: 'blur(10px) saturate(140%)',
        WebkitBackdropFilter: 'blur(10px) saturate(140%)',
        transition: 'left 80ms ease, top 80ms ease, opacity 120ms ease',
      }}
    >
      <span
        style={{
          padding: '2px 6px',
          borderRadius: 5,
          background: 'oklch(0.65 0.15 300 / 0.22)',
          color: 'oklch(0.86 0.08 300)',
          fontWeight: 600,
          fontSize: 10.5,
          letterSpacing: '0.02em',
        }}
      >
        {tag}
      </span>
      {id ? (
        <span style={{ color: 'oklch(0.78 0.14 145)' }}>#{id}</span>
      ) : classes ? (
        <span style={{ color: 'oklch(0.78 0.13 80)' }}>.{classes}</span>
      ) : selector ? (
        <span style={{ color: 'oklch(0.7 0.04 260)' }}>
          {selector.length > 48 ? `…${selector.slice(-47)}` : selector}
        </span>
      ) : null}
      <span style={{ color: 'oklch(1 0 0 / 0.18)' }}>·</span>
      <span style={{ color: 'oklch(1 0 0 / 0.5)', fontVariantNumeric: 'tabular-nums' }}>
        {Math.round(rect.width)}×{Math.round(rect.height)}
      </span>
    </div>
  );
}

export type { SelectedInfo };

export function SelectedPanel({ state, onClose }: { state: SelectedInfo; onClose: () => void }) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const setTaRef = useCallback((el: HTMLTextAreaElement | null) => {
    taRef.current = el;
    el?.focus();
  }, []);

  const buildPrompt = () => {
    const comment = taRef.current?.value.trim() || '';
    if (comment) {
      return `## Task\n\n${comment}\n\n${state.markdown}`;
    }
    return state.markdown;
  };

  const copySelector = () => copyText(state.selector, 'Selector copied!');
  const copyForAI = () => copyText(buildPrompt(), 'Copied for AI!');

  // Drag-to-reposition. Offset is applied as a transform on top of the auto-anchored
  // base position so the panel keeps following the element on scroll while honoring
  // the user's drag. Reset whenever a different element is picked.
  const dragOffset = useSignal<{ x: number; y: number } | null>(null);
  const dragStart = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null);
  const lastSelector = useRef(state.selector);
  if (lastSelector.current !== state.selector) {
    lastSelector.current = state.selector;
    dragOffset.value = null;
  }

  const onDragPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    if (e.target instanceof Element && e.target.closest('button')) return;
    e.preventDefault();
    const cur = dragOffset.value ?? { x: 0, y: 0 };
    dragStart.current = { px: e.clientX, py: e.clientY, ox: cur.x, oy: cur.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onDragPointerMove = (e: PointerEvent) => {
    const ds = dragStart.current;
    if (!ds) return;
    dragOffset.value = { x: ds.ox + (e.clientX - ds.px), y: ds.oy + (e.clientY - ds.py) };
  };

  const onDragPointerUp = (e: PointerEvent) => {
    if (!dragStart.current) return;
    dragStart.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
  };

  const margin = 8;
  const panelX = Math.min(state.rect.right + 12, innerWidth - 320 - margin);
  // Anchor panel beside the element. Grow downward from element top by default;
  // if there's more room above, anchor the panel's bottom edge to the element's bottom and grow up.
  const downRoom = innerHeight - state.rect.top - margin;
  const upRoom = state.rect.bottom - margin;
  const growUp = upRoom > downRoom;
  const posStyle: Record<string, string | number> = {
    left: Math.max(margin, panelX),
    maxHeight: Math.max(200, growUp ? upRoom : downRoom),
  };
  if (growUp) {
    posStyle.bottom = Math.max(margin, innerHeight - state.rect.bottom);
  } else {
    posStyle.top = Math.max(margin, state.rect.top);
  }
  const offset = dragOffset.value;
  if (offset) {
    posStyle.transform = `translate(${offset.x}px, ${offset.y}px)`;
  }

  return (
    <div
      class={clsx(
        'fixed z-[2147483647] pointer-events-auto w-[320px] flex flex-col overflow-hidden',
        glass.surface,
        glass.font,
      )}
      style={posStyle}
      onClick={(e) => e.stopPropagation()}
    >
      <div class="shrink-0">
        <div
          class="flex items-center justify-between px-4 pt-3 pb-1.5 cursor-move select-none touch-none"
          onPointerDown={onDragPointerDown}
          onPointerMove={onDragPointerMove}
          onPointerUp={onDragPointerUp}
          onPointerCancel={onDragPointerUp}
        >
          <span class="text-[10.5px] text-ml-glass-fg/65 font-bold uppercase tracking-[0.08em]">Element Inspector</span>
          <button
            type="button"
            aria-label="Close inspector"
            onClick={onClose}
            class="text-ml-glass-fg/65 hover:text-ml-glass-fg bg-transparent border-none cursor-pointer
                   inline-flex items-center justify-center w-7 h-7 -mr-1 rounded-md
                   hover:bg-ml-glass-fg/8 active:scale-[0.94] transition-[color,background-color,transform] duration-150"
          >
            <Icon name="close" size={14} />
          </button>
        </div>

        <div class="px-3.5 pb-2.5">
          <textarea
            ref={setTaRef}
            placeholder="What should change on this element?"
            rows={2}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                copyForAI();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                onClose();
              }
            }}
            class={clsx(
              'w-full bg-ml-glass-fg/4 border border-ml-glass-fg/12 rounded-xl px-3.5 py-2.5',
              'text-ml-glass-fg text-[13.5px] leading-relaxed',
              'resize-none outline-none min-h-10 max-h-[100px]',
              'caret-[oklch(0.65_0.15_300)]',
              'transition-[border-color,background-color,box-shadow] duration-150',
              'focus:border-[oklch(0.65_0.15_300/0.5)]',
              'focus:shadow-[0_0_0_3px_oklch(0.65_0.15_300/0.12),inset_0_0.5px_0_oklch(1_0_0/0.04)]',
              'focus:bg-ml-glass-fg/6',
              'placeholder:text-ml-glass-fg/45',
              glass.font,
            )}
            style={{ fieldSizing: 'content', boxSizing: 'border-box' }}
          />
        </div>

        <div class="flex items-center justify-between px-4 pb-2.5">
          <div class="flex items-center gap-2">
            <kbd
              class="text-[10.5px] text-ml-glass-fg/75 bg-ml-glass-fg/8 border border-ml-glass-fg/15
                        rounded-md px-1.5 py-0.5 font-mono font-medium leading-none"
            >
              ⌘↵
            </kbd>
            <span class="text-[11px] text-ml-glass-fg/55 font-medium">copy</span>
          </div>
          <button
            type="button"
            onClick={copyForAI}
            class="px-5 py-1.5 text-[12px] font-semibold rounded-[10px] border-none cursor-pointer
                   bg-linear-to-b from-[oklch(0.68_0.15_300)] to-[oklch(0.58_0.15_300)]
                   text-white
                   shadow-[inset_0_1px_0_oklch(1_0_0/0.15),0_1px_3px_oklch(0_0_0/0.2)]
                   transition-[box-shadow,transform] duration-150
                   hover:from-[oklch(0.72_0.15_300)] hover:to-[oklch(0.62_0.15_300)]
                   hover:shadow-[inset_0_1px_0_oklch(1_0_0/0.2),0_2px_16px_oklch(0.65_0.15_300/0.2)]
                   active:scale-[0.96]"
          >
            Copy for AI ↵
          </button>
        </div>
      </div>

      <div class={clsx(glass.divider, 'mx-3.5 shrink-0')} />

      <div class="overflow-y-auto min-h-0">
        <div class="px-4 py-2.5">
          <div class="flex items-center justify-between mb-1.5">
            <span class="text-[10.5px] text-ml-glass-fg/65 font-bold uppercase tracking-[0.08em]">Selector</span>
            <button
              type="button"
              onClick={copySelector}
              class="text-[11px] font-medium text-ml-glass-fg/65 hover:text-ml-glass-fg bg-transparent border-none cursor-pointer p-0 transition-colors"
            >
              Copy
            </button>
          </div>
          <code
            class="block text-[11.5px] text-ml-glass-fg bg-ml-glass-fg/4 border border-ml-glass-fg/12
                   rounded-lg px-3 py-1.5 break-all font-mono leading-relaxed select-all max-h-[60px] overflow-y-auto"
          >
            {state.selector}
          </code>
        </div>

        <div class="px-4 pb-2">
          <div class="flex flex-wrap gap-x-4 gap-y-1 text-[11.5px]">
            <span>
              <span class="text-ml-glass-fg/55 font-medium">Tag </span>
              <span class="text-ml-glass-fg font-mono">&lt;{state.tag}&gt;</span>
            </span>
            <span>
              <span class="text-ml-glass-fg/55 font-medium">Size </span>
              <span class="text-ml-glass-fg font-mono tabular-nums">
                {Math.round(state.rect.width)}×{Math.round(state.rect.height)}
              </span>
            </span>
          </div>
          {state.id && (
            <div class="text-[11.5px] mt-1">
              <span class="text-ml-glass-fg/55 font-medium">ID </span>
              <span class="text-ml-glass-fg font-mono">{state.id}</span>
            </div>
          )}
          {state.classes && (
            <div class="text-[11.5px] mt-1">
              <span class="text-ml-glass-fg/55 font-medium">Classes </span>
              <span class="text-ml-glass-fg/85 font-mono text-[10.5px] break-all line-clamp-2">{state.classes}</span>
            </div>
          )}
          {state.text && (
            <div class="text-[11.5px] mt-1">
              <span class="text-ml-glass-fg/55 font-medium">Text </span>
              <span class="text-ml-glass-fg/80 italic line-clamp-2">"{state.text}"</span>
            </div>
          )}
        </div>

        {Object.keys(state.styles).length > 0 && (
          <>
            <div class={clsx(glass.divider, 'mx-3.5')} />
            <div class="px-4 py-2.5">
              <span class="text-[10.5px] text-ml-glass-fg/65 font-bold uppercase tracking-[0.08em]">Styles</span>
              <div class="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[10.5px] font-mono">
                {Object.entries(state.styles).map(([k, v]) => (
                  <div key={k} class="contents">
                    <span class="text-ml-glass-fg/65">{k}</span>
                    <span class="text-ml-glass-fg/85 truncate">{v}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function SelectedHighlight({ rect }: { rect: DOMRect }) {
  return (
    <div
      class="fixed z-2147483646 pointer-events-none border-2 border-[oklch(0.65_0.15_300)] rounded-sm"
      style={{
        left: rect.left - 2,
        top: rect.top - 2,
        width: rect.width + 4,
        height: rect.height + 4,
        background: 'oklch(0.65 0.15 300 / 0.1)',
      }}
    />
  );
}

function isExtensionElement(el: Element | null): boolean {
  if (!el) return true;
  if (el.tagName === 'MARK-LAYER') return true;
  if (el.hasAttribute('data-marklayer-inspect')) return true;
  return !!el.closest('mark-layer');
}

export function InspectorLayer() {
  const selected = useSignal<SelectedInfo | null>(null);
  // Boolean projection so rect writes don't retrigger the rect-sync effect setup.
  const hasSelected = useComputed(() => selected.value !== null);
  const hover = useSignal<HoverState | null>(null);
  const selectorTimer = useRef(0);
  const lastEl = useRef<Element | null>(null);
  const selectedElRef = useRef<Element | null>(null);

  const clearHover = () => {
    hover.value = null;
    lastEl.current = null;
    clearTimeout(selectorTimer.current);
  };

  const pick = (el: Element) => {
    clearHover();
    selectedElRef.current = el;
    selected.value = snapshotElement(el, getSelector(el), el.getBoundingClientRect());
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (activeTool.value !== 'inspect' || selected.value) return;
      const el = e.target instanceof Element ? e.target : null;
      if (isExtensionElement(el)) {
        hover.value = null;
        return;
      }
      if (!el || el === lastEl.current) return;
      lastEl.current = el;

      const rect = el.getBoundingClientRect();
      hover.value = { el, rect, selector: null };

      clearTimeout(selectorTimer.current);
      selectorTimer.current = window.setTimeout(() => {
        if (lastEl.current !== el) return;
        hover.value = { el, rect, selector: getSelector(el) };
      }, 80);
    };

    const onClick = (e: MouseEvent) => {
      if (activeTool.value !== 'inspect') return;
      const el = e.target instanceof Element ? e.target : null;
      if (!el || isExtensionElement(el)) return;

      e.preventDefault();
      e.stopPropagation();
      pick(el);
    };

    window.addEventListener('mousemove', onMove, true);
    window.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('mousemove', onMove, true);
      window.removeEventListener('click', onClick, true);
    };
  }, []);

  useSignalEffect(() => {
    if (!hasSelected.value) return;
    let raf = 0;
    const sync = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const el = selectedElRef.current;
        if (!el) return;
        if (!el.isConnected) {
          selected.value = null;
          selectedElRef.current = null;
          return;
        }
        const rect = el.getBoundingClientRect();
        const cur = selected.peek();
        if (!cur) return;
        if (
          cur.rect.x === rect.x &&
          cur.rect.y === rect.y &&
          cur.rect.width === rect.width &&
          cur.rect.height === rect.height
        ) {
          return;
        }
        selected.value = { ...cur, rect };
      });
    };
    window.addEventListener('scroll', sync, true);
    window.addEventListener('resize', sync);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', sync, true);
      window.removeEventListener('resize', sync);
    };
  });

  // Reset on tool change
  useSignalEffect(() => {
    if (activeTool.value === 'inspect') return;
    clearHover();
    selected.value = null;
    selectedElRef.current = null;
  });

  // Set cursor on body while inspect is active
  useSignalEffect(() => {
    if (activeTool.value !== 'inspect') return;
    document.body.style.cursor = 'crosshair';
    return () => {
      document.body.style.cursor = '';
    };
  });

  if (activeTool.value !== 'inspect') return null;

  return (
    <>
      {hover.value && !selected.value && <HoverHighlight state={hover.value} />}
      {selected.value && (
        <>
          <SelectedHighlight rect={selected.value.rect} />
          <SelectedPanel
            state={selected.value}
            onClose={() => {
              selected.value = null;
            }}
          />
        </>
      )}
    </>
  );
}
