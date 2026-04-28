import { buildMarkdownExport, defaultExportFilename, downloadMarkdown } from '@ext/lib/export-text';
import { glass } from '@ext/lib/glass';
import {
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
import type { CommentOp, CommentStatus, DeviceMode, DrawOp, SelectionOp, TextOp } from '@ext/lib/types';
import { clsx } from 'clsx';
import {
  Check,
  ClipboardCopy,
  Download,
  MessageSquare,
  Monitor,
  Smartphone,
  Tablet,
  TextSelect,
  Type,
  X,
} from 'lucide-preact';
import { useRef, useState } from 'preact/hooks';

interface BodyProps {
  onScrollTo: (x: number, y: number) => void;
  getExportData?: () => { ops: DrawOp[]; url?: string; pages?: { url: string | null; ops: DrawOp[] }[] };
}

type AnnotationItem =
  | { kind: 'comment'; op: CommentOp; replyCount: number }
  | { kind: 'text'; op: TextOp }
  | { kind: 'selection'; op: SelectionOp };

const STATUS_COLORS: Record<CommentStatus, string> = {
  open: '#3b82f6',
  in_progress: '#f59e0b',
  resolved: '#22c55e',
};
const STATUS_ACTIONS: Record<CommentStatus, string> = {
  open: 'Mark in progress',
  in_progress: 'Resolve',
  resolved: 'Reopen',
};

function StatusBadge({ status }: { status: CommentStatus }) {
  return (
    <span
      class="text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-md"
      style={{ color: STATUS_COLORS[status], background: `${STATUS_COLORS[status]}20` }}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

const DEVICE_ICONS = { desktop: Monitor, tablet: Tablet, mobile: Smartphone } as const;
const DEVICE_LABELS: Record<DeviceMode, string> = { desktop: 'Desktop', tablet: 'Tablet', mobile: 'Mobile' };

function DeviceBadge({ device }: { device?: DeviceMode }) {
  if (!device || device === 'desktop') return null;
  const Icon = DEVICE_ICONS[device];
  return (
    <span class="inline-flex items-center gap-0.5 text-[9px] text-ml-glass-fg/30 font-medium">
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
  return <span class="text-[9px] text-ml-glass-fg/20 mt-1 block">{parts.join(' · ')}</span>;
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
    <div class="border-b border-ml-glass-fg/[0.06]">
      {/* Root comment header — click to expand */}
      <div
        class={clsx(
          'px-4 py-3 cursor-pointer transition-colors duration-100 hover:bg-ml-glass-accent/[0.04]',
          expanded && 'bg-ml-glass-accent/[0.03]',
        )}
        onClick={() => setExpanded(!expanded)}
      >
        <div class="flex items-center gap-2 mb-1.5">
          <div
            class="w-5 h-5 rounded-full text-white text-[9px] font-bold grid place-items-center shrink-0"
            style={{ background: status === 'resolved' ? '#6b7280' : op.color }}
          >
            {status === 'resolved' ? <Check size={11} strokeWidth={3} aria-hidden="true" /> : op.num}
          </div>
          <span class="text-[12px] text-ml-glass-fg/80 font-semibold flex-1 truncate">{op.author || 'Anonymous'}</span>
          <DeviceBadge device={op.device} />
          <StatusBadge status={status} />
          <span class="text-[11px] text-ml-glass-fg/55 tabular-nums">{timeAgo(op.ts)}</span>
        </div>
        <p
          class={clsx('text-[13px] text-ml-glass-fg/85 leading-relaxed m-0', !expanded && 'line-clamp-2')}
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
            <span class="text-[11px] text-ml-glass-fg/55 flex items-center gap-1 font-medium">
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
            class="text-[11px] font-medium text-ml-glass-fg/55 hover:text-[oklch(0.65_0.15_300)] bg-transparent border-none cursor-pointer p-0 transition-colors"
          >
            Go to
          </button>
          <button
            type="button"
            onClick={cycleStatus}
            class="text-[11px] font-medium text-ml-glass-fg/55 hover:text-ml-glass-fg bg-transparent border-none cursor-pointer p-0 transition-colors"
          >
            {STATUS_ACTIONS[status]}
          </button>
        </div>
      </div>

      {expanded && (
        <div class="bg-ml-glass-accent/[0.02]">
          {replies.length > 0 && (
            <div class="px-4 pb-1">
              {replies.map((reply) => (
                <div key={reply.id} class="flex gap-2 py-2 border-t border-ml-glass-fg/[0.05] first:border-t-0">
                  <div
                    class="w-4 h-4 rounded-full text-white text-[7px] font-bold grid place-items-center shrink-0 mt-0.5"
                    style={{ background: reply.color }}
                  >
                    {(reply.author || '?').charAt(0).toUpperCase()}
                  </div>
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2">
                      <span class="text-[11.5px] text-ml-glass-fg/80 font-semibold truncate">
                        {reply.author || 'Anonymous'}
                      </span>
                      <span class="text-[10.5px] text-ml-glass-fg/50 tabular-nums">{timeAgo(reply.ts)}</span>
                    </div>
                    <p
                      class="text-[12.5px] text-ml-glass-fg/80 leading-relaxed m-0 mt-0.5"
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
                <div
                  class="w-4 h-4 rounded-full text-white text-[7px] font-bold grid place-items-center shrink-0 mt-1.5"
                  style={{ background: color.value }}
                >
                  {localUser.name.charAt(0).toUpperCase()}
                </div>
                <div class="flex-1">
                  <textarea
                    name="reply"
                    ref={replyRef}
                    placeholder="Write a reply..."
                    rows={1}
                    class={clsx(
                      'w-full bg-ml-glass-accent/[0.06] border border-ml-glass-fg/[0.1] rounded-lg px-3 py-2',
                      'text-ml-glass-fg/80 text-[12px] leading-relaxed',
                      'resize-none outline-none min-h-8 max-h-[100px]',
                      'focus:border-ml-glass-fg/[0.2] focus:bg-ml-glass-accent/[0.08]',
                      'placeholder:text-ml-glass-fg/45',
                      glass.font,
                    )}
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
                      class="text-[11px] font-medium text-ml-glass-fg/60 hover:text-ml-glass-fg bg-transparent border-none cursor-pointer px-2 py-1 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={submitReply}
                      class="text-[11px] font-semibold px-3 py-1.5 rounded-lg cursor-pointer border-none text-white
                             bg-linear-to-b from-[oklch(0.68_0.15_300)] to-[oklch(0.58_0.15_300)]
                             shadow-[inset_0_1px_0_oklch(1_0_0/0.15),0_1px_3px_oklch(0_0_0/0.2)]
                             hover:from-[oklch(0.72_0.15_300)] hover:to-[oklch(0.62_0.15_300)]
                             active:scale-[0.94] transition-[box-shadow,transform] duration-150"
                    >
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
                class="w-full text-left px-3 py-2 rounded-lg border border-ml-glass-fg/10 bg-ml-glass-fg/3
                       text-[12px] text-ml-glass-fg/55 cursor-text hover:border-ml-glass-fg/20 hover:bg-ml-glass-fg/6 hover:text-ml-glass-fg/75 transition-colors"
              >
                Reply...
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const FILTER_OPTIONS: { value: CommentStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  ...Object.entries(STATUS_LABELS).map(([value, label]) => ({ value: value as CommentStatus, label })),
];

function AnnotationPanelBody({ onScrollTo, getExportData }: BodyProps) {
  const buildExport = () => {
    const data = getExportData?.() ?? { ops: operations.value };
    return buildMarkdownExport(data.ops, { url: data.url, pages: data.pages });
  };
  const handleCopy = () => copyText(buildExport(), 'Markdown copied!');
  const handleDownload = () => {
    const md = buildExport();
    const data = getExportData?.() ?? { ops: operations.value };
    downloadMarkdown(md, defaultExportFilename(data.url));
    toast('Markdown exported!', 'success');
  };

  const allOps = operations.value;
  const filter = commentFilter.value;

  const items: AnnotationItem[] = [];
  const statusCounts: Record<CommentStatus, number> = { open: 0, in_progress: 0, resolved: 0 };
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
      items.push({ kind: 'text', op: op as TextOp });
      textCount++;
    } else if (op.tool === 'selection') {
      items.push({ kind: 'selection', op: op as SelectionOp });
      selectionCount++;
    }
  }
  const itemY = (item: AnnotationItem) => (item.kind === 'selection' ? (item.op.rects[0]?.y ?? 0) : item.op.y);
  items.sort((a, b) => itemY(a) - itemY(b));

  return (
    <>
      {/* Header */}
      <div class="px-4 py-3 border-b border-ml-glass-fg/[0.1] shrink-0">
        <div class="flex items-center justify-between">
          <div>
            <h2 class="text-[15px] font-semibold text-ml-glass-fg m-0 tracking-[-0.01em]">Comments</h2>
            <span class="text-[12px] text-ml-glass-fg/60">
              {rootComments.value.length} thread{rootComments.value.length !== 1 ? 's' : ''}
              {statusCounts.resolved > 0 && <span class="text-green-500/80"> · {statusCounts.resolved} resolved</span>}
              {textCount > 0 && ` · ${textCount} text`}
              {selectionCount > 0 && ` · ${selectionCount} selection`}
            </span>
          </div>
          <div class="flex items-center gap-0.5">
            <button
              type="button"
              onClick={handleCopy}
              title="Copy comments + selections as Markdown"
              class="w-8 h-8 rounded-xl grid place-items-center cursor-pointer
                     bg-transparent border-none text-ml-glass-fg/65 hover:text-ml-glass-fg
                     hover:bg-ml-glass-fg/8 active:bg-ml-glass-fg/12 active:scale-[0.94]
                     transition-[color,background-color,transform] duration-150"
            >
              <ClipboardCopy size={15} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={handleDownload}
              title="Download Markdown (.md)"
              class="w-8 h-8 rounded-xl grid place-items-center cursor-pointer
                     bg-transparent border-none text-ml-glass-fg/65 hover:text-ml-glass-fg
                     hover:bg-ml-glass-fg/8 active:bg-ml-glass-fg/12 active:scale-[0.94]
                     transition-[color,background-color,transform] duration-150"
            >
              <Download size={15} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => (showAnnotationPanel.value = false)}
              title="Close panel"
              class="w-8 h-8 rounded-xl grid place-items-center cursor-pointer
                     bg-transparent border-none text-ml-glass-fg/65 hover:text-ml-glass-fg
                     hover:bg-ml-glass-fg/8 active:bg-ml-glass-fg/12 active:scale-[0.94]
                     transition-[color,background-color,transform] duration-150"
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        </div>
        {/* Filter tabs */}
        <div class="flex gap-1 mt-3">
          {FILTER_OPTIONS.map((f) => {
            const count = f.value === 'all' ? rootComments.value.length : statusCounts[f.value];
            return (
              <button
                key={f.value}
                type="button"
                onClick={() => (commentFilter.value = f.value)}
                class={clsx(
                  'text-[11.5px] font-medium px-2.5 py-1 rounded-lg border-none cursor-pointer transition-[color,background-color] duration-150',
                  filter === f.value
                    ? 'bg-ml-glass-fg/12 text-ml-glass-fg'
                    : 'bg-transparent text-ml-glass-fg/55 hover:text-ml-glass-fg hover:bg-ml-glass-fg/6',
                )}
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
            <MessageSquare size={28} strokeWidth={1.5} class="text-ml-glass-fg/30" aria-hidden="true" />
            <span class="text-[14px] font-medium text-ml-glass-fg/75">No comments yet</span>
            <span class="text-[12px] text-ml-glass-fg/45 leading-snug">Use the comment tool (C) to add one</span>
          </div>
        )}

        {items.map((item) => {
          if (item.kind === 'comment') {
            return <CommentThread key={item.op.id} op={item.op} onScrollTo={onScrollTo} />;
          }

          if (item.kind === 'selection') {
            const { op } = item;
            const firstRect = op.rects[0];
            const selResolved = op.status === 'resolved';
            return (
              <div key={op.id} class="border-b border-ml-glass-fg/[0.06]">
                <button
                  type="button"
                  class="w-full text-left px-4 py-3
                         bg-transparent cursor-pointer transition-colors duration-100
                         hover:bg-ml-glass-accent/[0.04]"
                  onClick={() => firstRect && onScrollTo(firstRect.x, firstRect.y)}
                >
                  <div class="flex items-center gap-2 mb-1">
                    <TextSelect size={12} color={selResolved ? '#6b7280' : op.color} aria-hidden="true" />
                    <span class="text-[11px] text-ml-glass-fg/40 font-medium flex-1">Selection</span>
                    <DeviceBadge device={op.device} />
                    {selResolved && <StatusBadge status="resolved" />}
                  </div>
                  <p
                    class="text-[12px] text-ml-glass-fg/50 m-0 line-clamp-2 leading-relaxed italic"
                    style={{ textDecoration: selResolved ? 'line-through' : 'none', opacity: selResolved ? 0.5 : 1 }}
                  >
                    "{op.text}"
                  </p>
                  {op.comment && (
                    <p
                      class="text-[11px] text-ml-glass-fg/35 m-0 mt-1 line-clamp-1"
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
                    class="text-[10px] text-ml-glass-fg/25 hover:text-[oklch(0.65_0.15_300)] bg-transparent border-none cursor-pointer p-0 transition-colors"
                  >
                    Go to
                  </button>
                  <button
                    type="button"
                    onClick={() => setOpStatus(op.id, selResolved ? 'open' : 'resolved')}
                    class="text-[10px] text-ml-glass-fg/25 hover:text-ml-glass-fg/60 bg-transparent border-none cursor-pointer p-0 transition-colors"
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
              class="w-full text-left px-4 py-3 border-b border-ml-glass-fg/[0.06]
                     bg-transparent cursor-pointer transition-colors duration-100
                     hover:bg-ml-glass-accent/[0.04]"
              onClick={() => onScrollTo(op.x, op.y)}
            >
              <div class="flex items-center gap-2 mb-1">
                <Type size={12} color={op.color} aria-hidden="true" />
                <span class="text-[11px] text-ml-glass-fg/40 font-medium flex-1">Text</span>
                <DeviceBadge device={op.device} />
              </div>
              <p class="text-[12px] m-0 line-clamp-2 leading-relaxed" style={{ color: op.color }}>
                {op.text}
              </p>
            </button>
          );
        })}
      </div>
    </>
  );
}

const PANEL_BASE = clsx(glass.surface, 'flex flex-col overflow-hidden');
const PANEL_TRANSITION = 'transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]';

export function AnnotationPanel(props: BodyProps) {
  const visible = showAnnotationPanel.value;
  return (
    <div
      class={clsx(
        'absolute top-3 right-3 bottom-3 w-[340px] z-40',
        PANEL_TRANSITION,
        PANEL_BASE,
        visible ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-4 pointer-events-none',
      )}
    >
      <AnnotationPanelBody {...props} />
    </div>
  );
}

export function DockedAnnotationPanel(props: BodyProps) {
  const visible = showAnnotationPanel.value;
  return (
    <div
      class={clsx(
        'shrink-0 my-3 ml-3 rounded-2xl',
        PANEL_TRANSITION,
        PANEL_BASE,
        visible ? 'w-[340px] opacity-100' : 'w-0 opacity-0 !ml-0 !p-0 !border-0',
      )}
    >
      <AnnotationPanelBody {...props} />
    </div>
  );
}
