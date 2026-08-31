import { Menu } from '@base-ui/react/menu';
import { MentionText } from '@ext/components/MentionText';
import { PriorityBadge } from '@ext/components/PriorityPicker';
import { SuggestionDiff } from '@ext/components/SelectionEdit';
import { StatusDot } from '@ext/components/StatusDot';
import { buildMarkdownExport, defaultExportFilename, downloadMarkdown } from '@ext/lib/export-text';
import { geist } from '@ext/lib/geist';
import {
  annotationPanelOpen,
  areas,
  commentFilter,
  copyText,
  focusedAnnotationId,
  getCommentStatus,
  getReplies,
  operations,
  rootComments,
  STATUS_LABELS,
  setOpStatus,
  showAnnotationPanel,
  toast,
} from '@ext/lib/state';
import { timeAgo } from '@ext/lib/time';
import type { CommentOp, CommentStatus, DeviceMode, DrawOp } from '@ext/lib/types';
import { cn, isSettled } from '@marklayer/types';
import {
  BoxSelect,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardCopy,
  Columns3,
  Download,
  MessageSquare,
  Replace,
  TextSelect,
  Type,
  X,
} from 'lucide-preact';
import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { tinykeys } from 'tinykeys';
import { AnnotationDetail } from './AnnotationDetail';
import { capture } from './analytics';
import { type AnnotationItem, itemAnchor, itemLabel } from './annotationItems';
import { DEVICE_ICONS, DEVICE_LABELS } from './shared';
import { showBoard } from './signals';

/** What an export writes: the live page's ops, plus every other page when this is a project. */
export interface ExportData {
  ops: DrawOp[];
  url?: string;
  pages?: { url: string | null; ops: DrawOp[] }[];
}

interface BodyProps {
  onScrollTo: (x: number, y: number) => void;
  getExportData?: () => ExportData;
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
 * A comment in the list: identity, triage at a glance, and the first two lines.
 * Everything else — replies, assignee, context, the reply box — lives one click
 * away in the detail view, so the list stays scannable at 340px.
 */
function CommentRow({ op, onOpen }: { op: CommentOp; onOpen: () => void }) {
  const status = getCommentStatus(op);
  const replies = getReplies(op.id);
  const resolved = status === 'resolved';
  const settled = isSettled(status);

  return (
    <div class="border-b border-(--ds-gray-alpha-400)">
      <button
        type="button"
        onClick={onOpen}
        class="w-full text-left px-4 pt-3 pb-2 bg-transparent border-none cursor-pointer
               transition-colors duration-100 hover:bg-(--ds-gray-alpha-100)"
      >
        <div class="flex items-center gap-2 mb-1.5">
          <div
            class="w-5 h-5 rounded-full text-white text-mini font-medium tabular-nums grid place-items-center shrink-0"
            style={{ background: settled ? 'var(--ds-gray-700)' : op.color }}
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
          {op.priority && <PriorityBadge priority={op.priority} />}
          <DeviceBadge device={op.device} />
          <StatusBadge status={status} />
          <span class="text-meta text-(--ds-gray-900) tabular-nums">{timeAgo(op.ts)}</span>
        </div>
        <p
          class="text-ui text-(--ds-gray-1000) leading-relaxed m-0 line-clamp-2"
          style={{ textDecoration: settled ? 'line-through' : 'none', opacity: settled ? 0.5 : 1 }}
        >
          <MentionText text={op.text} mentions={op.mentions} />
        </p>
      </button>
      <div class="flex items-center gap-3 px-4 pb-2.5">
        {replies.length > 0 && (
          <span class="text-meta text-(--ds-gray-900) flex items-center gap-1 font-medium">
            <MessageSquare size={11} aria-hidden="true" />
            {replies.length}
          </span>
        )}
        <button
          type="button"
          onClick={() => setOpStatus(op.id, STATUS_CYCLE[status])}
          class={cn(geist.actionBtn, geist.ctlIdle)}
        >
          {STATUS_ACTIONS[status]}
        </button>
      </div>
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

function AnnotationPanelBody({ onScrollTo, getExportData }: BodyProps) {
  const buildExport = () => {
    const data = getExportData?.() ?? { ops: operations.value };
    return buildMarkdownExport(data.ops, { url: data.url, pages: data.pages });
  };
  // No capture here: `copyText` counts every clipboard hand-off, success and failure alike.
  const handleCopy = () => copyText(buildExport(), 'Markdown copied');

  const handleDownload = () => {
    const md = buildExport();
    const data = getExportData?.() ?? { ops: operations.value };
    downloadMarkdown(md, defaultExportFilename(data.url));
    capture('export_completed', { format: 'markdown', ops: operations.value.length });
    toast('Markdown exported', 'success');
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
  items.sort((a, b) => itemAnchor(a).y - itemAnchor(b).y);

  // A focused annotation that was deleted, or filtered out from under the view,
  // drops back to the list rather than leaving the panel on a dead detail.
  const focusIndex = items.findIndex((item) => item.op.id === focusedAnnotationId.value);
  const focused = focusIndex === -1 ? null : items[focusIndex];

  const step = (delta: number) => {
    if (focusIndex === -1 || items.length < 2) return;
    const next = items[(focusIndex + delta + items.length) % items.length];
    focusedAnnotationId.value = next.op.id;
    const { x, y } = itemAnchor(next);
    onScrollTo(x, y);
  };

  const open = (item: AnnotationItem) => {
    focusedAnnotationId.value = item.op.id;
    const { x, y } = itemAnchor(item);
    onScrollTo(x, y);
    capture('annotation_focused', { kind: item.kind });
  };

  // tinykeys isn't signal-aware, so the binding lives in an effect. The ref keeps
  // it pointed at the current list instead of rebinding on every render.
  const stepRef = useRef(step);
  stepRef.current = step;
  useEffect(() => {
    const editable = (target: EventTarget | null) =>
      target instanceof HTMLElement &&
      (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
    const move = (delta: number) => (e: KeyboardEvent) => {
      // Bare j/k would shadow a tool shortcut at rest, so they only bind while a
      // detail is actually open — which is also the only time stepping means anything.
      if (!focusedAnnotationId.peek() || editable(e.target)) return;
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

  return (
    <>
      {/* Header */}
      <div class="px-4 py-3 border-b border-(--ds-gray-alpha-400) shrink-0">
        <div class="flex items-center justify-between gap-2">
          {/* One line, always. The per-status tallies that used to run on here are
              the filter tabs below now; keeping both wrapped the summary onto a
              second line that ran under the icon row and shoved the tabs down. */}
          <div class="min-w-0">
            <h2 class="text-body font-semibold text-(--ds-gray-1000) m-0 tracking-ui">Comments</h2>
            <span class="block truncate text-meta text-(--ds-gray-900)">
              {threadCount} thread{threadCount !== 1 ? 's' : ''}
              {textCount > 0 && ` · ${textCount} text`}
              {selectionCount > 0 && ` · ${selectionCount} selection`}
              {areaList.length > 0 && ` · ${areaList.length} area`}
            </span>
          </div>
          <div class="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              onClick={() => {
                // The board is the same annotations in another arrangement, so it
                // replaces the panel rather than stacking over it.
                showAnnotationPanel.value = false;
                showBoard.value = true;
              }}
              title="Open the board (⌘B)"
              aria-label="Open the board"
              class={cn(geist.ctl, geist.ctlIdle)}
            >
              <Columns3 size={16} strokeWidth={1.5} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={handleCopy}
              title="Copy comments + selections as Markdown"
              aria-label="Copy comments and selections as Markdown"
              class={cn(geist.ctl, geist.ctlIdle)}
            >
              <ClipboardCopy size={16} strokeWidth={1.5} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={handleDownload}
              title="Download Markdown (.md)"
              aria-label="Download Markdown"
              class={cn(geist.ctl, geist.ctlIdle)}
            >
              <Download size={16} strokeWidth={1.5} aria-hidden="true" />
            </button>
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

      {/* List */}
      <div class="flex-1 overflow-y-auto">
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
            const areaResolved = op.status === 'resolved';
            return (
              <div key={op.id} class="border-b border-(--ds-gray-alpha-400)">
                <button
                  type="button"
                  class="w-full text-left px-4 py-3
                         bg-transparent cursor-pointer transition-colors duration-100
                         hover:bg-(--ds-gray-alpha-100)"
                  onClick={() => open(item)}
                >
                  <div class="flex items-center gap-2 mb-1">
                    <BoxSelect
                      size={12}
                      strokeWidth={1.5}
                      color={areaResolved ? 'var(--ds-gray-700)' : op.color}
                      aria-hidden="true"
                    />
                    <span class="text-meta text-(--ds-gray-900) font-medium flex-1">Area</span>
                    <DeviceBadge device={op.device} />
                    {areaResolved && <StatusBadge status="resolved" />}
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
                <div class="flex items-center gap-3 px-4 pb-2.5">
                  <button
                    type="button"
                    onClick={() => setOpStatus(op.id, areaResolved ? 'open' : 'resolved')}
                    class={cn(geist.actionBtn, geist.ctlIdle)}
                  >
                    {areaResolved ? 'Reopen' : 'Resolve'}
                  </button>
                </div>
              </div>
            );
          }

          if (item.kind === 'selection') {
            const { op } = item;
            const selStatus = getCommentStatus(op);
            const selResolved = selStatus === 'resolved' || selStatus === 'dismissed';
            const selReplies = getReplies(op.id);
            const SelIcon = op.suggestion ? Replace : TextSelect;
            return (
              <div key={op.id} class="border-b border-(--ds-gray-alpha-400)">
                <button
                  type="button"
                  class="w-full text-left px-4 pt-3 pb-2
                         bg-transparent border-none cursor-pointer transition-colors duration-100
                         hover:bg-(--ds-gray-alpha-100)"
                  onClick={() => open(item)}
                >
                  <div class="flex items-center gap-2 mb-1.5">
                    <SelIcon
                      size={12}
                      strokeWidth={1.5}
                      color={selResolved ? 'var(--ds-gray-700)' : op.color}
                      aria-hidden="true"
                    />
                    <span class="text-meta text-(--ds-gray-1000) font-semibold flex-1 truncate">
                      {op.author || 'Anonymous'}
                    </span>
                    {op.priority && <PriorityBadge priority={op.priority} />}
                    <DeviceBadge device={op.device} />
                    <StatusBadge status={selStatus} />
                    <span class="text-meta text-(--ds-gray-900) tabular-nums">{timeAgo(op.ts)}</span>
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
                <div class="flex items-center gap-3 px-4 pb-2.5">
                  {selReplies.length > 0 && (
                    <span class="text-meta text-(--ds-gray-900) flex items-center gap-1 font-medium">
                      <MessageSquare size={11} aria-hidden="true" />
                      {selReplies.length}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => setOpStatus(op.id, STATUS_CYCLE[selStatus])}
                    class={cn(geist.actionBtn, geist.ctlIdle)}
                  >
                    {STATUS_ACTIONS[selStatus]}
                  </button>
                </div>
              </div>
            );
          }

          const { op } = item;
          return (
            <button
              key={op.id}
              type="button"
              class="w-full text-left px-4 py-3 border-b border-(--ds-gray-alpha-400)
                     bg-transparent cursor-pointer transition-colors duration-100
                     hover:bg-(--ds-gray-alpha-100)"
              onClick={() => open(item)}
            >
              <div class="flex items-center gap-2 mb-1">
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

export const PANEL_BASE = cn(geist.surface, 'flex flex-col overflow-hidden');

/**
 * The desktop panels as flush sidebars: square, hard against the window edge, and
 * separated from the frame by one inner hairline rather than an all-round shadow —
 * a panel welded to an edge has no side for a shadow to fall on. Layered above the
 * toolbar (z-2147483646) so a sidebar covers it instead of being covered by it.
 */
export const PANEL_SIDEBAR = cn(
  'absolute inset-y-0 z-2147483647 flex flex-col overflow-hidden bg-(--ds-background-100)',
);
export const PANEL_TRANSITION = 'transition-[opacity,translate] duration-300 ease-ml-spring';

/** Width of the docked variant, and the `m-3` gutters around it. The viewer subtracts
 *  both when auto-fitting a device frame, since a docked panel takes real width from it. */
export const DOCKED_ANNOTATION_WIDTH = 340;
export const DOCK_GUTTER = 24;

/**
 * A panel docked beside the device frame (rather than overlaid on it), shared
 * by the annotation panel and the viewer's info panel so the collapse trick —
 * width-to-0 with `!mx-0 !p-0 !border-0` to erase the gutter — lives once.
 */
export function DockedPanel({
  visible,
  width,
  children,
}: {
  visible: boolean;
  width: number;
  children: ComponentChildren;
}) {
  return (
    <div
      class={cn(
        'shrink-0 m-3 rounded-xl',
        PANEL_TRANSITION,
        PANEL_BASE,
        visible ? 'opacity-100' : 'opacity-0 !mx-0 !p-0 !border-0',
      )}
      style={{ width: visible ? width : 0 }}
    >
      {children}
    </div>
  );
}

export function AnnotationPanel(props: BodyProps) {
  const visible = annotationPanelOpen.value;
  return (
    <div
      class={cn(
        PANEL_SIDEBAR,
        'right-0 w-[340px] border-l border-(--ds-gray-alpha-400)',
        PANEL_TRANSITION,
        visible ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-4 pointer-events-none',
      )}
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
