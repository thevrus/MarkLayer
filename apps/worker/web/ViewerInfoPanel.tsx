import { PanelSection } from '@ext/components/PanelSection';
import { geist } from '@ext/lib/geist';
import { claudeMcpCommand, HOW_IT_WORKS_URL, npxMcpCommand } from '@ext/lib/share';
import { copyText, operations, peerCount, showAnnotationPanel } from '@ext/lib/state';
import { useCopyToClipboard } from '@ext/lib/useCopy';
import { cn, type DrawOp, RETENTION_DAYS } from '@marklayer/types';
import {
  ArrowUpRight,
  BookOpen,
  Bot,
  Calendar,
  Check,
  Copy,
  Hash,
  type Info,
  Link,
  Lock,
  PenTool,
  Timer,
  Upload,
  Users,
  X,
} from 'lucide-preact';
import type { ComponentChildren } from 'preact';
import { DOCK_GUTTER, DOCKED_ANNOTATION_WIDTH, DockedPanel, PANEL_SIDEBAR, PANEL_TRANSITION } from './AnnotationPanel';
import { annotationId, isReadonly, pageUrl, showInfoPanel, timeAgo } from './signals';
import { connected, createdAt, expiresAt } from './useRealtimeSync';
import { PresenceDot } from './ViewerChrome';

export const INFO_PANEL_WIDTH = 300;

/**
 * Plural tally nouns, distinct from the Toolbar's singular tool names. Keyed
 * exhaustively over the op union (plus `arrow`, which is a `line` that carries
 * one) so a tool added later is a type error here rather than a row that shows
 * the raw identifier to the reader. `eraser` never reaches the tally.
 */
type TallyTool = Exclude<DrawOp['tool'], 'eraser'> | 'arrow';

const TOOL_LABELS: Record<TallyTool, string> = {
  pen: 'Pen strokes',
  highlight: 'Highlights',
  rectangle: 'Rectangles',
  circle: 'Circles',
  line: 'Lines',
  arrow: 'Arrows',
  text: 'Text labels',
  comment: 'Comments',
  selection: 'Selections',
  area: 'Areas',
  inspect: 'Inspected elements',
  guide: 'Guides',
};

/**
 * One labelled row of the panel. `children` carries the value when it is a
 * control rather than a string — every row shares this scaffold, so the layout
 * cannot drift between the plain rows and the interactive ones.
 */
function InfoRow({
  icon: Icon,
  label,
  value,
  children,
}: {
  icon: typeof Info;
  label: string;
  value?: string;
  children?: ComponentChildren;
}) {
  return (
    <div class="flex items-start gap-3 py-2">
      <Icon size={14} strokeWidth={1.5} class="text-(--ds-gray-900) shrink-0 mt-0.5" aria-hidden="true" />
      <div class="flex-1 min-w-0">
        <div class="text-meta text-(--ds-gray-900)">{label}</div>
        {children ?? <div class="text-ui text-(--ds-gray-1000) mt-0.5 break-all">{value}</div>}
      </div>
    </div>
  );
}

/**
 * Click-to-copy command line. Mirrors the ID row's interaction (the whole value
 * is the control, copy glyph trailing) so the panel teaches one copy gesture
 * rather than two. The command wraps instead of truncating — a half-shown
 * command reads as broken and can't be verified before it's pasted.
 */
function CommandField({ label, value }: { label: string; value: string }) {
  const { copied, copy } = useCopyToClipboard();
  return (
    <button
      type="button"
      onClick={() => copy(value)}
      title="Click to copy"
      aria-label={`Copy ${label}`}
      class="group w-full flex items-start gap-1.5 text-left px-2 py-1.5 rounded-lg cursor-pointer
             bg-(--ds-gray-alpha-100) border border-(--ds-gray-alpha-400) text-(--ds-gray-1000)
             hover:border-(--ds-gray-700) transition-colors duration-150 outline-none
             focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-1
             focus-visible:outline-(--ds-focus-color)"
    >
      {/* Wrap at spaces, never mid-token: `break-all` split "npx" across lines,
          which makes the command unreadable and unverifiable before pasting. */}
      <code class="flex-1 min-w-0 font-mono text-meta leading-normal whitespace-pre-wrap wrap-break-word">{value}</code>
      {/* mt centers the 11px glyph on the 16.5px first line box, not on the block */}
      {/* Opacity here multiplies the parent's muted colour, so it has to stay
          high: at 0.4 over a /60 parent the copy affordance landed near 1.8:1. */}
      {copied.value ? (
        <Check size={12} strokeWidth={1.5} class="shrink-0 mt-0.5 text-(--ds-gray-1000)" aria-hidden="true" />
      ) : (
        <Copy
          size={12}
          strokeWidth={1.5}
          class="shrink-0 mt-0.5 text-(--ds-gray-900) transition-colors duration-150 group-hover:text-(--ds-gray-1000)"
          aria-hidden="true"
        />
      )}
    </button>
  );
}

function InfoPanelHeader() {
  return (
    <div class="px-4 py-3 border-b border-(--ds-gray-alpha-400) shrink-0 flex items-center justify-between">
      <h2 class="text-body font-semibold tracking-ui text-(--ds-gray-1000) m-0">Annotation info</h2>
      <button
        type="button"
        onClick={() => (showInfoPanel.value = false)}
        title="Close panel"
        aria-label="Close panel"
        class={cn(geist.ctl, geist.ctlIdle)}
      >
        <X size={16} strokeWidth={1.5} aria-hidden="true" />
      </button>
    </div>
  );
}

function SessionRow() {
  const isConnected = connected.value;
  return (
    <InfoRow icon={Users} label="Session">
      <div class="flex items-center gap-2 mt-0.5">
        <PresenceDot live={isConnected} />
        <span class="text-ui text-(--ds-gray-1000)">
          {isConnected ? `Connected · ${peerCount.value} online` : 'Offline'}
        </span>
      </div>
    </InfoRow>
  );
}

function PageUrlRow({ url }: { url: string }) {
  return (
    <InfoRow icon={Link} label="Page URL">
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        class="text-ui text-(--ds-gray-1000) mt-0.5 break-all no-underline hover:underline block transition-colors"
      >
        {url}
      </a>
    </InfoRow>
  );
}

function RoomIdRow({ id }: { id: string }) {
  return (
    <InfoRow icon={Hash} label="ID">
      <button
        type="button"
        class="group flex items-center gap-1.5 text-ui text-(--ds-gray-1000) mt-0.5 bg-transparent border-none cursor-pointer p-0 font-mono
                 rounded-sm outline-none focus-visible:outline-solid focus-visible:outline-2
                 focus-visible:outline-offset-2 focus-visible:outline-(--ds-focus-color)"
        onClick={() => copyText(id, 'ID copied')}
        title="Click to copy"
        aria-label="Copy annotation ID"
      >
        {id}
        <Copy
          size={12}
          strokeWidth={1.5}
          class="shrink-0 text-(--ds-gray-900) transition-colors duration-150 group-hover:text-(--ds-gray-1000)"
          aria-hidden="true"
        />
      </button>
    </InfoRow>
  );
}

/**
 * Connect an agent — the room ID above is what the MCP server joins, so the
 * command belongs directly under it. Shown wherever a room exists; read-only is
 * a viewer-side flag and does not stop an agent writing.
 */
function AgentSection({ id }: { id: string }) {
  return (
    <>
      <div class={cn(geist.divider, 'my-2 -mx-4')} />
      <PanelSection icon={Bot} label="Connect an AI agent">
        <div class="flex flex-col gap-1.5">
          <p class="text-meta text-(--ds-gray-900) leading-snug m-0">
            An agent can work these annotations and resolve them here, live. Run once in your project:
          </p>
          <CommandField label="Claude Code command" value={claudeMcpCommand(id)} />
          <PanelSection label="Cursor, Codex, Windsurf…">
            <div class="flex flex-col gap-1.5">
              <CommandField label="npx command" value={npxMcpCommand(id)} />
              <p class="text-meta text-(--ds-gray-900) leading-snug m-0">
                Paste into your MCP config under a "marklayer" entry.
              </p>
            </div>
          </PanelSection>
        </div>
      </PanelSection>
    </>
  );
}

function ToolTally() {
  const ops = operations.value;
  if (ops.length === 0) return null;
  const toolCounts = new Map<TallyTool, number>();
  for (const op of ops) {
    if (op.tool === 'eraser') continue;
    const t: TallyTool = op.tool === 'line' && op.arrow ? 'arrow' : op.tool;
    toolCounts.set(t, (toolCounts.get(t) || 0) + 1);
  }
  return (
    <>
      <div class={cn(geist.divider, 'my-2 -mx-4')} />
      <PanelSection icon={PenTool} label="Annotations" count={ops.length}>
        <div class="grid grid-cols-2 gap-x-4 gap-y-1">
          {Array.from(toolCounts.entries())
            .sort((a, b) => b[1] - a[1])
            .map(([tool, count]) => (
              <div key={tool} class="flex items-center justify-between">
                <span class="text-meta text-(--ds-gray-900)">{TOOL_LABELS[tool]}</span>
                <span class="text-meta text-(--ds-gray-900) tabular-nums">{count}</span>
              </div>
            ))}
        </div>
      </PanelSection>
    </>
  );
}

const formatStamp = (seconds: number) =>
  `${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(seconds * 1000)} (${timeAgo(seconds)})`;

function InfoPanelBody() {
  const created = createdAt.value;
  const expires = expiresAt.value;
  const readonly = isReadonly.value;
  const url = pageUrl.value;
  const id = annotationId.value;

  return (
    <>
      <InfoPanelHeader />
      {/* pb clears the floating toolbar that overlaps the panel's bottom-right,
          so the last rows can always be scrolled out from under it. */}
      <div class="flex-1 overflow-y-auto px-4 pt-2 pb-16">
        {created != null && <InfoRow icon={Calendar} label="Created" value={formatStamp(created)} />}
        <InfoRow
          icon={Timer}
          label="Expires"
          value={
            expires == null
              ? `${RETENTION_DAYS} days after last view`
              : expires * 1000 < Date.now()
                ? 'Expired'
                : formatStamp(expires)
          }
        />
        <SessionRow />
        <InfoRow icon={readonly ? Lock : Upload} label="Access" value={readonly ? 'Read-only' : 'Editable'} />
        {url && <PageUrlRow url={url} />}
        {id && <RoomIdRow id={id} />}
        {id && <AgentSection id={id} />}
        <ToolTally />
        <div class={cn(geist.divider, 'my-2 -mx-4')} />
        <a
          href={HOW_IT_WORKS_URL}
          target="_blank"
          rel="noopener"
          class={cn(
            geist.sectionLabel,
            'flex items-center gap-3 h-9 -mx-4 px-4 no-underline outline-none',
            'text-(--ds-gray-900) hover:text-(--ds-gray-1000) hover:bg-(--ds-gray-alpha-100)',
            'transition-[background-color,color] duration-150 ease-out',
            'focus-visible:outline-solid focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--ds-focus-color)',
          )}
        >
          <BookOpen size={14} strokeWidth={1.5} class="shrink-0" aria-hidden="true" />
          <span class="flex-1">How MarkLayer works</span>
          <ArrowUpRight size={14} strokeWidth={1.5} class="shrink-0" aria-hidden="true" />
        </a>
      </div>
    </>
  );
}

/** Flush against the desktop frame, which is wide enough to take an overlay. */
export function InfoPanel() {
  return (
    <div
      class={cn(
        PANEL_SIDEBAR,
        'left-0 border-r border-(--ds-gray-alpha-400)',
        PANEL_TRANSITION,
        showInfoPanel.value ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-4 pointer-events-none',
      )}
      style={{ width: INFO_PANEL_WIDTH }}
    >
      <InfoPanelBody />
    </div>
  );
}

// In a device viewport the frame is only 390–768px wide, so an overlaid panel
// would bury the page being reviewed. Dock it beside the frame instead, the way
// DockedAnnotationPanel does on the other side.
export function DockedInfoPanel() {
  return (
    <DockedPanel visible={showInfoPanel.value} width={INFO_PANEL_WIDTH}>
      <InfoPanelBody />
    </DockedPanel>
  );
}

/** Horizontal space the open docked panels take from a device frame. */
export function dockedPanelsWidth(): number {
  return (
    (showInfoPanel.value ? INFO_PANEL_WIDTH + DOCK_GUTTER : 0) +
    (showAnnotationPanel.value ? DOCKED_ANNOTATION_WIDTH + DOCK_GUTTER : 0)
  );
}
