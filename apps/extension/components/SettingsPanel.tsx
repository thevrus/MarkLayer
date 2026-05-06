import { cn } from '@marklayer/types';
import { type ComponentChildren, createContext } from 'preact';
import { useContext, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { animationsFrozen, toggleAnimationsFrozen } from '../lib/freeze';
import { glass } from '../lib/glass';
import { Icon } from '../lib/icons';
import { getShareUrl } from '../lib/share';
import {
  blockInteractions,
  clearOnCopyEnabled,
  color,
  cycleTheme,
  isOutputDetail,
  lineWidth,
  markersVisible,
  outputDetail,
  PALETTE,
  setColor,
  setOutputDetail,
  showSettings,
  showShareDialog,
  theme,
  toast,
  toggleBlockInteractions,
  toggleClearOnCopy,
  toggleMarkersVisible,
  toggleToolbarMinimized,
  toolbarMinimized,
} from '../lib/state';

const PANEL_WIDTH = 296;
const PANEL_GAP = 12;
const VIEWPORT_PAD = 8;

const sectionLabel = 'text-[10.5px] text-ml-glass-fg/55 font-bold uppercase tracking-[0.08em]';

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
    <div class="flex items-center justify-between gap-3 py-2" onMouseEnter={focusOn} onFocusIn={focusOn}>
      <span class="text-[13px] text-ml-glass-fg/75 font-medium">{label}</span>
      <span class="shrink-0 inline-flex items-center">{children}</span>
    </div>
  );
}

function Section({ children, title }: { children: ComponentChildren; title?: string }) {
  return (
    <>
      <div class={cn(glass.divider, 'mx-4')} />
      <div class={title ? 'px-4 pt-2.5 pb-3' : 'px-4 py-1.5'}>
        {title && <div class={cn(sectionLabel, 'mb-2')}>{title}</div>}
        {children}
      </div>
    </>
  );
}

function Toggle({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onClick}
      class={cn(
        'relative inline-flex items-center w-9 h-5 rounded-full cursor-pointer appearance-none border-none p-0',
        'transition-[background-color] duration-150',
        on ? 'bg-(--ml-state-blue)' : 'bg-ml-glass-fg/15',
      )}
    >
      <span
        class={cn(
          'absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-[0_1px_2px_oklch(0_0_0/0.2)]',
          'transition-[left] duration-200 ease-out',
        )}
        style={{ left: on ? 18 : 2 }}
      />
    </button>
  );
}

function ThemeToggleButton() {
  const t = theme.value;
  const label = t === 'system' ? 'Theme: system' : t === 'dark' ? 'Theme: dark' : 'Theme: light';
  return (
    <button
      type="button"
      onClick={cycleTheme}
      aria-label={label}
      title={label}
      class={cn(
        'appearance-none border-none bg-transparent text-ml-glass-fg/65 cursor-pointer',
        'inline-flex items-center justify-center w-7 h-7 rounded-full',
        'hover:text-ml-glass-fg hover:bg-ml-glass-fg/10 transition-[color,background-color] duration-150',
      )}
    >
      <Icon name={t === 'dark' ? 'moon' : 'sun'} size={14} />
    </button>
  );
}

const LINE_WIDTHS = [1, 2, 3, 5, 8, 12, 20];

const pillSelect = cn(
  'h-7 pl-2.5 pr-1.5 rounded-full appearance-none cursor-pointer outline-none',
  'bg-ml-glass-fg/8 border border-ml-glass-fg/10',
  'text-[11px] font-semibold tabular-nums leading-none text-ml-glass-fg/75',
  'transition-[background-color,color] duration-150',
  'hover:text-ml-glass-fg hover:bg-ml-glass-fg/12',
  'focus-visible:ring-2 focus-visible:ring-ml-glass-fg/40',
);

function StrokeWidthSelect() {
  return (
    <select
      aria-label="Stroke width"
      value={lineWidth.value}
      onChange={(e) => (lineWidth.value = +e.currentTarget.value)}
      class={pillSelect}
    >
      {LINE_WIDTHS.map((v) => (
        <option key={v} value={v}>
          {v}px
        </option>
      ))}
    </select>
  );
}

function OutputDetailSelect() {
  return (
    <select
      aria-label="Output detail"
      value={outputDetail.value}
      onChange={(e) => {
        const v = e.currentTarget.value;
        if (isOutputDetail(v)) setOutputDetail(v);
      }}
      class={pillSelect}
    >
      <option value="compact">Compact</option>
      <option value="standard">Standard</option>
      <option value="detailed">Detailed</option>
      <option value="forensic">Verbose</option>
    </select>
  );
}

function ColorChip({ value }: { value: string }) {
  const selected = color.value === value;
  return (
    <button
      type="button"
      aria-label={`Color ${value}`}
      aria-pressed={selected}
      onClick={() => setColor(value)}
      class={cn(
        'relative w-7 h-7 rounded-full cursor-pointer appearance-none border-none p-0',
        'transition-transform duration-150 hover:scale-110',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ml-glass-fg/40',
      )}
      style={{
        background: value,
        boxShadow: selected
          ? `0 0 0 2px var(--ml-glass-bg), 0 0 0 4px ${value}`
          : '0 0 0 1px color-mix(in oklch, var(--ml-glass-fg) 18%, transparent)',
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
      class={cn(
        'flex items-center justify-between w-full px-4 py-3 cursor-pointer no-underline',
        'text-[13px] text-ml-glass-fg/70 font-medium',
        'hover:bg-ml-glass-fg/5 transition-colors duration-150',
      )}
    >
      <span class="inline-flex items-center gap-2">
        <Icon name={icon} size={14} />
        {label}
      </span>
      <span class="text-ml-glass-fg/45">
        <Icon name="chevRight" size={14} />
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
      class={cn(
        'flex items-center gap-2 w-full px-4 py-3 cursor-pointer',
        'appearance-none bg-transparent border-none text-left',
        'text-[13px] text-ml-glass-fg/70 font-medium',
        'hover:bg-ml-glass-fg/5 transition-colors duration-150',
      )}
    >
      <Icon name="share" size={14} />
      Share
    </button>
  );
}

function RoomIdRow() {
  const setHint = useHintSetter();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hint = "Click to copy this room's ID. Paste it to point an agent at the same canvas.";
  const roomId = getShareUrl().split('/s/')[1] ?? '';

  const onCopy = () => {
    navigator.clipboard.writeText(roomId).then(
      () => {
        setCopied(true);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), 1400);
      },
      () => toast('Failed to copy', 'error'),
    );
  };

  return (
    <button
      type="button"
      onMouseEnter={() => setHint(hint)}
      onFocus={() => setHint(hint)}
      onClick={onCopy}
      class={cn(
        'flex items-center justify-between gap-3 w-full px-4 py-3 cursor-pointer',
        'appearance-none bg-transparent border-none text-left',
        'text-[13px] text-ml-glass-fg/70 font-medium',
        'hover:bg-ml-glass-fg/5 transition-colors duration-150',
      )}
    >
      <span class="inline-flex items-center gap-2">
        <Icon name="link" size={14} />
        Room ID
      </span>
      <span class="inline-flex items-center gap-1.5 min-w-0 text-ml-glass-fg/55">
        <code class="text-[11px] font-mono tabular-nums truncate max-w-35">{roomId}</code>
        <Icon name={copied ? 'check' : 'copy'} size={12} />
      </span>
    </button>
  );
}

function PanelHeader() {
  return (
    <div class="flex items-center justify-between px-4 pt-3 pb-2">
      <span class="text-[13px] font-semibold tracking-[-0.005em] text-ml-glass-fg/65">MarkLayer</span>
      <span class="inline-flex items-center gap-1 text-[11px] text-ml-glass-fg/45 font-medium tabular-nums">
        <span>v0.3</span>
        <ThemeToggleButton />
      </span>
    </div>
  );
}

function PanelFootnote({ text }: { text: string }) {
  // Fixed height — the panel is bottom-anchored, so any growth here pushes the
  // top edge upward and looks like the panel is jumping. Reserve enough room
  // for the longest hint (≈4 wrapped lines at 11px on a 264px content width).
  return <div class="px-4 pt-2 pb-3 text-[11px] leading-snug text-ml-glass-fg/45 h-22 overflow-hidden">{text}</div>;
}

export function SettingsPanel() {
  const open = showSettings.value;
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; bottom: number } | null>(null);
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
      setPos({ left, bottom });
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
          'animate-[mlPanelIn_240ms_cubic-bezier(0.34,1.2,0.64,1)]',
          glass.surface,
          glass.font,
        )}
        style={{
          width: PANEL_WIDTH,
          left: pos ? pos.left : undefined,
          bottom: pos ? pos.bottom : 88,
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
              hint="How much context to bundle into the markdown copied for AI agents. Compact (selector+size) → Standard (+markup) → Detailed (+layout & hierarchy) → Forensic (+computed styles)."
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

          <div class={cn(glass.divider, 'mx-4')} />
          <ShareRow />
          <RoomIdRow />
          <ChevronLinkRow
            icon="terminal"
            label="MCP & webhooks"
            href="https://www.npmjs.com/package/marklayer-mcp"
            hint="Connect Claude Code, Cursor, and other agents to this room. Opens setup docs."
          />

          <PanelFootnote text={hint ?? DEFAULT_HINT} />
        </HintContext>
      </div>
    </>
  );
}
