import { PanelSection } from '@ext/components/PanelSection';
import { geist } from '@ext/lib/geist';
import { operations } from '@ext/lib/ops';
import { peerCount } from '@ext/lib/presence';
import { connected, createdAt, expiresAt, isOwned } from '@ext/lib/realtime';
import { HOW_IT_WORKS_URL, npxMcpCommand } from '@ext/lib/share';
import { copyText } from '@ext/lib/toasts';
import { useCopyToClipboard } from '@ext/lib/useCopy';
import { mcpAddCommand as claudeMcpCommand, displayHost, isUploadPath, mcpEndpoint } from '@marklayer/brand/links';
import type { DrawOp } from '@marklayer/types/ops';
import { cn } from '@marklayer/ui/cn';
import { ArrowUpRight, BookOpen, Bot, Check, Columns2, Copy, Heart, X } from 'lucide-preact';
import type { ComponentChildren } from 'preact';
import { deletionDeadline } from '../shared/accounts';
import { capture } from './analytics';
import { compareHref } from './compare/url';
import { DockedPanel, INFO_PANEL_WIDTH, PANEL_SIDEBAR, PANEL_TRANSITION } from './DockedPanel';
import { IntegrationsSection } from './IntegrationsSection';
import { annotationId, pageUrl } from './projects';
import { PresenceDot } from './shared';
import { openSupportCard } from './support-ui';
import { timeAgo } from './timeAgo';
import { infoPanelOpen, showInfoPanel } from './ui-state';
import { isReadonly } from './viewer-state';

/**
 * Tally nouns, singular so a count of one reads right; every one pluralises
 * with a plain `s`. Keyed exhaustively over the op union (plus `arrow`, a `line`
 * that carries one) so a new tool is a type error, not a raw identifier.
 */
type TallyTool = Exclude<DrawOp['tool'], 'eraser' | 'vote'> | 'arrow';

const TOOL_NOUNS: Record<TallyTool, string> = {
  pen: 'pen stroke',
  highlight: 'highlight',
  rectangle: 'rectangle',
  circle: 'circle',
  line: 'line',
  arrow: 'arrow',
  text: 'text label',
  comment: 'comment',
  selection: 'selection',
  area: 'area',
  inspect: 'inspected element',
  guide: 'guide',
  intro: 'intro video',
  question: 'question',
  step: 'next step',
};

/**
 * One label/value pair of the details list. No per-row icon: the label already
 * names the field, and a column of glyphs beside it was a second index to read.
 */
function InfoRow({ label, children }: { label: string; children: ComponentChildren }) {
  return (
    <>
      <dt class="text-ui text-(--ds-gray-900)">{label}</dt>
      <dd class="m-0 min-w-0 text-ui text-(--ds-gray-1000)">{children}</dd>
    </>
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
      onClick={() => {
        copy(value);
        capture('mcp_command_copied', { command: label });
      }}
      title="Click to copy"
      aria-label={`Copy ${label}`}
      class="group w-full flex items-start gap-1.5 text-left px-2 py-1.5 rounded-lg cursor-pointer
             bg-(--ds-gray-alpha-100) border border-(--ds-gray-alpha-400) text-(--ds-gray-1000)
             hover:border-(--ds-gray-700) transition-colors duration-150 outline-none
             focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-1
             focus-visible:outline-(--ds-focus-color)"
    >
      {/* Wrap at spaces, never mid-token: `break-all` split "npx" across lines. */}
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
      <h2 class="text-body font-semibold tracking-ui text-(--ds-gray-1000) m-0">Details</h2>
      <button
        type="button"
        onClick={() => {
          showInfoPanel.value = false;
          capture('panel_toggled', { panel: 'details', open: false });
        }}
        title="Close panel"
        aria-label="Close panel"
        class={cn(geist.ctl, geist.ctlIdle)}
      >
        <X size={16} strokeWidth={1.5} aria-hidden="true" />
      </button>
    </div>
  );
}

function PeopleRow() {
  const live = connected.value;
  const n = peerCount.value;
  return (
    <InfoRow label="People">
      <span class="flex items-center gap-2">
        <PresenceDot live={live} />
        {live ? (n === 1 ? 'Just you' : `${n} here now`) : 'Offline'}
      </span>
    </InfoRow>
  );
}

/** Host and path only: the scheme is noise here, and the full URL is one hover away. */
function displayUrl(url: string): string {
  const host = displayHost(url);
  if (host === null) return url;
  const { pathname, search } = new URL(url);
  return `${host}${pathname === '/' ? '' : pathname}${search}`;
}

function PageRow({ url }: { url: string }) {
  return (
    <InfoRow label="Page">
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        title={url}
        class="line-clamp-2 break-all text-(--ds-gray-1000) no-underline hover:underline"
      >
        {displayUrl(url)}
      </a>
    </InfoRow>
  );
}

function RoomIdRow({ id }: { id: string }) {
  return (
    <InfoRow label="ID">
      <button
        type="button"
        class="group flex max-w-full items-center gap-1.5 text-meta text-(--ds-gray-1000) bg-transparent border-none cursor-pointer p-0 font-mono
                 rounded-sm outline-none focus-visible:outline-solid focus-visible:outline-2
                 focus-visible:outline-offset-2 focus-visible:outline-(--ds-focus-color)"
        onClick={() => copyText(id, 'ID copied')}
        title="Click to copy"
        aria-label="Copy annotation ID"
      >
        <span class="truncate">{id}</span>
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
    <PanelSection icon={Bot} label="Connect an AI agent">
      <div class="flex flex-col gap-1.5">
        <p class="text-meta text-(--ds-gray-900) leading-snug m-0">
          Your agent reads this page and resolves these annotations live. Run once in your project:
        </p>
        <CommandField label="Claude Code command" value={claudeMcpCommand({ roomId: id, origin: location.origin })} />
        <PanelSection label="Cursor, Codex, Windsurf…">
          <div class="flex flex-col gap-1.5">
            <CommandField label="MCP server URL" value={mcpEndpoint({ roomId: id, origin: location.origin })} />
            <p class="text-meta text-(--ds-gray-900) leading-snug m-0">
              Add as an HTTP MCP server named "marklayer". Nothing to install: the link is the server.
            </p>
          </div>
        </PanelSection>
        <PanelSection label="Local server (npx)">
          <div class="flex flex-col gap-1.5">
            <CommandField label="npx command" value={npxMcpCommand({ roomId: id, origin: location.origin })} />
            <p class="text-meta text-(--ds-gray-900) leading-snug m-0">
              For a client that cannot reach a remote MCP server yet.
            </p>
          </div>
        </PanelSection>
      </div>
    </PanelSection>
  );
}

/** The panel's bottom rows: the help link and the ask, one grammar for both. */
const panelLinkRow = cn(
  geist.sectionLabel,
  'flex items-center gap-3 h-9 -mx-4 px-4 no-underline outline-none bg-transparent border-none cursor-pointer',
  'text-(--ds-gray-900) hover:text-(--ds-gray-1000) hover:bg-(--ds-gray-alpha-100)',
  'transition-[background-color,color] duration-150 ease-out',
  'focus-visible:outline-solid focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--ds-focus-color)',
);

/** "3 comments, 2 pen strokes": the whole room in one line, largest first. */
function TallyRow() {
  const ops = operations.value;
  if (ops.length === 0) return null;
  const counts = new Map<TallyTool, number>();
  for (const op of ops) {
    if (op.tool === 'eraser' || op.tool === 'vote') continue;
    const t: TallyTool = op.tool === 'line' && op.arrow ? 'arrow' : op.tool;
    counts.set(t, (counts.get(t) || 0) + 1);
  }
  const summary = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([tool, n]) => `${n} ${TOOL_NOUNS[tool]}${n === 1 ? '' : 's'}`)
    .join(', ');
  return <InfoRow label="Contains">{summary}</InfoRow>;
}

const formatStamp = (seconds: number) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(seconds * 1000);

const formatDate = (seconds: number) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(seconds * 1000);

/** The Expires row: no deadline at all, one already past, or the date it lands on. */
function expiry({ deadline, resetsOnView }: { deadline: number | null; resetsOnView: boolean }): {
  value: string;
  note?: string;
} {
  if (deadline === null) return { value: 'Never', note: 'Saved to an account' };
  if (deadline * 1000 < Date.now()) return { value: 'Expired' };
  return { value: formatDate(deadline), note: resetsOnView ? 'Resets each time it is opened' : undefined };
}

function InfoPanelBody() {
  const created = createdAt.value;
  const expires = expiresAt.value;
  const owned = isOwned.value;
  const readonly = isReadonly.value;
  const url = pageUrl.value;
  const id = annotationId.value;

  // Opening this panel just touched `last_accessed_at`, so `now` stands in for it.
  const deadline = deletionDeadline({ lastAccessedAt: Math.floor(Date.now() / 1000), expiresAt: expires, owned });
  const { value: expiresValue, note: expiresNote } = expiry({ deadline, resetsOnView: expires == null });

  return (
    <>
      <InfoPanelHeader />
      {/* pb clears the floating toolbar that overlaps the panel's bottom-right,
          so the last rows can always be scrolled out from under it. */}
      <div class="flex-1 overflow-y-auto px-4 pb-16">
        <dl class="m-0 grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-3 gap-y-2.5 py-4">
          {url && <PageRow url={url} />}
          {created != null && (
            <InfoRow label="Created">
              <time dateTime={new Date(created * 1000).toISOString()} title={formatStamp(created)}>
                {timeAgo(created * 1000)}
              </time>
            </InfoRow>
          )}
          <InfoRow label="Expires">
            {expiresValue}
            {expiresNote && <span class="block text-meta text-(--ds-gray-900)">{expiresNote}</span>}
          </InfoRow>
          <InfoRow label="Access">{readonly ? 'View only' : 'Can edit'}</InfoRow>
          <PeopleRow />
          <TallyRow />
          {id && <RoomIdRow id={id} />}
        </dl>
        {id && (
          <>
            <div class={cn(geist.divider, 'mb-2 -mx-4')} />
            <AgentSection id={id} />
            {!readonly && <IntegrationsSection id={id} />}
          </>
        )}
        <div class={cn(geist.divider, 'my-2 -mx-4')} />
        {url && !isUploadPath(url) && (
          <a href={compareHref({ a: url })} target="_blank" rel="noopener" class={panelLinkRow}>
            <Columns2 size={14} strokeWidth={1.5} class="shrink-0" aria-hidden="true" />
            <span class="flex-1">Compare with another version</span>
            <ArrowUpRight size={14} strokeWidth={1.5} class="shrink-0" aria-hidden="true" />
          </a>
        )}
        <a href={HOW_IT_WORKS_URL} target="_blank" rel="noopener" class={panelLinkRow}>
          <BookOpen size={14} strokeWidth={1.5} class="shrink-0" aria-hidden="true" />
          <span class="flex-1">How visual collaboration works</span>
          <ArrowUpRight size={14} strokeWidth={1.5} class="shrink-0" aria-hidden="true" />
        </a>
        {/* Authors only, because the card itself is: `SupportDialog` renders
            inside the authoring chrome, so a guest clicking this would set the
            signal and watch nothing happen. No trailing glyph either — in this
            panel the chevron means "expands" and the arrow means "leaves", and
            this does neither. */}
        {!readonly && (
          <button type="button" onClick={() => openSupportCard('panel')} class={cn(panelLinkRow, 'w-full text-left')}>
            <Heart size={14} strokeWidth={1.5} class="shrink-0" aria-hidden="true" />
            <span class="flex-1">Support MarkLayer</span>
          </button>
        )}
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
        infoPanelOpen.value ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-4 pointer-events-none',
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
    <DockedPanel visible={infoPanelOpen.value} width={INFO_PANEL_WIDTH}>
      <InfoPanelBody />
    </DockedPanel>
  );
}
