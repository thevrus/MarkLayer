import { Avatar } from '@ext/components/Avatar';
import { PriorityBadge } from '@ext/components/PriorityPicker';
import { SuggestionDiff } from '@ext/components/SelectionEdit';
import { submitBtn, textareaCls } from '@ext/lib/buttons';
import { buildMarkdownExport, defaultExportFilename, downloadMarkdown } from '@ext/lib/export-text';
import { geist } from '@ext/lib/geist';
import { glass } from '@ext/lib/glass';
import {
  areas,
  color,
  commentFilter,
  copyText,
  getCommentStatus,
  getReplies,
  localUser,
  operations,
  pushReply,
  rootComments,
  STATUS_LABELS,
  setOpStatus,
  showAnnotationPanel,
  toast,
} from '@ext/lib/state';
import { timeAgo } from '@ext/lib/time';
import type { AreaOp, CommentOp, CommentStatus, DeviceMode, DrawOp, SelectionOp, TextOp } from '@ext/lib/types';
import { cn } from '@marklayer/types';
import { BoxSelect, Check, ClipboardCopy, Download, MessageSquare, Replace, TextSelect, Type, X } from 'lucide-preact';
import type { ComponentChildren } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { DEVICE_ICONS } from './shared';

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

type AnnotationItem =
  | { kind: 'comment'; op: CommentOp; replyCount: number }
  | { kind: 'text'; op: TextOp }
  | { kind: 'selection'; op: SelectionOp }
  | { kind: 'area'; op: AreaOp };

const STATUS_COLORS: Record<CommentStatus, string> = {
  open: 'var(--ds-blue-800)',
  in_progress: 'var(--ds-amber-700)',
  resolved: 'var(--ds-green-700)',
  dismissed: 'var(--ds-gray-700)',
};
const STATUS_ACTIONS: Record<CommentStatus, string> = {
  open: 'Mark in progress',
  in_progress: 'Resolve',
  resolved: 'Reopen',
  dismissed: 'Reopen',
};

function StatusBadge({ status }: { status: CommentStatus }) {
  return (
    <span
      class="text-meta font-medium px-1.5 py-0.5 rounded-md"
      style={{
        color: STATUS_COLORS[status],
        background: `color-mix(in oklch, ${STATUS_COLORS[status]} 14%, transparent)`,
      }}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

const DEVICE_LABELS: Record<DeviceMode, string> = { desktop: 'Desktop', tablet: 'Tablet', mobile: 'Mobile' };

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

function MetaInfo({ op }: { op: CommentOp }) {
  if (!op.meta) return null;
  const parts: string[] = [];
  if (op.meta.browser) parts.push(op.meta.browser);
  if (op.meta.os) parts.push(op.meta.os);
  if (op.meta.viewport) parts.push(`${op.meta.viewport.width}×${op.meta.viewport.height}`);
  if (!parts.length) return null;
  return <span class="text-meta text-(--ds-gray-900) mt-1 block">{parts.join(' · ')}</span>;
}

function CommentThread({ op, onScrollTo }: { op: CommentOp; onScrollTo: (x: number, y: number) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [replying, setReplying] = useState(false);
  const replyRef = useRef<HTMLTextAreaElement>(null);
  const replies = getReplies(op.id);
  const status = getCommentStatus(op);

  const submitReply = () => {
    const txt = replyRef.current?.value.trim();
    if (!txt) return;
    pushReply(op, txt);
    if (replyRef.current) replyRef.current.value = '';
    setReplying(false);
  };

  const cycleStatus = (e: Event) => {
    e.stopPropagation();
    const order: CommentStatus[] = ['open', 'in_progress', 'resolved'];
    const next = order[(order.indexOf(status) + 1) % order.length];
    setOpStatus(op.id, next);
  };

  return (
    <div class="border-b border-(--ds-gray-alpha-400)">
      {/* Root comment header — click to expand */}
      <div
        class={cn(
          'px-4 py-3 cursor-pointer transition-colors duration-100 hover:bg-(--ds-gray-alpha-100)',
          expanded && 'bg-(--ds-gray-alpha-100)',
        )}
        onClick={() => setExpanded(!expanded)}
      >
        <div class="flex items-center gap-2 mb-1.5">
          <div
            class="w-5 h-5 rounded-full text-white text-mini font-medium tabular-nums grid place-items-center shrink-0"
            style={{ background: status === 'resolved' ? 'var(--ds-gray-700)' : op.color }}
          >
            {status === 'resolved' ? <Check size={11} strokeWidth={2} aria-hidden="true" /> : op.num}
          </div>
          <span class="text-meta text-(--ds-gray-1000) font-semibold flex-1 truncate">{op.author || 'Anonymous'}</span>
          {op.priority && <PriorityBadge priority={op.priority} />}
          <DeviceBadge device={op.device} />
          <StatusBadge status={status} />
          <span class="text-meta text-(--ds-gray-900) tabular-nums">{timeAgo(op.ts)}</span>
        </div>
        <p
          class={cn('text-ui text-(--ds-gray-1000) leading-relaxed m-0', !expanded && 'line-clamp-2')}
          style={{
            textDecoration: status === 'resolved' ? 'line-through' : 'none',
            opacity: status === 'resolved' ? 0.5 : 1,
          }}
        >
          {op.text}
        </p>
        {expanded && <MetaInfo op={op} />}
        <div class="flex items-center gap-3 mt-2">
          {replies.length > 0 && (
            <span class="text-meta text-(--ds-gray-900) flex items-center gap-1 font-medium">
              <MessageSquare size={11} aria-hidden="true" />
              {replies.length}
            </span>
          )}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onScrollTo(op.x, op.y);
            }}
            class={cn(geist.bareBtn, geist.bareBtnQuiet, 'font-medium')}
          >
            Go to
          </button>
          <button type="button" onClick={cycleStatus} class={cn(geist.bareBtn, geist.bareBtnQuiet, 'font-medium')}>
            {STATUS_ACTIONS[status]}
          </button>
        </div>
      </div>

      {expanded && (
        <div class="bg-(--ds-gray-alpha-100)">
          {replies.length > 0 && (
            <div class="px-4 pb-1">
              {replies.map((reply) => (
                <div key={reply.id} class="flex gap-2 py-2 border-t border-(--ds-gray-alpha-400) first:border-t-0">
                  <Avatar name={reply.author || '?'} color={reply.color} size="sm" style={{ marginTop: 2 }} />
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2">
                      <span class="text-meta text-(--ds-gray-1000) font-semibold truncate">
                        {reply.author || 'Anonymous'}
                      </span>
                      <span class="text-meta text-(--ds-gray-900) tabular-nums">{timeAgo(reply.ts)}</span>
                    </div>
                    <p
                      class="text-ui text-(--ds-gray-1000) leading-relaxed m-0 mt-0.5"
                      style={{ wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}
                    >
                      {reply.text}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Reply input */}
          {replying ? (
            <div class="px-4 pb-3 pt-1">
              <div class="flex gap-2">
                <Avatar name={localUser.name} color={color.value} size="sm" style={{ marginTop: 6 }} />
                <div class="flex-1">
                  <textarea
                    name="reply"
                    ref={replyRef}
                    placeholder="Write a reply…"
                    rows={1}
                    class={cn(textareaCls, glass.font, 'w-full min-h-8 max-h-[100px]')}
                    style={{ fieldSizing: 'content', boxSizing: 'border-box' }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        submitReply();
                      } else if (e.key === 'Escape') {
                        setReplying(false);
                      }
                    }}
                  />
                  <div class="flex items-center justify-end gap-2 mt-1.5">
                    <button
                      type="button"
                      onClick={() => setReplying(false)}
                      class={cn(geist.ctlSm, geist.ctlIdle, 'w-auto px-2.5 text-ui font-medium')}
                    >
                      Cancel
                    </button>
                    <button type="button" onClick={submitReply} class={submitBtn}>
                      Reply
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div class="px-4 pb-3 pt-1">
              <button
                type="button"
                onClick={() => {
                  setReplying(true);
                  setTimeout(() => replyRef.current?.focus(), 50);
                }}
                class={cn(
                  geist.field,
                  'w-full flex items-center px-3 text-left text-ui text-(--ds-gray-700) cursor-text',
                  'hover:border-(--ds-gray-700)',
                )}
              >
                Reply…
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const STATUS_VALUES = ['open', 'in_progress', 'resolved'] as const satisfies readonly CommentStatus[];
const FILTER_OPTIONS: { value: CommentStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  ...STATUS_VALUES.map((value) => ({ value, label: STATUS_LABELS[value] })),
];

function AnnotationPanelBody({ onScrollTo, getExportData }: BodyProps) {
  const buildExport = () => {
    const data = getExportData?.() ?? { ops: operations.value };
    return buildMarkdownExport(data.ops, { url: data.url, pages: data.pages });
  };
  const handleCopy = () => copyText(buildExport(), 'Markdown copied');
  const handleDownload = () => {
    const md = buildExport();
    const data = getExportData?.() ?? { ops: operations.value };
    downloadMarkdown(md, defaultExportFilename(data.url));
    toast('Markdown exported', 'success');
  };

  const allOps = operations.value;
  const filter = commentFilter.value;

  const items: AnnotationItem[] = [];
  const statusCounts: Record<CommentStatus, number> = { open: 0, in_progress: 0, resolved: 0, dismissed: 0 };
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
  const itemY = (item: AnnotationItem) => {
    if (item.kind === 'selection') return item.op.rects[0]?.y ?? 0;
    if (item.kind === 'area') return Math.min(item.op.startY, item.op.endY);
    return item.op.y;
  };
  items.sort((a, b) => itemY(a) - itemY(b));

  return (
    <>
      {/* Header */}
      <div class="px-4 py-3 border-b border-(--ds-gray-alpha-400) shrink-0">
        <div class="flex items-center justify-between">
          <div>
            <h2 class="text-body font-semibold text-(--ds-gray-1000) m-0 tracking-ui">Comments</h2>
            <span class="text-meta text-(--ds-gray-900)">
              {rootComments.value.length} thread{rootComments.value.length !== 1 ? 's' : ''}
              {statusCounts.resolved > 0 && ` · ${statusCounts.resolved} resolved`}
              {textCount > 0 && ` · ${textCount} text`}
              {selectionCount > 0 && ` · ${selectionCount} selection`}
              {areaList.length > 0 && ` · ${areaList.length} area`}
            </span>
          </div>
          <div class="flex items-center gap-0.5">
            <button
              type="button"
              onClick={handleCopy}
              title="Copy comments + selections as Markdown"
              class={cn(geist.ctl, geist.ctlIdle)}
            >
              <ClipboardCopy size={16} strokeWidth={1.5} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={handleDownload}
              title="Download Markdown (.md)"
              class={cn(geist.ctl, geist.ctlIdle)}
            >
              <Download size={16} strokeWidth={1.5} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => (showAnnotationPanel.value = false)}
              title="Close panel"
              class={cn(geist.ctl, geist.ctlIdle)}
            >
              <X size={16} strokeWidth={1.5} aria-hidden="true" />
            </button>
          </div>
        </div>
        {/* Filter tabs */}
        <div class={cn(geist.track, 'mt-3')} role="tablist">
          {FILTER_OPTIONS.map((f) => {
            const count = f.value === 'all' ? rootComments.value.length : statusCounts[f.value];
            const on = filter === f.value;
            return (
              <button
                key={f.value}
                type="button"
                role="tab"
                aria-selected={on}
                data-pressed={on ? '' : undefined}
                onClick={() => (commentFilter.value = f.value)}
                class={geist.segmentText}
              >
                {f.label}
                {count > 0 ? ` (${count})` : ''}
              </button>
            );
          })}
        </div>
      </div>

      {/* List */}
      <div class="flex-1 overflow-y-auto">
        {items.length === 0 && (
          <div class="flex flex-col items-center justify-center h-44 gap-2 px-6 text-center">
            <MessageSquare size={24} strokeWidth={1.5} class="text-(--ds-gray-700)" aria-hidden="true" />
            <span class="text-ui font-medium text-(--ds-gray-1000)">No comments yet</span>
            <span class="text-meta text-(--ds-gray-900) leading-snug">Use the comment tool (C) to add one</span>
          </div>
        )}

        {items.map((item) => {
          if (item.kind === 'comment') {
            return <CommentThread key={item.op.id} op={item.op} onScrollTo={onScrollTo} />;
          }

          if (item.kind === 'area') {
            const { op } = item;
            const minX = Math.min(op.startX, op.endX);
            const minY = Math.min(op.startY, op.endY);
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
                  onClick={() => onScrollTo(minX, minY)}
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
                      {op.comment}
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
                    onClick={() => onScrollTo(minX, minY)}
                    class={cn(geist.bareBtn, geist.bareBtnQuiet)}
                  >
                    Go to
                  </button>
                  <button
                    type="button"
                    onClick={() => setOpStatus(op.id, areaResolved ? 'open' : 'resolved')}
                    class={cn(geist.bareBtn, geist.bareBtnQuiet)}
                  >
                    {areaResolved ? 'Reopen' : 'Resolve'}
                  </button>
                </div>
              </div>
            );
          }

          if (item.kind === 'selection') {
            const { op } = item;
            const firstRect = op.rects[0];
            const selResolved = op.status === 'resolved';
            const SelIcon = op.suggestion ? Replace : TextSelect;
            return (
              <div key={op.id} class="border-b border-(--ds-gray-alpha-400)">
                <button
                  type="button"
                  class="w-full text-left px-4 py-3
                         bg-transparent cursor-pointer transition-colors duration-100
                         hover:bg-(--ds-gray-alpha-100)"
                  onClick={() => firstRect && onScrollTo(firstRect.x, firstRect.y)}
                >
                  <div class="flex items-center gap-2 mb-1">
                    <SelIcon
                      size={12}
                      strokeWidth={1.5}
                      color={selResolved ? 'var(--ds-gray-700)' : op.color}
                      aria-hidden="true"
                    />
                    <span class="text-meta text-(--ds-gray-900) font-medium flex-1">
                      {op.suggestion ? 'Text edit' : 'Selection'}
                    </span>
                    <DeviceBadge device={op.device} />
                    {selResolved && <StatusBadge status="resolved" />}
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
                      class="text-meta text-(--ds-gray-900) m-0 mt-1 line-clamp-1"
                      style={{ textDecoration: selResolved ? 'line-through' : 'none', opacity: selResolved ? 0.5 : 1 }}
                    >
                      {op.comment}
                    </p>
                  )}
                </button>
                <div class="flex items-center gap-3 px-4 pb-2.5">
                  <button
                    type="button"
                    onClick={() => firstRect && onScrollTo(firstRect.x, firstRect.y)}
                    class={cn(geist.bareBtn, geist.bareBtnQuiet)}
                  >
                    Go to
                  </button>
                  <button
                    type="button"
                    onClick={() => setOpStatus(op.id, selResolved ? 'open' : 'resolved')}
                    class={cn(geist.bareBtn, geist.bareBtnQuiet)}
                  >
                    {selResolved ? 'Reopen' : 'Resolve'}
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
              onClick={() => onScrollTo(op.x, op.y)}
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
  const visible = showAnnotationPanel.value;
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
    <DockedPanel visible={showAnnotationPanel.value} width={DOCKED_ANNOTATION_WIDTH}>
      <AnnotationPanelBody {...props} />
    </DockedPanel>
  );
}
