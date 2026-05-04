import { cn } from '@marklayer/types';
import { useComputed, useSignal, useSignalEffect } from '@preact/signals';
import type { TargetedEvent } from 'preact';
import { useCallback, useEffect, useRef } from 'preact/hooks';
import { detectFrameworkComponent, type FrameworkComponent } from '../lib/fiber-bridge';
import { glass } from '../lib/glass';
import { BrandIcon, type BrandIconName, Icon } from '../lib/icons';
import { getSelector, type SelectedInfo, shortClassLabel, snapshotElement } from '../lib/selector';
import {
  activeTool,
  addToInspectorStack,
  clearInspectorStack,
  copyInspectorStack,
  copyText,
  inspectorStack,
  inspectorStackOpen,
  removeFromInspectorStack,
  toast,
} from '../lib/state';

export interface HoverState {
  el: Element;
  rect: DOMRect;
  /** Lazily filled after an 80ms debounce — `getSelector` walks the DOM. */
  selector: string | null;
  /** Lazily filled after the same debounce — costs a CustomEvent round-trip to the bridge. */
  component: FrameworkComponent | null;
}

/** Hue per framework — React cyan, Vue green, Svelte orange. Match brand colors approximately. */
const FRAMEWORK_HUES: Record<FrameworkComponent['framework'], number> = { React: 220, Vue: 155, Svelte: 30 };

function frameworkColor(framework: FrameworkComponent['framework']): string {
  return `oklch(0.88 0.11 ${FRAMEWORK_HUES[framework]})`;
}

function frameworkBadgeStyle(framework: FrameworkComponent['framework']) {
  const hue = FRAMEWORK_HUES[framework];
  return {
    background: `oklch(0.65 0.16 ${hue} / 0.24)`,
    color: `oklch(0.88 0.11 ${hue})`,
  };
}

const FRAMEWORK_BRAND: Record<FrameworkComponent['framework'], BrandIconName> = {
  React: 'react',
  Vue: 'vue',
  Svelte: 'svelte',
};

const sectionHeader = 'text-[10.5px] text-ml-glass-fg/65 font-bold uppercase tracking-[0.08em]';

const metaLabel = 'text-[10px] text-ml-glass-fg/55 font-semibold uppercase tracking-[0.06em] tabular-nums';

export function HoverHighlight({ state }: { state: HoverState }) {
  const { rect } = state;
  return (
    <>
      <div
        class="fixed z-2147483646 pointer-events-none rounded-xs animate-[fadeIn_120ms_ease-out]"
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
  const { el, rect, selector, component } = state;
  const tag = el.tagName.toLowerCase();
  const id = el.id;
  const classes = shortClassLabel(el);
  const top = Math.max(4, rect.top - 32);
  const componentName = component?.chain[0];
  return (
    <div
      class="fixed z-2147483647 pointer-events-none inline-flex items-center gap-2 rounded-[8px]
             whitespace-nowrap font-mono text-[11px] leading-[1.1] tracking-[0.01em]
             animate-[fadeIn_140ms_ease-out]"
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
      {component && componentName && (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '2px 6px 2px 5px',
            borderRadius: 5,
            fontWeight: 600,
            fontSize: 10.5,
            letterSpacing: '0.01em',
            ...frameworkBadgeStyle(component.framework),
          }}
        >
          <BrandIcon name={FRAMEWORK_BRAND[component.framework]} size={11} />
          {componentName}
        </span>
      )}
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
  const addToStack = () => {
    const comment = taRef.current?.value.trim() || '';
    addToInspectorStack({
      selector: state.selector,
      comment,
      markdown: state.markdown,
    });
    const count = inspectorStack.value.length;
    toast(`Added to stack (${count})`, 'success', 2000);
    onClose();
  };

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

  const onDragPointerDown = (e: TargetedEvent<HTMLDivElement, PointerEvent>) => {
    if (e.button !== 0) return;
    if (e.target instanceof Element && e.target.closest('button')) return;
    e.preventDefault();
    const cur = dragOffset.value ?? { x: 0, y: 0 };
    dragStart.current = { px: e.clientX, py: e.clientY, ox: cur.x, oy: cur.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onDragPointerMove = (e: TargetedEvent<HTMLDivElement, PointerEvent>) => {
    const ds = dragStart.current;
    if (!ds) return;
    dragOffset.value = { x: ds.ox + (e.clientX - ds.px), y: ds.oy + (e.clientY - ds.py) };
  };

  const onDragPointerUp = (e: TargetedEvent<HTMLDivElement, PointerEvent>) => {
    if (!dragStart.current) return;
    dragStart.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
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
      class={cn(
        'fixed z-2147483647 pointer-events-auto w-[320px] flex flex-col overflow-hidden',
        'animate-[fadeIn_180ms_cubic-bezier(0.16,1,0.3,1)]',
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
          <span class={sectionHeader}>Element Inspector</span>
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
                if (e.shiftKey) addToStack();
                else copyForAI();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                onClose();
              }
            }}
            class={cn(
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

        <div class="flex flex-col gap-2 px-4 pb-2.5">
          <div class="flex items-stretch gap-2">
            <button
              type="button"
              onClick={addToStack}
              title="Collect multiple element changes, then copy them as one prompt"
              class="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold rounded-[10px]
                     cursor-pointer whitespace-nowrap
                     bg-ml-glass-fg/6 text-ml-glass-fg/85 border border-ml-glass-fg/15
                     transition-[background-color,border-color,color,transform] duration-150
                     hover:bg-ml-glass-fg/10 hover:text-ml-glass-fg hover:border-ml-glass-fg/25
                     active:scale-[0.96]"
            >
              Add to stack
            </button>
            <button
              type="button"
              onClick={copyForAI}
              title="Copy prompt to clipboard"
              class="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold rounded-[10px]
                     cursor-pointer whitespace-nowrap
                     bg-ml-glass-fg/6 text-ml-glass-fg/85 border border-ml-glass-fg/15
                     transition-[background-color,border-color,color,transform] duration-150
                     hover:bg-ml-glass-fg/10 hover:text-ml-glass-fg hover:border-ml-glass-fg/25
                     active:scale-[0.96]"
            >
              Copy
            </button>
          </div>
        </div>
      </div>

      <div class={cn(glass.divider, 'mx-3.5 shrink-0')} />

      <div class="overflow-y-auto min-h-0">
        <div class="px-4 pt-2.5 pb-3">
          <div class="flex items-center justify-between mb-1.5">
            <span class={sectionHeader}>Selector</span>
            <button
              type="button"
              onClick={copySelector}
              aria-label="Copy selector"
              class="text-[11px] font-medium text-ml-glass-fg/65 hover:text-ml-glass-fg bg-transparent border-none cursor-pointer p-0 transition-colors"
            >
              Copy
            </button>
          </div>
          <code
            class="block text-[11.5px] text-ml-glass-fg bg-ml-glass-fg/4 border border-ml-glass-fg/12
                   rounded-xl px-3 py-2 wrap-break-word font-mono leading-[1.55] select-all max-h-17 overflow-y-auto"
          >
            {state.selector}
          </code>
        </div>

        <div class={cn(glass.divider, 'mx-3.5')} />

        <div class="px-4 pt-3 pb-3">
          <dl class="grid grid-cols-[58px_1fr] gap-x-3 gap-y-1.5 items-baseline text-[11.5px]">
            <dt class={metaLabel}>Tag</dt>
            <dd class="text-ml-glass-fg font-mono">&lt;{state.tag}&gt;</dd>

            <dt class={metaLabel}>Size</dt>
            <dd class="text-ml-glass-fg font-mono tabular-nums">
              {Math.round(state.rect.width)}×{Math.round(state.rect.height)}
            </dd>

            <dt class={metaLabel}>Viewport</dt>
            <dd class="text-ml-glass-fg font-mono tabular-nums">
              {state.viewport.width}×{state.viewport.height}
              {state.viewport.dpr !== 1 && <span class="text-ml-glass-fg/55"> @ {state.viewport.dpr}x</span>}
            </dd>

            {state.component?.chain.length ? (
              <>
                <dt
                  class={cn(metaLabel, 'inline-flex items-center gap-1')}
                  style={{ color: frameworkColor(state.component.framework) }}
                >
                  <BrandIcon name={FRAMEWORK_BRAND[state.component.framework]} size={11} />
                  {state.component.framework}
                </dt>
                <dd class="text-ml-glass-fg font-mono wrap-break-word">{state.component.chain.join(' ← ')}</dd>
              </>
            ) : null}

            {state.cssStack === 'Tailwind' && (
              <>
                <dt class={cn(metaLabel, 'inline-flex items-center gap-1')} style={{ color: 'oklch(0.78 0.13 200)' }}>
                  <BrandIcon name="tailwind" size={11} />
                  CSS
                </dt>
                <dd class="text-ml-glass-fg font-mono">Tailwind</dd>
              </>
            )}

            {state.component?.source && (
              <>
                <dt class={metaLabel}>Source</dt>
                <dd class="text-ml-glass-fg font-mono break-all">
                  {shortenSourcePath(state.component.source.fileName)}
                  <span class="text-ml-glass-fg/55">:{state.component.source.lineNumber}</span>
                </dd>
              </>
            )}

            {state.id && (
              <>
                <dt class={metaLabel}>ID</dt>
                <dd class="text-ml-glass-fg font-mono wrap-break-word">{state.id}</dd>
              </>
            )}

            {state.classes && (
              <>
                <dt class={metaLabel}>Classes</dt>
                <dd class="text-ml-glass-fg/90 font-mono text-[10.5px] leading-[1.55] wrap-break-word line-clamp-3">
                  {state.classes}
                </dd>
              </>
            )}

            {state.text && (
              <>
                <dt class={metaLabel}>Text</dt>
                <dd class="text-ml-glass-fg/85 leading-snug line-clamp-2">
                  <span class="text-ml-glass-fg/40">“</span>
                  {state.text}
                  <span class="text-ml-glass-fg/40">”</span>
                </dd>
              </>
            )}
          </dl>
        </div>

        {Object.keys(state.styles).length > 0 && (
          <>
            <div class={cn(glass.divider, 'mx-3.5')} />
            <StylesSection styles={state.styles} />
          </>
        )}
      </div>
    </div>
  );
}

function StylesSection({ styles }: { styles: Record<string, string> }) {
  const open = useSignal(false);
  const count = Object.keys(styles).length;
  return (
    <div class="px-4 py-2.5">
      <button
        type="button"
        onClick={() => {
          open.value = !open.value;
        }}
        aria-expanded={open.value}
        class="group flex items-center justify-between w-full bg-transparent border-none cursor-pointer p-0 text-left"
      >
        <span
          class={cn(
            sectionHeader,
            'inline-flex items-center gap-1.5 group-hover:text-ml-glass-fg/85 transition-colors',
          )}
        >
          Styles
          <span class="text-ml-glass-fg/45 font-medium normal-case tracking-normal tabular-nums">{count}</span>
        </span>
        <span class="text-ml-glass-fg/55 group-hover:text-ml-glass-fg/85 transition-colors">
          <Icon name={open.value ? 'chevUp' : 'chevDown'} size={12} />
        </span>
      </button>
      {open.value && (
        <div class="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[10.5px] font-mono animate-[fadeIn_140ms_ease-out]">
          {Object.entries(styles).map(([k, v]) => (
            <div key={k} class="contents">
              <span class="text-ml-glass-fg/65">{k}</span>
              <span class="text-ml-glass-fg/85 truncate">{v}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Short label for a stack item — last segment of the selector with positional pseudos stripped. */
function stackItemLabel(selector: string): string {
  const last = selector.split('>').pop()?.trim() ?? selector;
  return last.replace(/:nth-(of-type|child)\([^)]+\)/g, '') || selector;
}

/** Compress an absolute source path to last 2 segments for the panel UI; full path stays in markdown. */
function shortenSourcePath(path: string): string {
  const parts = path.split('/').filter(Boolean);
  return parts.length <= 2 ? path : `…/${parts.slice(-2).join('/')}`;
}

/**
 * Floating widget that lists stacked element-inspect entries with a single
 * "Copy all" action so users can hand the whole bundle to an LLM.
 *
 * Rendered separately from SelectedPanel so it stays visible while the user
 * keeps picking new elements.
 */
export function InspectorStackPanel() {
  const items = inspectorStack.value;
  if (!items.length) return null;
  const open = inspectorStackOpen.value;

  return (
    <div
      class={cn(
        'fixed bottom-5 right-5 z-2147483646 pointer-events-auto w-70 flex flex-col overflow-hidden',
        'animate-[fadeIn_220ms_cubic-bezier(0.16,1,0.3,1)]',
        glass.surface,
        glass.font,
      )}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-label={`${open ? 'Collapse' : 'Expand'} stacked elements`}
        onClick={() => {
          inspectorStackOpen.value = !open;
        }}
        class="flex items-center gap-2 px-3.5 py-2.5 bg-transparent border-none cursor-pointer text-left
               hover:bg-ml-glass-fg/5 transition-colors"
      >
        <span
          class="inline-flex items-center justify-center min-w-5.5 h-5.5 px-1.5 rounded-full text-[11px] font-bold tabular-nums
                 bg-[oklch(0.65_0.15_300/0.22)] text-[oklch(0.86_0.08_300)]"
        >
          {items.length}
        </span>
        <span class="text-[11.5px] font-semibold text-ml-glass-fg tracking-[0.01em]">
          Element{items.length === 1 ? '' : 's'} stacked
        </span>
        <span class="ml-auto text-ml-glass-fg/55">
          <Icon name={open ? 'chevDown' : 'chevUp'} size={14} />
        </span>
      </button>

      {open && (
        <>
          <div class={cn(glass.divider, 'mx-3.5 shrink-0')} />
          <div class="max-h-55 overflow-y-auto px-2 py-1.5">
            {items.map((it, i) => (
              <div
                key={it.id}
                class="group flex items-start gap-2 px-2 py-1.5 rounded-lg hover:bg-ml-glass-fg/5 transition-colors"
              >
                <span class="text-[10.5px] text-ml-glass-fg/45 font-mono tabular-nums leading-normal mt-0.5 shrink-0">
                  {i + 1}
                </span>
                <div class="min-w-0 flex-1">
                  <div class="text-[11px] font-mono text-ml-glass-fg/70 truncate">{stackItemLabel(it.selector)}</div>
                  <div class="text-[12px] text-ml-glass-fg/95 leading-snug line-clamp-2">
                    {it.comment || <span class="text-ml-glass-fg/45 italic">No task description</span>}
                  </div>
                </div>
                <button
                  type="button"
                  aria-label="Remove from stack"
                  onClick={() => removeFromInspectorStack(it.id)}
                  class="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity
                         text-ml-glass-fg/55 hover:text-ml-glass-fg bg-transparent border-none cursor-pointer
                         inline-flex items-center justify-center w-6 h-6 rounded-md hover:bg-ml-glass-fg/10 shrink-0"
                >
                  <Icon name="close" size={12} />
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      <div class={cn(glass.divider, 'mx-3.5 shrink-0')} />
      <div class="flex items-center gap-2 px-3 py-2.5">
        <button
          type="button"
          onClick={clearInspectorStack}
          class="px-2.5 py-1.5 text-[11.5px] font-medium rounded-lg cursor-pointer
                 bg-transparent text-ml-glass-fg/65 border border-transparent
                 transition-[background-color,color] duration-150
                 hover:bg-ml-glass-fg/8 hover:text-ml-glass-fg"
        >
          Clear
        </button>
        <button
          type="button"
          onClick={copyInspectorStack}
          title="Copy all to clipboard"
          class="ml-auto px-2.5 py-1.5 text-[11.5px] font-medium rounded-lg cursor-pointer
                 bg-ml-glass-fg/6 text-ml-glass-fg/85 border border-ml-glass-fg/15
                 transition-[background-color,border-color,color] duration-150
                 hover:bg-ml-glass-fg/10 hover:text-ml-glass-fg hover:border-ml-glass-fg/25"
        >
          Copy all
        </button>
      </div>
    </div>
  );
}

export function SelectedHighlight({ rect }: { rect: DOMRect }) {
  return (
    <div
      class="fixed z-2147483646 pointer-events-none border-2 border-[oklch(0.65_0.15_300)] rounded-sm
             animate-[fadeIn_140ms_ease-out]"
      style={{
        left: rect.left - 2,
        top: rect.top - 2,
        width: rect.width + 4,
        height: rect.height + 4,
        background: 'oklch(0.65 0.15 300 / 0.1)',
        boxShadow: '0 0 0 4px oklch(0.65 0.15 300 / 0.12), 0 0 24px oklch(0.65 0.15 300 / 0.2)',
        transition: 'left 120ms ease, top 120ms ease, width 120ms ease, height 120ms ease',
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
      hover.value = { el, rect, selector: null, component: null };

      clearTimeout(selectorTimer.current);
      selectorTimer.current = window.setTimeout(() => {
        if (lastEl.current !== el) return;
        hover.value = { el, rect, selector: getSelector(el), component: detectFrameworkComponent(el) };
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
      <InspectorStackPanel />
    </>
  );
}
