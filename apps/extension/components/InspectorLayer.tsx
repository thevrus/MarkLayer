import { type CommentPriority, cn, type StyleEdit } from '@marklayer/types';
import { useComputed, useSignal, useSignalEffect } from '@preact/signals';
import { PaintbrushVertical } from 'lucide-preact';
import { nanoid } from 'nanoid';
import type { TargetedEvent } from 'preact';
import { useCallback, useEffect, useRef } from 'preact/hooks';
import { tinykeys } from 'tinykeys';
import { track } from '../lib/analytics';
import { secondaryBtn, submitBtn, textareaCls } from '../lib/buttons';
import { detectFrameworkComponent, type FrameworkComponent } from '../lib/fiber-bridge';
import { GLYPH, geist } from '../lib/geist';
import { glass } from '../lib/glass';
import { stepHover } from '../lib/hover-walk';
import { BrandIcon, type BrandIconName, Icon } from '../lib/icons';
import { buildInspectPrompt, canEditCss, inspectFields, stackMarkdown } from '../lib/inspect-note';
import { PRIORITY_META } from '../lib/priority';
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
  outputDetail,
  pushOp,
  removeFromInspectorStack,
  showFrameworkBadges,
  signedBy,
  toast,
} from '../lib/state';
import { isTextEditing } from '../lib/text-edit';
import type { InspectOp } from '../lib/types';
import { BatchSwitch } from './BatchSwitch';
import { CssEditor } from './CssEditor';
import { DictateButton } from './DictateButton';
import { MentionTextarea, useMentions } from './MentionTextarea';
import { PriorityPicker } from './PriorityPicker';

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

export function SelectedPanel({
  state,
  el,
  onClose,
  onStyleChange,
}: {
  state: SelectedInfo;
  /** The picked element, for live CSS editing; null hides the editor. */
  el: Element | null;
  onClose: () => void;
  /** An edit can move or resize the element, so the host re-measures its highlight. */
  onStyleChange?: () => void;
}) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const priority = useSignal<CommentPriority | undefined>(undefined);
  const { mentionProps, mentions } = useMentions();
  const setTaRef = useCallback((el: HTMLTextAreaElement | null) => {
    taRef.current = el;
    el?.focus();
  }, []);
  const styleEdits = useSignal<StyleEdit[]>([]);
  const cssOpen = useSignal(false);
  // Mounted on first open and kept while collapsed: unmounting CssEditor reverts the page, which a collapse must not.
  const cssMounted = useSignal(false);
  const cssAllowed = !!el && canEditCss(inspectorStack.value.length);

  const buildPrompt = () =>
    buildInspectPrompt({
      comment: taRef.current?.value.trim() || '',
      priorityLabel: priority.value && PRIORITY_META[priority.value].label,
      markdown: state.markdown,
      styleEdits: styleEdits.value,
    });

  const copySelector = () => {
    copyText(state.selector, 'Selector copied');
    track('inspector_selector_copied');
  };
  const copyForAI = () => {
    copyText(buildPrompt(), 'Copied for AI!');
    track('inspector_prompt_copied', {
      has_note: Boolean(taRef.current?.value.trim()),
      css_edits: styleEdits.value.length,
      has_priority: Boolean(priority.value),
    });
  };
  const addToStack = () => {
    const comment = taRef.current?.value.trim() || '';
    addToInspectorStack({
      selector: state.selector,
      comment,
      markdown: stackMarkdown({ markdown: state.markdown, styleEdits: styleEdits.value }),
    });
    const count = inspectorStack.value.length;
    track('inspector_stacked', { stack: count, has_note: comment.length > 0, css_edits: styleEdits.value.length });
    toast(`Added to stack (${count})`, { type: 'success', duration: 2000 });
    onClose();
  };

  // Only offered with a room connected: without one, nothing would ever pick the op up.
  // Closing unmounts CssEditor, which reverts the page; the op keeps the edits as a record.
  const sendToAgent = () => {
    const comment = taRef.current?.value.trim() || '';
    const op: InspectOp = {
      id: nanoid(),
      tool: 'inspect',
      color: color.value,
      lineWidth: lineWidth.value,
      ...inspectFields({ ...state, styleEdits: styleEdits.value }),
      comment: comment || undefined,
      priority: priority.value,
      mentions: mentions(),
      ts: Date.now(),
      ...signedBy(),
      status: 'open',
      captureViewport: { width: window.innerWidth, height: window.innerHeight },
    };
    const outcome = pushOp(op);
    track('inspector_sent', {
      held: outcome === 'held',
      has_note: comment.length > 0,
      has_priority: Boolean(op.priority),
      mentions: op.mentions?.length ?? 0,
      css_edits: styleEdits.value.length,
    });
    const toastText = outcome === 'held' ? 'Held until Send' : 'Sent to agent';
    toast(toastText, { type: 'success', duration: 2000 });
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
    // CssEditor reverts the previous element itself when its `el` changes; the record goes with it.
    styleEdits.value = [];
    cssOpen.value = false;
    cssMounted.value = false;
  }

  const toggleCss = () => {
    cssMounted.value = true;
    cssOpen.value = !cssOpen.value;
    track('inspector_css_toggled', { open: cssOpen.value });
  };
  const onCssChange = (edits: StyleEdit[]) => {
    styleEdits.value = edits;
    onStyleChange?.();
  };
  const editCount = styleEdits.value.length;

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
  // Short of room, the panel slides along the viewport instead of shrinking to it: capped
  // at the room beside the element, a mid-screen pick on a laptop scrolled its own body.
  // `100%` in `translate` is the panel's own height.
  const posStyle: Record<string, string | number> = {
    left: Math.max(margin, panelX),
    maxHeight: innerHeight - 2 * margin,
  };
  if (growUp) {
    const bottom = Math.max(margin, innerHeight - state.rect.bottom);
    posStyle.bottom = bottom;
    posStyle.translate = `0 max(0px, calc(100% - ${innerHeight - margin - bottom}px))`;
  } else {
    const top = Math.max(margin, state.rect.top);
    posStyle.top = top;
    posStyle.translate = `0 min(0px, calc(${innerHeight - margin - top}px - 100%))`;
  }
  const handle = state.id ? `#${state.id}` : state.classes ? `.${state.classes.split(/\s+/)[0]}` : '';
  const label = (showFrameworkBadges.value && state.component?.chain[0]) || state.text;
  const subline = [`${Math.round(state.rect.width)}×${Math.round(state.rect.height)}`, label]
    .filter(Boolean)
    .join(' · ');
  const offset = dragOffset.value;
  if (offset) {
    posStyle.transform = `translate(${offset.x}px, ${offset.y}px)`;
  }

  return (
    <div
      role="dialog"
      aria-label="Element inspector"
      class={cn(
        'fixed z-2147483647 pointer-events-auto w-[320px] flex flex-col overflow-hidden',
        'animate-[fadeIn_180ms_cubic-bezier(0.16,1,0.3,1)]',
        geist.surface,
        glass.font,
      )}
      style={posStyle}
      onClick={(e) => e.stopPropagation()}
      // Bubbled from anywhere in the note; a CSS property field and the mention popover
      // stop their own Esc first, and stopping here keeps App's tool exit for the next press.
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return;
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }}
    >
      <div class="shrink-0">
        <div
          class="flex items-start justify-between gap-2 px-4 pt-3 pb-2 cursor-move select-none touch-none"
          onPointerDown={onDragPointerDown}
          onPointerMove={onDragPointerMove}
          onPointerUp={onDragPointerUp}
          onPointerCancel={onDragPointerUp}
        >
          <div class="min-w-0 flex-1">
            <div class="flex items-baseline gap-1.5 font-mono text-ui text-(--ds-gray-1000)">
              <span class="font-semibold shrink-0">&lt;{state.tag}&gt;</span>
              {handle && <span class="truncate text-(--ds-gray-900)">{handle}</span>}
            </div>
            <div class="mt-0.5 truncate text-meta text-(--ds-gray-900)">{subline}</div>
          </div>
          <button
            type="button"
            aria-label="Close inspector"
            onClick={() => {
              track('inspector_closed');
              onClose();
            }}
            class={cn(geist.ctlSm, geist.ctlIdle, '-mr-1 -mt-0.5 shrink-0')}
          >
            <Icon name="close" size={16} strokeWidth={1.5} />
          </button>
        </div>

        <div class="px-3.5 pb-2.5">
          <MentionTextarea
            taRef={setTaRef}
            {...mentionProps}
            placeholder="What should change on this element?"
            rows={2}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                if (e.shiftKey) addToStack();
                else if (canSend) sendToAgent();
                else copyForAI();
              }
            }}
            class={cn(textareaCls, 'w-full min-h-10 max-h-[100px]', glass.font)}
            style={{ fieldSizing: 'content', boxSizing: 'border-box' }}
          />
          <div class="mt-1.5 flex items-center gap-1">
            <PriorityPicker value={priority.value} onChange={(p) => (priority.value = p)} class="-ml-1.5 mr-auto" />
            {cssAllowed && (
              <button
                type="button"
                onClick={toggleCss}
                aria-expanded={cssOpen.value}
                class={cn(
                  geist.ctlXs,
                  geist.ctlLabel,
                  cssOpen.value ? 'bg-(--ds-gray-alpha-200) text-(--ds-gray-1000)' : geist.ctlIdle,
                )}
              >
                <PaintbrushVertical size={14} strokeWidth={GLYPH.strokeWidth} aria-hidden />
                Edit CSS
                {editCount > 0 && <span class="tabular-nums text-(--ds-gray-900)">{editCount}</span>}
              </button>
            )}
            <BatchSwitch />
            <DictateButton field={taRef} />
          </div>
        </div>
      </div>

      {cssAllowed && el && cssMounted.value && (
        <div class={cn('min-h-0 flex-col', cssOpen.value ? 'flex' : 'hidden')}>
          <div class={cn(geist.divider, 'mx-3.5 shrink-0')} />
          <CssEditor el={el} onChange={onCssChange} />
          <div class={cn(geist.divider, 'mx-3.5 shrink-0')} />
        </div>
      )}

      <div class={cn('shrink-0', cssOpen.value && 'pt-2.5')}>
        <div class="flex items-center gap-2 px-4 pb-3">
          <button
            type="button"
            onClick={addToStack}
            title="Collect several elements, then copy them as one prompt"
            class={cn(geist.bareBtn, geist.bareBtnQuiet, 'font-medium mr-auto')}
          >
            Add to stack
          </button>
          <button
            type="button"
            onClick={copyForAI}
            title="Copy prompt to clipboard"
            class={canSend ? secondaryBtn : submitBtn}
          >
            Copy
          </button>
          {canSend && (
            <button
              type="button"
              onClick={sendToAgent}
              title="Push to the connected room: an MCP-watching agent will pick it up"
              class={submitBtn}
            >
              Send
            </button>
          )}
        </div>
      </div>

      <div class="overflow-y-auto min-h-0">
        <div class={cn(geist.divider, 'mx-3.5')} />
        <div class="px-4 py-3">
          <button
            type="button"
            onClick={copySelector}
            title="Copy selector"
            aria-label={`Copy selector ${state.selector}`}
            class="group flex w-full items-start gap-2 px-3 py-2 text-left cursor-pointer rounded-md
                   bg-(--ds-gray-alpha-100) border border-(--ds-gray-alpha-400) transition-colors
                   hover:border-(--ds-gray-700)"
          >
            <code class="min-w-0 flex-1 break-all font-mono text-meta leading-body text-(--ds-gray-1000) line-clamp-2">
              {state.selector}
            </code>
            <span class="mt-0.5 shrink-0 text-(--ds-gray-900) group-hover:text-(--ds-gray-1000) transition-colors">
              <Icon name="copy" size={14} />
            </span>
          </button>
        </div>
        <div class={cn(geist.divider, 'mx-3.5')} />
        <DetailsSection state={state} />
      </div>
    </div>
  );
}

function DetailsSection({ state }: { state: SelectedInfo }) {
  const open = useSignal(false);
  const { styles } = state;
  const component = showFrameworkBadges.value && state.component?.chain.length ? state.component : null;
  return (
    <div class="px-4 py-2.5">
      <button
        type="button"
        onClick={() => {
          open.value = !open.value;
          track('inspector_details_toggled', { open: open.value });
        }}
        aria-expanded={open.value}
        class="group flex items-center justify-between w-full bg-transparent border-none cursor-pointer p-0 text-left"
      >
        <span class={cn(geist.sectionLabel, 'group-hover:text-(--ds-gray-1000) transition-colors')}>Details</span>
        <span class="text-(--ds-gray-900) group-hover:text-(--ds-gray-1000) transition-colors">
          <Icon name={open.value ? 'chevUp' : 'chevDown'} size={12} />
        </span>
      </button>
      <div
        class="grid transition-[grid-template-rows] duration-300 ease-ml-spring"
        style={{ gridTemplateRows: open.value ? '1fr' : '0fr' }}
      >
        <div class="overflow-hidden min-h-0">
          <dl class="mt-2.5 grid grid-cols-[58px_1fr] gap-x-3 gap-y-1.5 items-baseline text-meta">
            <dt class={metaLabel}>Viewport</dt>
            <dd class="text-(--ds-gray-1000) font-mono tabular-nums">
              {state.viewport.width}×{state.viewport.height}
              {state.viewport.dpr !== 1 && <span class="text-(--ds-gray-900)"> @ {state.viewport.dpr}x</span>}
            </dd>

            {component && (
              <>
                <dt
                  class={cn(metaLabel, 'inline-flex items-center gap-1')}
                  style={{ color: frameworkColor(component.framework) }}
                >
                  <BrandIcon name={FRAMEWORK_BRAND[component.framework]} size={11} />
                  {component.framework}
                </dt>
                <dd class="text-(--ds-gray-1000) font-mono wrap-break-word">{component.chain.join(' ← ')}</dd>
              </>
            )}

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

            {state.classes && (
              <>
                <dt class={metaLabel}>Classes</dt>
                <dd class="text-(--ds-gray-1000) font-mono leading-body wrap-break-word line-clamp-3">
                  {state.classes}
                </dd>
              </>
            )}
          </dl>

          {Object.keys(styles).length > 0 && (
            <div
              class="mt-3 px-2.5 py-2 rounded-lg bg-(--ml-syntax-bg)
                     grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-meta font-mono leading-normal"
            >
              {Object.entries(styles).map(([k, v]) => (
                <div key={k} class="contents">
                  <span class="text-(--ml-syntax-property) font-semibold">{k}</span>
                  <span class="text-(--ml-syntax-value) truncate">{v}</span>
                </div>
              ))}
            </div>
          )}
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
          track('inspector_stack_toggled', { open: !open });
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
                  onClick={() => {
                    removeFromInspectorStack(it.id);
                    track('inspector_stack_item_removed', { stack: items.length - 1 });
                  }}
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
          onClick={() => {
            clearInspectorStack();
            track('inspector_stack_cleared', { stack: items.length });
          }}
          class="px-2.5 py-1.5 text-meta font-medium rounded-lg cursor-pointer
                 bg-transparent text-(--ds-gray-900) border border-transparent
                 transition-[background-color,color] duration-150
                 hover:bg-(--ds-gray-alpha-100) hover:text-(--ds-gray-1000)"
        >
          Clear
        </button>
        <button
          type="button"
          onClick={() => {
            copyInspectorStack();
            track('inspector_stack_copied', { stack: items.length });
          }}
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
  const climbed = useRef<Element[]>([]);

  const clearHover = () => {
    hover.value = null;
    lastEl.current = null;
    clearTimeout(selectorTimer.current);
  };

  const pick = (el: Element) => {
    clearHover();
    selectedElRef.current = el;
    track('inspector_element_picked');
    selected.value = snapshotElement(el, getSelector(el), el.getBoundingClientRect(), outputDetail.value);
  };

  const showHover = (el: Element) => {
    lastEl.current = el;
    const rect = el.getBoundingClientRect();
    hover.value = { el, rect, selector: null, component: null };

    clearTimeout(selectorTimer.current);
    selectorTimer.current = window.setTimeout(() => {
      if (lastEl.current !== el) return;
      hover.value = { el, rect, selector: getSelector(el), component: detectFrameworkComponent(el) };
    }, 80);
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
      climbed.current = [];
      showHover(el);
    };

    const onClick = (e: MouseEvent) => {
      if (activeTool.value !== 'inspect') return;
      const el = e.target instanceof Element ? e.target : null;
      if (!el || isExtensionElement(el)) return;

      e.preventDefault();
      e.stopPropagation();
      // The second press of a double-click belongs to in-place text editing, not a re-pick.
      if (e.detail >= 2) return;
      pick(el);
    };

    // Bubble phase, after SelectionLayer's capture listener has started the edit: the panel
    // click 1 opened must not sit under the edit's own popover.
    const onDblClick = () => {
      if (!isTextEditing()) return;
      selected.value = null;
      selectedElRef.current = null;
    };

    const walk = (e: KeyboardEvent, dir: 'up' | 'down') => {
      const cur = hover.peek();
      if (activeTool.value !== 'inspect' || selected.peek() || !cur) return;
      e.preventDefault();
      e.stopPropagation();
      const next = stepHover({ el: cur.el, stack: climbed.current, dir });
      if (!next) return;
      climbed.current = next.stack;
      track('inspector_hover_walked', { dir });
      showHover(next.el);
    };
    const unbindKeys = tinykeys(window, {
      ArrowUp: (e) => walk(e, 'up'),
      ArrowDown: (e) => walk(e, 'down'),
    });

    window.addEventListener('mousemove', onMove, true);
    window.addEventListener('click', onClick, true);
    window.addEventListener('dblclick', onDblClick);
    return () => {
      unbindKeys();
      window.removeEventListener('dblclick', onDblClick);
      window.removeEventListener('mousemove', onMove, true);
      window.removeEventListener('click', onClick, true);
    };
  }, []);

  const measure = () => {
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
  };

  useSignalEffect(() => {
    if (!hasSelected.value) return;
    let raf = 0;
    const sync = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
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
            el={selectedElRef.current}
            onClose={() => {
              selected.value = null;
            }}
            onStyleChange={measure}
          />
        </>
      )}
      <InspectorStackPanel />
    </>
  );
}
