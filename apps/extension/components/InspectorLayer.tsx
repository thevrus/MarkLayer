import { type CommentPriority, cn } from '@marklayer/types';
import { useComputed, useSignal, useSignalEffect } from '@preact/signals';
import { nanoid } from 'nanoid';
import type { TargetedEvent } from 'preact';
import { useCallback, useEffect, useRef } from 'preact/hooks';
import { secondaryBtn, submitBtn, textareaCls } from '../lib/buttons';
import { detectFrameworkComponent, type FrameworkComponent } from '../lib/fiber-bridge';
import { geist } from '../lib/geist';
import { glass } from '../lib/glass';
import { BrandIcon, type BrandIconName, Icon } from '../lib/icons';
import { getSelector, isExtensionElement, type SelectedInfo, shortClassLabel, snapshotElement } from '../lib/selector';
import {
  activeTool,
  addToInspectorStack,
  clearInspectorStack,
  color,
  connectionStatus,
  copyInspectorStack,
  copyText,
  inspectorStack,
  inspectorStackOpen,
  lineWidth,
  localUser,
  outputDetail,
  pushOp,
  removeFromInspectorStack,
  showFrameworkBadges,
  toast,
} from '../lib/state';
import type { InspectOp } from '../lib/types';
import { PRIORITY_META, PriorityPicker } from './PriorityPicker';

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

const metaLabel = 'text-meta text-(--ds-gray-900) font-medium tabular-nums';

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
          background: 'color-mix(in oklab, var(--ds-blue-800) 8%, transparent)',
          boxShadow:
            '0 0 0 1.5px color-mix(in oklab, var(--ds-blue-800) 90%, transparent), 0 0 0 4px color-mix(in oklab, var(--ds-blue-800) 14%, transparent)',
          transition: 'left 80ms ease, top 80ms ease, width 80ms ease, height 80ms ease',
        }}
      />
      <HoverTooltip state={state} />
    </>
  );
}

export function HoverTooltip({ state }: { state: HoverState }) {
  const { el, rect, selector, component } = state;
  const tag = el.tagName.toLowerCase();
  const id = el.id;
  const classes = shortClassLabel(el);
  const top = Math.max(4, rect.top - 32);
  const componentName = component?.chain[0];
  return (
    <div
      class="fixed z-2147483647 pointer-events-none inline-flex items-center gap-2 rounded-[8px]
             whitespace-nowrap font-mono text-meta leading-none tracking-label
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
      {showFrameworkBadges.value && component && componentName && (
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
          background: 'color-mix(in oklab, var(--ds-blue-800) 20%, transparent)',
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
  const priority = useSignal<CommentPriority | undefined>(undefined);
  const setTaRef = useCallback((el: HTMLTextAreaElement | null) => {
    taRef.current = el;
    el?.focus();
  }, []);

  const buildPrompt = () => {
    const comment = taRef.current?.value.trim() || '';
    const priorityLine = priority.value ? `## Priority\n\n${PRIORITY_META[priority.value].label}\n\n` : '';
    if (comment) {
      return `${priorityLine}## Task\n\n${comment}\n\n${state.markdown}`;
    }
    return `${priorityLine}${state.markdown}`;
  };

  const copySelector = () => copyText(state.selector, 'Selector copied');
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

  // Push an InspectOp into the room so an MCP-connected agent can pick it up.
  // Only available when a room is connected — outside the worker viewer there's
  // no realtime sync wired, so the op would just persist locally with no
  // listener, which would be confusing.
  const sendToAgent = () => {
    const comment = taRef.current?.value.trim() || '';
    const op: InspectOp = {
      id: nanoid(),
      tool: 'inspect',
      color: color.value,
      lineWidth: lineWidth.value,
      selector: state.selector,
      tag: state.tag,
      comment: comment || undefined,
      priority: priority.value,
      markdown: state.markdown,
      rect: { x: state.rect.x, y: state.rect.y, width: state.rect.width, height: state.rect.height },
      ts: Date.now(),
      author: localUser.name,
      status: 'open',
      captureViewport: { width: window.innerWidth, height: window.innerHeight },
    };
    pushOp(op);
    toast('Sent to agent', 'success', 2000);
    onClose();
  };
  const canSend = connectionStatus.value === 'connected';

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
        geist.surface,
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
          <span class="text-ui font-semibold tracking-ui text-(--ds-gray-1000)">Element inspector</span>
          <button
            type="button"
            aria-label="Close inspector"
            onClick={onClose}
            class={cn(geist.ctlSm, geist.ctlIdle, '-mr-1')}
          >
            <Icon name="close" size={16} strokeWidth={1.5} />
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
            class={cn(textareaCls, 'w-full min-h-10 max-h-[100px]', glass.font)}
            style={{ fieldSizing: 'content', boxSizing: 'border-box' }}
          />
          <PriorityPicker value={priority.value} onChange={(p) => (priority.value = p)} class="mt-1.5 -ml-1.5" />
        </div>

        <div class="flex flex-col gap-2 px-4 pb-2.5">
          <div class="flex items-stretch gap-2">
            <button
              type="button"
              onClick={addToStack}
              title="Collect multiple element changes, then copy them as one prompt"
              class={cn(secondaryBtn, 'flex-1')}
            >
              Add to stack
            </button>
            <button
              type="button"
              onClick={copyForAI}
              title="Copy prompt to clipboard"
              class={cn(canSend ? secondaryBtn : submitBtn, 'flex-1')}
            >
              Copy
            </button>
            {canSend && (
              <button
                type="button"
                onClick={sendToAgent}
                title="Push to the connected room — an MCP-watching agent will pick it up"
                class={cn(submitBtn, 'flex-1')}
              >
                Send
              </button>
            )}
          </div>
        </div>
      </div>

      <div class={cn(geist.divider, 'mx-3.5 shrink-0')} />

      <div class="overflow-y-auto min-h-0">
        <div class="px-4 pt-2.5 pb-3">
          <div class="flex items-center justify-between mb-1.5">
            <span class={geist.sectionLabel}>Selector</span>
            <button
              type="button"
              onClick={copySelector}
              aria-label="Copy selector"
              class={cn(geist.bareBtn, geist.bareBtnQuiet, 'font-medium')}
            >
              Copy
            </button>
          </div>
          <code
            class="block text-meta text-(--ds-gray-1000) bg-(--ds-gray-alpha-100) border border-(--ds-gray-alpha-400)
                   rounded-md px-3 py-2 wrap-break-word font-mono leading-body select-all max-h-17 overflow-y-auto"
          >
            {state.selector}
          </code>
        </div>

        <div class={cn(geist.divider, 'mx-3.5')} />

        <div class="px-4 pt-3 pb-3">
          <dl class="grid grid-cols-[58px_1fr] gap-x-3 gap-y-1.5 items-baseline text-meta">
            <dt class={metaLabel}>Tag</dt>
            <dd class="text-(--ds-gray-1000) font-mono">&lt;{state.tag}&gt;</dd>

            <dt class={metaLabel}>Size</dt>
            <dd class="text-(--ds-gray-1000) font-mono tabular-nums">
              {Math.round(state.rect.width)}×{Math.round(state.rect.height)}
            </dd>

            <dt class={metaLabel}>Viewport</dt>
            <dd class="text-(--ds-gray-1000) font-mono tabular-nums">
              {state.viewport.width}×{state.viewport.height}
              {state.viewport.dpr !== 1 && <span class="text-(--ds-gray-900)"> @ {state.viewport.dpr}x</span>}
            </dd>

            {showFrameworkBadges.value && state.component?.chain.length ? (
              <>
                <dt
                  class={cn(metaLabel, 'inline-flex items-center gap-1')}
                  style={{ color: frameworkColor(state.component.framework) }}
                >
                  <BrandIcon name={FRAMEWORK_BRAND[state.component.framework]} size={11} />
                  {state.component.framework}
                </dt>
                <dd class="text-(--ds-gray-1000) font-mono wrap-break-word">{state.component.chain.join(' ← ')}</dd>
              </>
            ) : null}

            {state.cssStack === 'Tailwind' && (
              <>
                <dt class={cn(metaLabel, 'inline-flex items-center gap-1')} style={{ color: 'oklch(0.78 0.13 200)' }}>
                  <BrandIcon name="tailwind" size={11} />
                  CSS
                </dt>
                <dd class="text-(--ds-gray-1000) font-mono">Tailwind</dd>
              </>
            )}

            {state.component?.source && (
              <>
                <dt class={metaLabel}>Source</dt>
                <dd class="text-(--ds-gray-1000) font-mono break-all">
                  {shortenSourcePath(state.component.source.fileName)}
                  <span class="text-(--ds-gray-900)">:{state.component.source.lineNumber}</span>
                </dd>
              </>
            )}

            {state.id && (
              <>
                <dt class={metaLabel}>ID</dt>
                <dd class="text-(--ds-gray-1000) font-mono wrap-break-word">{state.id}</dd>
              </>
            )}

            {state.classes && (
              <>
                <dt class={metaLabel}>Classes</dt>
                <dd class="text-(--ds-gray-1000) font-mono text-meta leading-body wrap-break-word line-clamp-3">
                  {state.classes}
                </dd>
              </>
            )}
          </dl>

          {state.text && (
            <blockquote
              class="mt-3 px-3 py-2 rounded-lg text-meta leading-snug line-clamp-3
                     bg-(--ml-syntax-bg) text-(--ml-syntax-quote)
                     border-l-2 border-(--ds-gray-alpha-400)"
            >
              {state.text}
            </blockquote>
          )}
        </div>

        {Object.keys(state.styles).length > 0 && (
          <>
            <div class={cn(geist.divider, 'mx-3.5')} />
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
            geist.sectionLabel,
            'inline-flex items-center gap-1.5 group-hover:text-(--ds-gray-1000) transition-colors',
          )}
        >
          Styles
          <span class="text-(--ds-gray-900) font-medium tabular-nums">{count}</span>
        </span>
        <span class="text-(--ds-gray-900) group-hover:text-(--ds-gray-1000) transition-colors">
          <Icon name={open.value ? 'chevUp' : 'chevDown'} size={12} />
        </span>
      </button>
      <div
        class="grid transition-[grid-template-rows] duration-300 ease-ml-spring"
        style={{ gridTemplateRows: open.value ? '1fr' : '0fr' }}
      >
        <div class="overflow-hidden min-h-0">
          <div
            class="mt-2 px-2.5 py-2 rounded-lg bg-(--ml-syntax-bg)
                   grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-meta font-mono leading-normal"
          >
            {Object.entries(styles).map(([k, v]) => (
              <div key={k} class="contents">
                <span class="text-(--ml-syntax-property) font-semibold">{k}</span>
                <span class="text-(--ml-syntax-value) truncate">{v}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
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
        geist.surface,
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
               hover:bg-(--ds-gray-alpha-100) transition-colors"
      >
        <span
          class="inline-flex items-center justify-center min-w-5.5 h-5.5 px-1.5 rounded-full text-meta font-medium tabular-nums
                 bg-ml-accent/22 text-ml-accent-fg"
        >
          {items.length}
        </span>
        <span class="text-meta font-semibold text-(--ds-gray-1000) tracking-label">
          Element{items.length === 1 ? '' : 's'} stacked
        </span>
        <span class="ml-auto text-(--ds-gray-900)">
          <Icon name={open ? 'chevDown' : 'chevUp'} size={14} />
        </span>
      </button>

      {open && (
        <>
          <div class={cn(geist.divider, 'mx-3.5 shrink-0')} />
          <div class="max-h-55 overflow-y-auto px-2 py-1.5">
            {items.map((it, i) => (
              <div
                key={it.id}
                class="group flex items-start gap-2 px-2 py-1.5 rounded-lg hover:bg-(--ds-gray-alpha-100) transition-colors"
              >
                <span class="text-meta text-(--ds-gray-900) font-mono tabular-nums leading-normal mt-0.5 shrink-0">
                  {i + 1}
                </span>
                <div class="min-w-0 flex-1">
                  <div class="text-meta font-mono text-(--ds-gray-900) truncate">{stackItemLabel(it.selector)}</div>
                  <div class="text-meta text-(--ds-gray-1000) leading-snug line-clamp-2">
                    {it.comment || <span class="text-(--ds-gray-900)">No task description</span>}
                  </div>
                </div>
                <button
                  type="button"
                  aria-label="Remove from stack"
                  onClick={() => removeFromInspectorStack(it.id)}
                  class="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity
                         text-(--ds-gray-900) hover:text-(--ds-gray-1000) bg-transparent border-none cursor-pointer
                         inline-flex items-center justify-center w-6 h-6 rounded-md hover:bg-(--ds-gray-alpha-100) shrink-0"
                >
                  <Icon name="close" size={12} />
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      <div class={cn(geist.divider, 'mx-3.5 shrink-0')} />
      <div class="flex items-center gap-2 px-3 py-2.5">
        <button
          type="button"
          onClick={clearInspectorStack}
          class="px-2.5 py-1.5 text-meta font-medium rounded-lg cursor-pointer
                 bg-transparent text-(--ds-gray-900) border border-transparent
                 transition-[background-color,color] duration-150
                 hover:bg-(--ds-gray-alpha-100) hover:text-(--ds-gray-1000)"
        >
          Clear
        </button>
        <button
          type="button"
          onClick={copyInspectorStack}
          title="Copy all to clipboard"
          class="ml-auto px-2.5 py-1.5 text-meta font-medium rounded-lg cursor-pointer
                 bg-(--ds-gray-alpha-100) text-(--ds-gray-1000) border border-(--ds-gray-alpha-400)
                 transition-[background-color,border-color,color] duration-150
                 hover:bg-(--ds-gray-alpha-100) hover:text-(--ds-gray-1000) hover:border-(--ds-gray-alpha-400)"
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
      class="fixed z-2147483646 pointer-events-none border-2 border-ml-accent rounded-sm
             animate-[fadeIn_140ms_ease-out]"
      style={{
        left: rect.left - 2,
        top: rect.top - 2,
        width: rect.width + 4,
        height: rect.height + 4,
        background: 'color-mix(in oklab, var(--ds-blue-800) 10%, transparent)',
        boxShadow: '0 0 0 4px color-mix(in oklab, var(--ds-blue-800) 14%, transparent)',
        transition: 'left 120ms ease, top 120ms ease, width 120ms ease, height 120ms ease',
      }}
    />
  );
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
    selected.value = snapshotElement(el, getSelector(el), el.getBoundingClientRect(), outputDetail.value);
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
