import { Menu } from '@base-ui/react/menu';
import { PeekSheet } from '@ext/components/BottomSheet';
import { MentionText } from '@ext/components/MentionText';
import { PriorityBadge } from '@ext/components/PriorityPicker';
import { SuggestionDiff } from '@ext/components/SelectionEdit';
import { StatusDot } from '@ext/components/StatusDot';
import { buildMarkdownExport, defaultExportFilename, downloadMarkdown } from '@ext/lib/export-text';
import { geist } from '@ext/lib/geist';
import {
  areas,
  copyOpenAnnotations,
  getReplies,
  inspects,
  openAnnotationTotal,
  operations,
  rootComments,
  setOpStatus,
} from '@ext/lib/ops';
import { fileUrl } from '@ext/lib/share';
import { getCommentStatus, STATUS_LABELS } from '@ext/lib/status-ui';
import { timeAgo } from '@ext/lib/time';
import { copyText, toast } from '@ext/lib/toasts';
import type { CommentOp, CommentStatus, DeviceMode } from '@ext/lib/types';
import { isUploadPath } from '@marklayer/brand/links';
import { isClosed } from '@marklayer/types/ops';
import { cn } from '@marklayer/ui/cn';
import { signal } from '@preact/signals';
import {
  BoxSelect,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Ellipsis,
  MessageSquare,
  Replace,
  SquareDashedMousePointer,
  TextSelect,
  Type,
  X,
} from 'lucide-preact';
import { useEffect, useRef } from 'preact/hooks';
import { tinykeys } from 'tinykeys';
import { AnnotationDetail } from './AnnotationDetail';
import { capture } from './analytics';
import { type AnnotationItem, itemAnchor, itemLabel, opBody, opLabel } from './annotationItems';
import { DOCKED_ANNOTATION_WIDTH, DockedPanel, PANEL_SIDEBAR, PANEL_TRANSITION } from './DockedPanel';
import { buildExportData } from './export-data';
import { IntroComposerSlot, IntroVideo, introComposerOpen, intros } from './IntroVideo';
import { pageUrl } from './projects';
import { ReviewSection } from './ReviewPanel';
import { DEVICE_ICONS, DEVICE_LABELS, menuItem } from './shared';
import { annotationPanelOpen, commentFilter, focusedAnnotationId, showAnnotationPanel } from './ui-state';
import { setBoardOpen } from './viewer-actions';
import { isReadonly, opMatchesDevice } from './viewer-state';
import { useViewerFrame } from './viewerFrame';

/** One export at a time: a long PDF takes seconds, and a second click would race the first. */
const fileExporting = signal(false);

/** What an export writes: the live page's ops, plus every other page when this is a project. */

interface BodyProps {
  onScrollTo: (y: number) => void;
}

/** The row offers one action, not a menu; this is where it goes next. */
const STATUS_CYCLE: Record<CommentStatus, CommentStatus> = {
  open: 'in_progress',
  in_progress: 'resolved',
  resolved: 'approved',
  approved: 'open',
  dismissed: 'open',
};
const STATUS_ACTIONS: Record<CommentStatus, string> = {
  open: 'Mark in progress',
  in_progress: 'Resolve',
  resolved: 'Approve',
  approved: 'Reopen',
  dismissed: 'Reopen',
};

/**
 * Status as metadata, not as a highlight. The tinted capsule this replaces put
 * the loudest object in the row on the one field nobody reads first — and its
 * ink was the status hue itself, which is 1.8:1 amber-on-white in light theme.
 * The dot carries the hue, the label carries the meaning at the same weight as
 * the timestamp beside it, and neither depends on the other to be understood.
 */
function StatusBadge({ status }: { status: CommentStatus }) {
  return (
    <span class="inline-flex items-center gap-1.5 text-meta font-medium text-(--ds-gray-900) whitespace-nowrap">
      <StatusDot status={status} />
      {STATUS_LABELS[status]}
    </span>
  );
}

function DeviceBadge({ device }: { device?: DeviceMode }) {
  if (!device || device === 'desktop') return null;
  const Icon = DEVICE_ICONS[device];
  return (
    <span class="inline-flex items-center gap-0.5 text-meta text-(--ds-gray-900) font-medium">
      <Icon size={9} aria-hidden="true" />
      {DEVICE_LABELS[device]}
    </span>
  );
}

/**
 * A row's one status step, out of sight until the row is hovered or focused —
 * then it takes the meta cluster's place, the way Mail swaps a date for actions.
 * A coarse pointer has no hover to find it with, so there it sits under the text.
 */
function QuickAction({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      class={cn(
        geist.actionBtn,
        geist.ctlIdle,
        'absolute right-4 top-2.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100',
        'transition-[opacity,background-color,color]',
        'pointer-coarse:opacity-100 pointer-coarse:top-auto pointer-coarse:bottom-2.5 pointer-coarse:right-auto pointer-coarse:left-4',
      )}
    >
      {label}
    </button>
  );
}

/** Right side of a row's first line; steps aside for `QuickAction`. */
const rowMeta =
  'flex shrink-0 items-center gap-2 transition-opacity duration-150 group-hover:opacity-0 pointer-fine:group-focus-within:opacity-0';

const rowButton =
  'w-full text-left px-4 py-3 bg-transparent border-none cursor-pointer transition-colors duration-100 hover:bg-(--ds-gray-alpha-100)';

/** A row that carries a `QuickAction`: room beneath the text for it on touch. */
const actionRowButton = cn(rowButton, 'pointer-coarse:pb-10');

function ReplyCount({ n }: { n: number }) {
  if (n === 0) return null;
  return (
    <span class="text-meta text-(--ds-gray-900) inline-flex items-center gap-1 tabular-nums">
      <MessageSquare size={11} aria-hidden="true" />
      {n}
    </span>
  );
}

/**
 * A comment in the list: identity, triage at a glance, and the first two lines.
 * Everything else — replies, assignee, context, the reply box — lives one click
 * away in the detail view, so the list stays scannable at 340px.
 */
function CommentRow({ op, onOpen }: { op: CommentOp; onOpen: () => void }) {
  const status = getCommentStatus(op);
  const replies = getReplies(op.id);
  const resolved = status === 'resolved';
  const closed = isClosed(status);

  return (
    <div class="group relative border-b border-(--ds-gray-alpha-400)">
      <button type="button" onClick={onOpen} class={actionRowButton}>
        <div class="flex items-center gap-2 h-5 mb-1">
          <div
            class="w-5 h-5 rounded-full text-white text-mini font-medium tabular-nums grid place-items-center shrink-0"
            style={{ background: closed ? 'var(--ds-gray-700)' : op.color }}
          >
            {status === 'approved' ? (
              <CheckCheck size={11} strokeWidth={2} aria-hidden="true" />
            ) : resolved ? (
              <Check size={11} strokeWidth={2} aria-hidden="true" />
            ) : (
              op.num
            )}
          </div>
          <span class="text-meta text-(--ds-gray-1000) font-semibold flex-1 truncate">{op.author || 'Anonymous'}</span>
          <span class={rowMeta}>
            {op.priority && <PriorityBadge priority={op.priority} />}
            <DeviceBadge device={op.device} />
            {/* Open is the resting state; only a change from it is news. */}
            {status !== 'open' && <StatusBadge status={status} />}
            <ReplyCount n={replies.length} />
            <span class="text-meta text-(--ds-gray-900) tabular-nums">{timeAgo(op.ts)}</span>
          </span>
        </div>
        <p
          class="text-ui text-(--ds-gray-1000) leading-relaxed m-0 line-clamp-2"
          style={{ textDecoration: closed ? 'line-through' : 'none', opacity: closed ? 0.5 : 1 }}
        >
          <MentionText text={op.text} mentions={op.mentions} />
        </p>
      </button>
      <QuickAction label={STATUS_ACTIONS[status]} onClick={() => setOpStatus(op.id, STATUS_CYCLE[status])} />
    </div>
  );
}

const STATUS_VALUES = ['open', 'in_progress', 'resolved', 'approved'] as const satisfies readonly CommentStatus[];

/**
 * Only the statuses the room actually has: four of the five lead to an empty
 * list in a room where every thread is open. The current filter is kept even at
 * zero, so a selection never disappears from under the person who made it.
 */
function filterOptions({
  counts,
  active,
  total,
}: {
  counts: Record<CommentStatus, number>;
  active: CommentStatus | 'all';
  total: number;
}): { value: CommentStatus | 'all'; label: string; count: number }[] {
  return [
    // `total`, not a sum over STATUS_VALUES: the `all` list includes dismissed
    // threads, which STATUS_VALUES leaves out, so summing it undercounts the
    // rows it is labelling.
    { value: 'all' as const, label: 'All', count: total },
    ...STATUS_VALUES.filter((v) => counts[v] > 0 || v === active).map((value) => ({
      value,
      label: STATUS_LABELS[value],
      count: counts[value],
    })),
  ];
}

/**
 * The status filter, as one control rather than a row of tabs. Five statuses of
 * "In progress" length cannot sit side by side in a 340px panel: the row either
 * scrolled — hiding the choice it exists to offer — or shaved its last tab flat
 * against the edge. A menu costs one click and always shows every status, its
 * count, and which one is in force.
 */
function StatusFilterMenu({
  filters,
  active,
}: {
  filters: { value: CommentStatus | 'all'; label: string; count: number }[];
  active: CommentStatus | 'all';
}) {
  const current = filters.find((f) => f.value === active) ?? filters[0];

  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label={`Filter by status: ${current.label}`}
        className={cn(
          'inline-flex items-center gap-2 h-7 pl-2 pr-1.5 rounded-md cursor-pointer appearance-none',
          'border border-(--ds-gray-alpha-400) bg-(--ds-background-100)',
          'text-ui font-medium text-(--ds-gray-1000) whitespace-nowrap outline-none',
          'transition-[background-color,border-color] duration-150 ease-out',
          'hover:bg-(--ds-gray-alpha-100) data-popup-open:bg-(--ds-gray-alpha-100)',
          'focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-1',
          'focus-visible:outline-(--ds-focus-color)',
        )}
      >
        {active !== 'all' && <StatusDot status={active} />}
        {current.label}
        <span class="tabular-nums text-(--ds-gray-900)">{current.count}</span>
        <ChevronDown size={13} strokeWidth={1.5} class="text-(--ds-gray-900)" aria-hidden="true" />
      </Menu.Trigger>

      <Menu.Portal>
        <Menu.Positioner side="bottom" align="start" sideOffset={6} className="z-2147483647">
          <Menu.Popup className={cn(geist.surface, 'min-w-52 p-1')}>
            <Menu.RadioGroup
              className="flex flex-col gap-px"
              value={active}
              onValueChange={(value: string) => {
                // Narrowed by lookup rather than asserted: the options are the
                // only values this group can emit.
                const picked = filters.find((f) => f.value === value);
                if (picked) commentFilter.value = picked.value;
              }}
            >
              {filters.map((f) => (
                <Menu.RadioItem
                  key={f.value}
                  value={f.value}
                  className={cn(
                    'flex items-center gap-2 h-8 px-2 rounded-md cursor-pointer border-none bg-transparent',
                    'text-ui text-(--ds-gray-1000) transition-colors duration-150',
                    'data-highlighted:bg-(--ds-gray-alpha-100) data-checked:font-medium',
                  )}
                >
                  <StatusDot status={f.value === 'all' ? undefined : f.value} />
                  <span class="truncate">{f.label}</span>
                  <span class="ml-auto tabular-nums text-meta text-(--ds-gray-900)">{f.count}</span>
                  {/* A held slot, so the counts stay on one right edge whichever row is checked. */}
                  <span class="w-3.5 shrink-0 inline-flex justify-end text-(--ds-gray-900)">
                    <Menu.RadioItemIndicator className="inline-flex">
                      <Check size={14} strokeWidth={1.75} aria-hidden="true" />
                    </Menu.RadioItemIndicator>
                  </span>
                </Menu.RadioItem>
              ))}
            </Menu.RadioGroup>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

/**
 * Every export and the board, behind one control. Four bare glyphs in a row
 * asked the reader to decode each one; a menu names them and costs one click.
 */
function PanelMenu({
  onCopyForAi,
  onCopy,
  onDownload,
  onDownloadFile,
}: {
  onCopyForAi: () => void;
  onCopy: () => void;
  onDownload: () => void;
  /** Absent unless the link annotates an uploaded file. */
  onDownloadFile?: () => void;
}) {
  const noneOpen = openAnnotationTotal.value === 0;
  return (
    <Menu.Root>
      <Menu.Trigger aria-label="More actions" title="More actions" className={cn(geist.ctl, geist.ctlIdle)}>
        <Ellipsis size={16} strokeWidth={1.5} aria-hidden="true" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="end" sideOffset={6} className="z-2147483647">
          <Menu.Popup className={cn(geist.surface, 'min-w-56 p-1 flex flex-col gap-px')}>
            <Menu.Item className={menuItem} onClick={onCopyForAi} disabled={noneOpen}>
              {noneOpen ? 'Nothing open to copy for AI' : 'Copy open annotations for AI'}
            </Menu.Item>
            <Menu.Item className={menuItem} onClick={onCopy}>
              Copy as Markdown
            </Menu.Item>
            <Menu.Item className={menuItem} onClick={onDownload}>
              Download Markdown
            </Menu.Item>
            {onDownloadFile && (
              <Menu.Item className={menuItem} onClick={onDownloadFile} disabled={fileExporting.value}>
                {fileExporting.value ? 'Preparing annotated file…' : 'Download annotated file'}
              </Menu.Item>
            )}
            <Menu.Separator className={cn(geist.divider, 'my-1 -mx-1')} />
            {!isReadonly.value && (
              <Menu.Item className={menuItem} onClick={() => (introComposerOpen.value = true)}>
                {intros.value.length ? 'Record a new intro version' : 'Pin an intro video'}
              </Menu.Item>
            )}
            <Menu.Item className={menuItem} onClick={() => setBoardOpen({ open: true, via: 'panel' })}>
              Open board
              <kbd class="ml-auto font-sans text-meta text-(--ds-gray-900)">⌘B</kbd>
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

function AnnotationPanelBody(props: BodyProps) {
  return (
    <>
      <IntroComposerSlot />
      <AnnotationPanelView {...props} />
    </>
  );
}

function AnnotationPanelView({ onScrollTo }: BodyProps) {
  const {
    meta: { frameRef },
  } = useViewerFrame();
  const buildExport = () => {
    const data = buildExportData();
    return buildMarkdownExport(data.ops, {
      url: data.url,
      pages: data.pages,
      fileUrl,
    });
  };
  // No capture here: `copyText` counts every clipboard hand-off, success and failure alike.
  const handleCopy = () => copyText(buildExport(), 'Markdown copied');

  const handleCopyForAi = () => {
    const data = buildExportData();
    // A project panel exports every page; the prompt is for the page on screen.
    copyOpenAnnotations({ ops: operations.value, url: data.url });
  };

  const handleDownload = () => {
    const md = buildExport();
    const data = buildExportData();
    downloadMarkdown(md, defaultExportFilename(data.url));
    capture('export_completed', { format: 'markdown', ops: operations.value.length });
    toast('Markdown exported', { type: 'success' });
  };

  const handleDownloadFile = async () => {
    if (fileExporting.peek()) return;
    fileExporting.value = true;
    const ops = operations.value.filter(opMatchesDevice);
    try {
      const { exportAnnotatedFile } = await import('./doc-export');
      const { format } = await exportAnnotatedFile({ frame: frameRef.current, url: pageUrl.value, ops });
      capture('export_completed', { format, ops: ops.length });
      toast(format === 'pdf' ? 'Annotated PDF exported' : 'Annotated PNG exported', { type: 'success' });
    } catch (error) {
      capture('export_failed', { format: 'file', reason: error instanceof Error ? error.message : 'unknown' });
      toast('Could not export the annotated file', { type: 'error' });
    } finally {
      fileExporting.value = false;
    }
  };

  const allOps = operations.value;
  const filter = commentFilter.value;

  const items: AnnotationItem[] = [];
  const statusCounts: Record<CommentStatus, number> = {
    open: 0,
    in_progress: 0,
    resolved: 0,
    approved: 0,
    dismissed: 0,
  };
  for (const c of rootComments.value) {
    const s = getCommentStatus(c);
    statusCounts[s]++;
    if (filter !== 'all' && s !== filter) continue;
    items.push({ kind: 'comment', op: c, replyCount: getReplies(c.id).length });
  }
  let textCount = 0;
  let selectionCount = 0;
  for (const op of allOps) {
    if (op.tool === 'text') {
      items.push({ kind: 'text', op });
      textCount++;
    } else if (op.tool === 'selection') {
      items.push({ kind: 'selection', op });
      selectionCount++;
    }
  }
  const areaList = areas.value;
  for (const op of areaList) items.push({ kind: 'area', op });
  for (const op of inspects.value) items.push({ kind: 'inspect', op });
  items.sort((a, b) => itemAnchor(a).y - itemAnchor(b).y);

  // A focused annotation that was deleted, or filtered out from under the view,
  // drops back to the list rather than leaving the panel on a dead detail.
  const focusIndex = items.findIndex((item) => item.op.id === focusedAnnotationId.value);
  const focused = focusIndex === -1 ? null : items[focusIndex];

  const step = (delta: number) => {
    if (focusIndex === -1 || items.length < 2) return;
    const next = items[(focusIndex + delta + items.length) % items.length];
    focusedAnnotationId.value = next.op.id;
    onScrollTo(itemAnchor(next).y);
  };

  const open = (item: AnnotationItem) => {
    focusedAnnotationId.value = item.op.id;
    onScrollTo(itemAnchor(item).y);
    capture('annotation_focused', { kind: item.kind });
  };

  // tinykeys isn't signal-aware, so the binding lives in an effect. The ref keeps
  // it pointed at the current list instead of rebinding on every render.
  const stepRef = useRef(step);
  stepRef.current = step;
  useEffect(() => {
    const move = (delta: number) => (e: KeyboardEvent) => {
      // Bare j/k would shadow a tool shortcut at rest, so they only bind while a
      // detail is actually open — which is also the only time stepping means anything.
      if (!focusedAnnotationId.peek()) return;
      e.preventDefault();
      stepRef.current(delta);
    };
    return tinykeys(window, {
      ArrowDown: move(1),
      KeyJ: move(1),
      ArrowUp: move(-1),
      KeyK: move(-1),
    });
  }, []);

  if (focused) {
    return (
      <>
        <div class="px-4 py-3 border-b border-(--ds-gray-alpha-400) shrink-0 flex items-center gap-2">
          <button
            type="button"
            onClick={() => (focusedAnnotationId.value = null)}
            title="Back to all annotations"
            aria-label="Back to all annotations"
            class={cn(geist.ctlSm, geist.ctlIdle, '-ml-1.5')}
          >
            <ChevronLeft size={16} strokeWidth={1.75} aria-hidden="true" />
          </button>
          <h2 class="text-ui font-semibold text-(--ds-gray-1000) m-0 tracking-ui truncate flex-1">
            {itemLabel(focused)}
          </h2>
          <div class="flex items-center gap-0.5 shrink-0">
            <button
              type="button"
              onClick={() => step(-1)}
              disabled={items.length < 2}
              title="Previous annotation (K)"
              aria-label="Previous annotation"
              class={cn(geist.ctlSm, geist.ctlIdle, 'disabled:opacity-40 disabled:cursor-default')}
            >
              <ChevronLeft size={15} strokeWidth={1.75} aria-hidden="true" />
            </button>
            <span class="text-meta text-(--ds-gray-900) tabular-nums whitespace-nowrap">
              {focusIndex + 1} of {items.length}
            </span>
            <button
              type="button"
              onClick={() => step(1)}
              disabled={items.length < 2}
              title="Next annotation (J)"
              aria-label="Next annotation"
              class={cn(geist.ctlSm, geist.ctlIdle, 'disabled:opacity-40 disabled:cursor-default')}
            >
              <ChevronRight size={15} strokeWidth={1.75} aria-hidden="true" />
            </button>
          </div>
        </div>
        <AnnotationDetail key={focused.op.id} item={focused} onScrollTo={onScrollTo} />
      </>
    );
  }

  const threadCount = rootComments.value.length;
  const filters = filterOptions({ counts: statusCounts, active: filter, total: threadCount });
  const totalCount = threadCount + textCount + selectionCount + areaList.length;

  return (
    <>
      <div class="px-4 py-3 border-b border-(--ds-gray-alpha-400) shrink-0">
        <div class="flex items-center justify-between gap-2">
          <h2 class="flex items-baseline gap-2 text-body font-semibold text-(--ds-gray-1000) m-0 tracking-ui">
            Comments
            <span class="text-ui font-normal text-(--ds-gray-900) tabular-nums">{totalCount}</span>
          </h2>
          <div class="flex shrink-0 items-center gap-0.5">
            <PanelMenu
              onCopyForAi={handleCopyForAi}
              onCopy={handleCopy}
              onDownload={handleDownload}
              onDownloadFile={isUploadPath(pageUrl.value) ? handleDownloadFile : undefined}
            />
            <button
              type="button"
              onClick={() => (showAnnotationPanel.value = false)}
              title="Close panel"
              aria-label="Close panel"
              class={cn(geist.ctl, geist.ctlIdle)}
            >
              <X size={16} strokeWidth={1.5} aria-hidden="true" />
            </button>
          </div>
        </div>
        {/* One filter is no filter: with a single status in the room "All" and
            that status are two views of one list, so the control only earns its
            place from two statuses up. */}
        {filters.length > 2 && (
          <div class="mt-3">
            <StatusFilterMenu filters={filters} active={filter} />
          </div>
        )}
      </div>

      <div class="flex-1 overflow-y-auto overscroll-contain">
        <IntroVideo />
        <ReviewSection />
        {/* A filtered-out list is not an empty room. Saying "no comments yet" over
            a room that has them, with no way back, is the panel lying to itself. */}
        {items.length === 0 && (
          <div class="flex flex-col items-center justify-center h-44 gap-2 px-6 text-center">
            <MessageSquare size={24} strokeWidth={1.5} class="text-(--ds-gray-700)" aria-hidden="true" />
            {filter === 'all' ? (
              <>
                <span class="text-ui font-medium text-(--ds-gray-1000)">No comments yet</span>
                <span class="text-meta text-(--ds-gray-900) leading-snug">Use the comment tool (C) to add one</span>
              </>
            ) : (
              <>
                <span class="text-ui font-medium text-(--ds-gray-1000)">
                  Nothing {STATUS_LABELS[filter].toLowerCase()}
                </span>
                <button
                  type="button"
                  onClick={() => (commentFilter.value = 'all')}
                  class={cn(geist.bareBtn, geist.bareBtnQuiet, 'font-medium underline underline-offset-2')}
                >
                  Show all {threadCount} threads
                </button>
              </>
            )}
          </div>
        )}

        {items.map((item) => {
          if (item.kind === 'comment') {
            return <CommentRow key={item.op.id} op={item.op} onOpen={() => open(item)} />;
          }

          if (item.kind === 'area') {
            const { op } = item;
            const w = Math.abs(op.endX - op.startX);
            const h = Math.abs(op.endY - op.startY);
            const areaStatus = getCommentStatus(op);
            const areaResolved = isClosed(areaStatus);
            return (
              <div key={op.id} class="group relative border-b border-(--ds-gray-alpha-400)">
                <button type="button" class={actionRowButton} onClick={() => open(item)}>
                  <div class="flex items-center gap-2 h-5 mb-1">
                    <BoxSelect
                      size={12}
                      strokeWidth={1.5}
                      color={areaResolved ? 'var(--ds-gray-700)' : op.color}
                      aria-hidden="true"
                    />
                    <span class="text-meta text-(--ds-gray-900) font-medium flex-1">Area</span>
                    <span class={rowMeta}>
                      <DeviceBadge device={op.device} />
                      {areaStatus !== 'open' && <StatusBadge status={areaStatus} />}
                    </span>
                  </div>
                  {op.comment ? (
                    <p
                      class="text-meta text-(--ds-gray-1000) m-0 line-clamp-2 leading-relaxed"
                      style={{
                        textDecoration: areaResolved ? 'line-through' : 'none',
                        opacity: areaResolved ? 0.5 : 1,
                      }}
                    >
                      <MentionText text={op.comment} mentions={op.mentions} />
                    </p>
                  ) : (
                    <p class="text-meta text-(--ds-gray-900) m-0">No comment</p>
                  )}
                  <p class="text-meta text-(--ds-gray-900) m-0 mt-1 tabular-nums">
                    {Math.round(w)} × {Math.round(h)} px
                  </p>
                </button>
                <QuickAction
                  label={areaResolved ? 'Reopen' : 'Resolve'}
                  onClick={() => setOpStatus(op.id, areaResolved ? 'open' : 'resolved')}
                />
              </div>
            );
          }

          if (item.kind === 'inspect') {
            const { op } = item;
            const status = getCommentStatus(op);
            return (
              <div key={op.id} class="group relative border-b border-(--ds-gray-alpha-400)">
                <button type="button" class={actionRowButton} onClick={() => open(item)}>
                  <div class="flex items-center gap-2 h-5 mb-1">
                    <SquareDashedMousePointer size={12} strokeWidth={1.5} color={op.color} aria-hidden="true" />
                    <span class="text-meta text-(--ds-gray-900) font-medium flex-1">{opLabel(op)}</span>
                    <span class={rowMeta}>
                      <DeviceBadge device={op.device} />
                      {status !== 'open' && <StatusBadge status={status} />}
                    </span>
                  </div>
                  <p class="text-meta text-(--ds-gray-1000) m-0 line-clamp-2 leading-relaxed">{opBody(op)}</p>
                </button>
                <QuickAction label={STATUS_ACTIONS[status]} onClick={() => setOpStatus(op.id, STATUS_CYCLE[status])} />
              </div>
            );
          }

          if (item.kind === 'selection') {
            const { op } = item;
            const selStatus = getCommentStatus(op);
            const selResolved = isClosed(selStatus);
            const selReplies = getReplies(op.id);
            const SelIcon = op.suggestion ? Replace : TextSelect;
            return (
              <div key={op.id} class="group relative border-b border-(--ds-gray-alpha-400)">
                <button type="button" class={actionRowButton} onClick={() => open(item)}>
                  <div class="flex items-center gap-2 h-5 mb-1">
                    <SelIcon
                      size={12}
                      strokeWidth={1.5}
                      color={selResolved ? 'var(--ds-gray-700)' : op.color}
                      aria-hidden="true"
                    />
                    <span class="text-meta text-(--ds-gray-1000) font-semibold flex-1 truncate">
                      {op.author || 'Anonymous'}
                    </span>
                    <span class={rowMeta}>
                      {op.priority && <PriorityBadge priority={op.priority} />}
                      <DeviceBadge device={op.device} />
                      {selStatus !== 'open' && <StatusBadge status={selStatus} />}
                      <ReplyCount n={selReplies.length} />
                      <span class="text-meta text-(--ds-gray-900) tabular-nums">{timeAgo(op.ts)}</span>
                    </span>
                  </div>
                  {op.suggestion ? (
                    <SuggestionDiff text={op.text} suggestion={op.suggestion} resolved={selResolved} />
                  ) : (
                    <p
                      class="text-meta text-(--ds-gray-900) m-0 line-clamp-2 leading-relaxed"
                      style={{ textDecoration: selResolved ? 'line-through' : 'none', opacity: selResolved ? 0.5 : 1 }}
                    >
                      "{op.text}"
                    </p>
                  )}
                  {op.comment && (
                    <p
                      class="text-ui text-(--ds-gray-1000) leading-relaxed m-0 mt-1 line-clamp-2"
                      style={{ textDecoration: selResolved ? 'line-through' : 'none', opacity: selResolved ? 0.5 : 1 }}
                    >
                      <MentionText text={op.comment} mentions={op.mentions} />
                    </p>
                  )}
                </button>
                <QuickAction
                  label={STATUS_ACTIONS[selStatus]}
                  onClick={() => setOpStatus(op.id, STATUS_CYCLE[selStatus])}
                />
              </div>
            );
          }

          const { op } = item;
          return (
            <button
              key={op.id}
              type="button"
              class={cn(rowButton, 'border-b border-solid border-x-0 border-t-0 border-(--ds-gray-alpha-400)')}
              onClick={() => open(item)}
            >
              <div class="flex items-center gap-2 h-5 mb-1">
                <Type size={12} strokeWidth={1.5} color={op.color} aria-hidden="true" />
                <span class="text-meta text-(--ds-gray-900) font-medium flex-1">Text</span>
                <DeviceBadge device={op.device} />
              </div>
              <p class="text-meta m-0 line-clamp-2 leading-relaxed" style={{ color: op.color }}>
                {op.text}
              </p>
            </button>
          );
        })}
      </div>
    </>
  );
}

/** Half the screen: the thread, and the page it is about still in view above it. */
const SHEET_PEEK = 0.55;

/** The panel on a phone: a sheet over the page rather than a column beside it. */
export function AnnotationSheet(props: BodyProps) {
  return (
    <PeekSheet
      open={annotationPanelOpen.value}
      onOpenChange={(open) => (showAnnotationPanel.value = open)}
      label="Comments"
      peek={SHEET_PEEK}
    >
      <AnnotationPanelBody {...props} />
    </PeekSheet>
  );
}

export function AnnotationPanel(props: BodyProps) {
  const visible = annotationPanelOpen.value;
  return (
    <div
      class={cn(
        PANEL_SIDEBAR,
        'right-0 border-l border-(--ds-gray-alpha-400)',
        PANEL_TRANSITION,
        visible ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-4 pointer-events-none',
      )}
      style={{ width: DOCKED_ANNOTATION_WIDTH }}
    >
      <AnnotationPanelBody {...props} />
    </div>
  );
}

export function DockedAnnotationPanel(props: BodyProps) {
  return (
    <DockedPanel visible={annotationPanelOpen.value} width={DOCKED_ANNOTATION_WIDTH}>
      <AnnotationPanelBody {...props} />
    </DockedPanel>
  );
}
