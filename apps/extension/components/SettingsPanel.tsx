import { Switch } from '@base-ui/react/switch';
import { cn } from '@marklayer/types';
import { type ComponentChildren, createContext } from 'preact';
import { useContext, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { animationsFrozen, toggleAnimationsFrozen } from '../lib/freeze';
import { geist } from '../lib/geist';
import { glass } from '../lib/glass';
import { Icon } from '../lib/icons';
import { getRoomId } from '../lib/share';
import {
  blockInteractions,
  clearOnCopyEnabled,
  color,
  colorName,
  isOutputDetail,
  lineWidth,
  markersVisible,
  onSupport,
  outputDetail,
  PALETTE,
  setColor,
  setOutputDetail,
  showSettings,
  showShareDialog,
  toggleBlockInteractions,
  toggleClearOnCopy,
  toggleMarkersVisible,
  toggleToolbarMinimized,
  toolbarMinimized,
} from '../lib/state';
import { useCopyToClipboard } from '../lib/useCopy';

const PANEL_WIDTH = 296;
const PANEL_GAP = 12;
const VIEWPORT_PAD = 8;

const sectionLabel = cn(geist.meta, 'font-medium');

/**
 * Hint surfaced at the bottom of the panel for whichever row is hovered or focused.
 * Borrowed from Agentation's pattern — keeps each row visually clean while
 * still describing what it does. Falls back to a default tagline when idle.
 */
const DEFAULT_HINT = 'Hover any setting for details.';

/**
 * Context lifts the hint state out of the leaf rows. Without this every
 * interactive row (Row, ChevronLinkRow, ExportPngButton, etc.) would need an
 * `onHint` prop drilled through it. With it, only the panel root holds the
 * state and any descendant can subscribe via `useHintSetter()`.
 */
const HintContext = createContext<(h: string | null) => void>(() => {});
const useHintSetter = () => useContext(HintContext);

function Row({ label, hint, children }: { label: string; hint?: string; children: ComponentChildren }) {
  // Only set on enter — never clear here. The panel root's `onMouseLeave`
  // resets to the default hint, so moving between rows just swaps the text
  // without a transient empty state (which would flicker the footnote).
  const setHint = useHintSetter();
  const focusOn = () => hint && setHint(hint);
  return (
    <div class="flex items-center justify-between gap-3 h-9" onMouseEnter={focusOn} onFocusIn={focusOn}>
      <span class="text-ui text-(--ds-gray-1000)">{label}</span>
      <span class="shrink-0 inline-flex items-center">{children}</span>
    </div>
  );
}

function Section({ children, title }: { children: ComponentChildren; title?: string }) {
  return (
    <>
      <div class={geist.divider} />
      <div class={title ? 'px-4 pt-3 pb-3.5' : 'px-4 py-1.5'}>
        {title && <div class={cn(sectionLabel, 'mb-2.5')}>{title}</div>}
        {children}
      </div>
    </>
  );
}

function Toggle({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <Switch.Root
      checked={on}
      onCheckedChange={(_checked: boolean) => onClick()}
      aria-label={label}
      className={cn(
        'relative inline-flex items-center w-8 h-5 rounded-full cursor-pointer appearance-none border-none p-0',
        'transition-[background-color] duration-150 outline-none',
        'focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2',
        'focus-visible:outline-(--ds-focus-color)',
        'data-checked:bg-(--ds-gray-1000) data-unchecked:bg-(--ds-gray-alpha-500)',
      )}
    >
      <Switch.Thumb
        className={cn(
          'absolute top-0.5 w-4 h-4 rounded-full bg-(--ds-background-100)',
          '[box-shadow:var(--ds-shadow-border-small)]',
          'transition-[left] duration-150 ease-out',
          'data-checked:left-3.5 data-unchecked:left-0.5',
        )}
      />
    </Switch.Root>
  );
}

const LINE_WIDTHS = [1, 2, 3, 5, 8, 12, 20];

const fieldSelect = cn(
  geist.field,
  'w-full h-8 pl-2.5 pr-7 appearance-none cursor-pointer outline-none',
  'text-ui tabular-nums text-(--ds-gray-1000)',
  'hover:border-(--ds-gray-700)',
  'focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-1',
  'focus-visible:outline-(--ds-focus-color)',
);

/**
 * The chevron a native `<select>` loses to `appearance-none`. `pointer-events-none`
 * so the whole field, arrow included, still opens the native list.
 */
function SelectShell({ children }: { children: ComponentChildren }) {
  return (
    <span class="relative inline-flex items-center">
      {children}
      <span class="absolute right-2 inline-flex text-(--ds-gray-900) pointer-events-none">
        <Icon name="chevDown" size={14} strokeWidth={1.5} />
      </span>
    </span>
  );
}

function StrokeWidthSelect() {
  return (
    <SelectShell>
      <select
        aria-label="Stroke width"
        value={lineWidth.value}
        onChange={(e) => (lineWidth.value = +e.currentTarget.value)}
        class={fieldSelect}
      >
        {LINE_WIDTHS.map((v) => (
          <option key={v} value={v}>
            {v}px
          </option>
        ))}
      </select>
    </SelectShell>
  );
}

function OutputDetailSelect() {
  return (
    <SelectShell>
      <select
        aria-label="Output detail"
        value={outputDetail.value}
        onChange={(e) => {
          const v = e.currentTarget.value;
          if (isOutputDetail(v)) setOutputDetail(v);
        }}
        class={fieldSelect}
      >
        <option value="compact">Compact</option>
        <option value="standard">Standard</option>
        <option value="detailed">Detailed</option>
        <option value="forensic">Verbose</option>
      </select>
    </SelectShell>
  );
}

function ColorChip({ value }: { value: string }) {
  const selected = color.value === value;
  return (
    <button
      type="button"
      aria-label={`Color ${colorName(value)}`}
      aria-pressed={selected}
      onClick={() => setColor(value)}
      class={cn(
        'relative w-6 h-6 rounded-full cursor-pointer appearance-none border-none p-0 outline-none',
        'transition-[box-shadow] duration-150',
        'focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2',
        'focus-visible:outline-(--ds-focus-color)',
      )}
      style={{
        background: value,
        boxShadow: selected
          ? `0 0 0 2px var(--ds-background-100), 0 0 0 4px ${value}`
          : '0 0 0 1px color-mix(in oklab, #000 12%, transparent)',
      }}
    />
  );
}

function ChevronLinkRow({ icon, label, href, hint }: { icon: string; label: string; href: string; hint: string }) {
  const setHint = useHintSetter();
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onMouseEnter={() => setHint(hint)}
      onFocus={() => setHint(hint)}
      class={cn(geist.row, geist.rowHover)}
    >
      <span class="inline-flex items-center gap-2.5">
        <span class="text-(--ds-gray-900)">
          <Icon name={icon} size={14} strokeWidth={1.5} />
        </span>
        {label}
      </span>
      <span class="text-(--ds-gray-900)">
        <Icon name="chevRight" size={14} strokeWidth={1.5} />
      </span>
    </a>
  );
}

function ShareRow() {
  const setHint = useHintSetter();
  return (
    <button
      type="button"
      onMouseEnter={() => setHint('Get a public link and the command to connect an AI agent.')}
      onFocus={() => setHint('Get a public link and the command to connect an AI agent.')}
      onClick={() => {
        showShareDialog.value = true;
        showSettings.value = false;
      }}
      class={cn(geist.row, geist.rowHover, 'justify-start gap-2.5')}
    >
      <span class="text-(--ds-gray-900)">
        <Icon name="share" size={14} strokeWidth={1.5} />
      </span>
      Share
    </button>
  );
}

/**
 * Only rendered where a card exists to open — see `onSupport`. Sits with Share
 * and Room ID as one more thing you can do, not as a plea: same row, same
 * weight, no fill and no colour of its own.
 */
function SupportRow({ open }: { open: () => void }) {
  const setHint = useHintSetter();
  const hint = 'MarkLayer is free and has no accounts. See what it costs to run, and chip in if you want to.';
  return (
    <button
      type="button"
      onMouseEnter={() => setHint(hint)}
      onFocus={() => setHint(hint)}
      onClick={() => {
        open();
        showSettings.value = false;
      }}
      class={cn(geist.row, geist.rowHover, 'justify-start gap-2.5')}
    >
      <span class="text-(--ds-gray-900)">
        <Icon name="heart" size={14} strokeWidth={1.5} />
      </span>
      Support MarkLayer
    </button>
  );
}

function RoomIdRow() {
  const setHint = useHintSetter();
  const { copied, copy } = useCopyToClipboard();
  const hint = "Click to copy this room's ID. Paste it to point an agent at the same canvas.";
  const roomId = getRoomId();

  return (
    <button
      type="button"
      onMouseEnter={() => setHint(hint)}
      onFocus={() => setHint(hint)}
      onClick={() => copy(roomId)}
      class={cn(geist.row, geist.rowHover)}
    >
      <span class="inline-flex items-center gap-2.5">
        <span class="text-(--ds-gray-900)">
          <Icon name="link" size={14} strokeWidth={1.5} />
        </span>
        Room ID
      </span>
      <span class={cn(geist.meta, 'inline-flex items-center gap-1.5 min-w-0')}>
        <code class="text-meta font-mono truncate max-w-35">{roomId}</code>
        <Icon name={copied.value ? 'check' : 'copy'} size={13} strokeWidth={1.5} />
      </span>
    </button>
  );
}

function PanelHeader() {
  return (
    <div class="flex items-center justify-between px-4 h-11">
      <span class="text-ui font-semibold tracking-ui text-(--ds-gray-1000)">MarkLayer</span>
      <span class={cn(geist.meta, 'text-meta tabular-nums')}>v0.3</span>
    </div>
  );
}

function PanelFootnote({ text }: { text: string }) {
  // Fixed height — the panel is bottom-anchored, so any growth here pushes the
  // top edge upward and looks like the panel is jumping. It holds 4 wrapped lines
  // at this size on a 264px content width, so every hint has to fit in ~120
  // characters; a longer one gets its tail clipped rather than wrapping.
  return <div class="px-4 pt-2.5 pb-3.5 text-meta leading-snug text-(--ds-gray-900) h-22 overflow-hidden">{text}</div>;
}

export function SettingsPanel() {
  const open = showSettings.value;
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; bottom: number; maxHeight: number } | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      // The toolbar button lives inside the extension's shadow root, so a plain
      // `document.querySelector` can't see it. Walk up from the panel itself
      // to find whichever root we're in (ShadowRoot or Document) and query there.
      const root =
        (panelRef.current?.getRootNode() as Document | ShadowRoot | null) ??
        (document.querySelector('mark-layer')?.shadowRoot as ShadowRoot | null) ??
        document;
      const btn = root.querySelector?.('[data-ml-anchor="settings"]') as HTMLElement | null;
      if (!btn) {
        setPos(null);
        return;
      }
      const r = btn.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      // Anchor the panel's right edge to the button's right edge, then clamp.
      let left = r.right - PANEL_WIDTH;
      left = Math.max(VIEWPORT_PAD, Math.min(left, vw - PANEL_WIDTH - VIEWPORT_PAD));
      const bottom = Math.max(VIEWPORT_PAD, vh - r.top + PANEL_GAP);
      // The ceiling is the room left above the anchor, not the viewport: the
      // panel hangs off the toolbar, so on a short window an uncapped panel
      // ran straight off the top edge instead of scrolling.
      const maxHeight = Math.max(160, vh - bottom - VIEWPORT_PAD);
      setPos({ left, bottom, maxHeight });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open]);

  if (!open) return null;

  return (
    <>
      <div
        class="fixed inset-0 z-2147483645"
        onClick={() => {
          showSettings.value = false;
        }}
      />
      <div
        ref={panelRef}
        class={cn(
          'fixed z-2147483646 pointer-events-auto select-none',
          'overflow-y-auto overscroll-contain',
          'animate-[mlPanelIn_140ms_cubic-bezier(0.16,1,0.3,1)]',
          geist.surface,
          glass.font,
        )}
        style={{
          width: PANEL_WIDTH,
          left: pos ? pos.left : undefined,
          bottom: pos ? pos.bottom : 88,
          maxHeight: pos?.maxHeight,
          // Hidden until measured to avoid a one-frame flash at the wrong position
          visibility: pos ? 'visible' : 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            showSettings.value = false;
          }
        }}
        onMouseLeave={() => setHint(null)}
      >
        <HintContext value={setHint}>
          <PanelHeader />

          <Section>
            <Row
              label="AI handoff detail"
              hint="How much detail the copied markdown carries. Each level adds to the last: selector, markup, layout, computed styles."
            >
              <OutputDetailSelect />
            </Row>
            <Row label="Stroke width" hint="Line thickness for pen, line, arrow, rectangle, and circle tools.">
              <StrokeWidthSelect />
            </Row>
            <Row label="Compact toolbar" hint="Collapse the toolbar to just the active tool.">
              <Toggle on={toolbarMinimized.value} onClick={toggleToolbarMinimized} label="Compact toolbar" />
            </Row>
            <Row label="Freeze animations" hint="Pause animations and media so you can annotate moving UI.">
              <Toggle on={animationsFrozen.value} onClick={toggleAnimationsFrozen} label="Freeze animations" />
            </Row>
            <Row label="Show markers" hint="Hide placed pins, highlights, and drawings. Persists across reloads.">
              <Toggle on={markersVisible.value} onClick={toggleMarkersVisible} label="Show markers" />
            </Row>
            <Row label="Block page interactions" hint="Block clicks on the page so you don't navigate by accident.">
              <Toggle on={blockInteractions.value} onClick={toggleBlockInteractions} label="Block page interactions" />
            </Row>
            <Row
              label="Clear on copy/send"
              hint="Clear the inspector stack after each copy so the next handoff starts fresh."
            >
              <Toggle on={clearOnCopyEnabled.value} onClick={toggleClearOnCopy} label="Clear on copy/send" />
            </Row>
          </Section>

          <Section title="Marker Color">
            <div class="flex items-center justify-between">
              {PALETTE.map((c) => (
                <ColorChip key={c} value={c} />
              ))}
            </div>
          </Section>

          <div class={geist.divider} />
          <ShareRow />
          <RoomIdRow />
          <ChevronLinkRow
            icon="terminal"
            label="Connect an AI agent"
            href="https://www.npmjs.com/package/marklayer-mcp"
            hint="Connect Claude Code, Cursor, and other agents to this room. Opens setup docs."
          />
          {onSupport.value && <SupportRow open={onSupport.value} />}

          <PanelFootnote text={hint ?? DEFAULT_HINT} />
        </HintContext>
      </div>
    </>
  );
}
