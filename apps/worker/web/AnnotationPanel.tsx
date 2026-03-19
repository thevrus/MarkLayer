import { glass } from '@ext/lib/glass';
import {
  color,
  getReplies,
  localUser,
  operations,
  pushReply,
  resolveComment,
  rootComments,
  showAnnotationPanel,
} from '@ext/lib/state';
import { timeAgo } from '@ext/lib/time';
import type { CommentOp, TextOp } from '@ext/lib/types';
import { clsx } from 'clsx';
import { useRef, useState } from 'preact/hooks';

interface Props {
  onScrollTo: (x: number, y: number) => void;
}

type AnnotationItem = { kind: 'comment'; op: CommentOp; replyCount: number } | { kind: 'text'; op: TextOp };

function CommentThread({ op, onScrollTo }: { op: CommentOp; onScrollTo: (x: number, y: number) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [replying, setReplying] = useState(false);
  const replyRef = useRef<HTMLTextAreaElement>(null);
  const replies = getReplies(op.id);

  const submitReply = () => {
    const txt = replyRef.current?.value.trim();
    if (!txt) return;
    pushReply(op, txt);
    if (replyRef.current) replyRef.current.value = '';
    setReplying(false);
  };

  return (
    <div class="border-b border-white/[0.06]">
      {/* Root comment header — click to expand */}
      <div
        class={clsx(
          'px-4 py-3 cursor-pointer transition-colors duration-100 hover:bg-white/[0.04]',
          expanded && 'bg-white/[0.03]',
        )}
        onClick={() => setExpanded(!expanded)}
      >
        <div class="flex items-center gap-2 mb-1.5">
          <div
            class="w-5 h-5 rounded-full text-white text-[9px] font-bold grid place-items-center shrink-0"
            style={{ background: op.resolved ? '#6b7280' : op.color }}
          >
            {op.resolved ? '✓' : op.num}
          </div>
          <span class="text-[11px] text-white/50 font-medium flex-1 truncate">{op.author || 'Anonymous'}</span>
          <span class="text-[10px] text-white/25">{timeAgo(op.ts)}</span>
        </div>
        <p
          class={clsx('text-[12.5px] text-white/70 leading-relaxed m-0', !expanded && 'line-clamp-2')}
          style={{ textDecoration: op.resolved ? 'line-through' : 'none', opacity: op.resolved ? 0.5 : 1 }}
        >
          {op.text}
        </p>
        <div class="flex items-center gap-3 mt-2">
          {replies.length > 0 && (
            <span class="text-[10px] text-white/30 flex items-center gap-1">
              <svg
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              {replies.length}
            </span>
          )}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onScrollTo(op.x, op.y);
            }}
            class="text-[10px] text-white/25 hover:text-blue-400 bg-transparent border-none cursor-pointer p-0 transition-colors"
          >
            Go to
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              resolveComment(op.id);
            }}
            class={clsx(
              'text-[10px] bg-transparent border-none cursor-pointer p-0 transition-colors',
              op.resolved ? 'text-white/25 hover:text-white/60' : 'text-white/25 hover:text-green-400',
            )}
          >
            {op.resolved ? 'Reopen' : 'Resolve'}
          </button>
        </div>
      </div>

      {/* Expanded: reply thread + input */}
      {expanded && (
        <div class="bg-white/[0.02]">
          {/* Replies */}
          {replies.length > 0 && (
            <div class="px-4 pb-1">
              {replies.map((reply) => (
                <div key={reply.id} class="flex gap-2 py-2 border-t border-white/[0.05] first:border-t-0">
                  <div
                    class="w-4 h-4 rounded-full text-white text-[7px] font-bold grid place-items-center shrink-0 mt-0.5"
                    style={{ background: reply.color }}
                  >
                    {(reply.author || '?').charAt(0).toUpperCase()}
                  </div>
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2">
                      <span class="text-[10px] text-white/50 font-medium truncate">{reply.author || 'Anonymous'}</span>
                      <span class="text-[9px] text-white/20">{timeAgo(reply.ts)}</span>
                    </div>
                    <p
                      class="text-[12px] text-white/60 leading-relaxed m-0 mt-0.5"
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
                    ref={replyRef}
                    placeholder="Write a reply..."
                    rows={1}
                    class={clsx(
                      'w-full bg-white/[0.06] border border-white/[0.1] rounded-lg px-3 py-2',
                      'text-white/80 text-[12px] leading-relaxed',
                      'resize-none outline-none min-h-8 max-h-[100px]',
                      'focus:border-white/[0.2] focus:bg-white/[0.08]',
                      'placeholder:text-white/25',
                      glass.font,
                    )}
                    style={{ fieldSizing: 'content', boxSizing: 'border-box' } as Record<string, string>}
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
                      class="text-[10px] text-white/30 hover:text-white/60 bg-transparent border-none cursor-pointer px-2 py-1"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={submitReply}
                      class="text-[10px] font-semibold px-3 py-1 rounded-lg cursor-pointer border-none
                             bg-white/[0.14] text-white hover:bg-white/[0.2] active:bg-white/[0.08] active:scale-[0.94] transition-all duration-150 shadow-[inset_0_0.5px_0_oklch(1_0_0/0.08)]"
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
                class="w-full text-left px-3 py-2 rounded-lg border border-white/[0.08] bg-white/[0.04]
                       text-[11px] text-white/25 cursor-text hover:border-white/[0.15] hover:bg-white/[0.06] transition-colors"
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

export function AnnotationPanel({ onScrollTo }: Props) {
  if (!showAnnotationPanel.value) return null;

  const allOps = operations.value;

  const items: AnnotationItem[] = [];
  for (const c of rootComments.value) {
    items.push({ kind: 'comment', op: c, replyCount: getReplies(c.id).length });
  }
  for (const op of allOps) {
    if (op.tool === 'text') {
      items.push({ kind: 'text', op: op as TextOp });
    }
  }
  items.sort((a, b) => a.op.y - b.op.y);

  const resolvedCount = rootComments.value.filter((c) => c.resolved).length;
  const totalComments = rootComments.value.length;
  const textCount = items.filter((i) => i.kind === 'text').length;

  return (
    <div class={clsx('absolute top-3 right-3 bottom-3 w-[340px] z-40', glass.surface, 'flex flex-col overflow-hidden')}>
      {/* Header */}
      <div class="flex items-center justify-between px-4 py-3 border-b border-white/[0.1] shrink-0">
        <div>
          <h2 class="text-[13px] font-semibold text-white/80 m-0">Comments</h2>
          <span class="text-[11px] text-white/30">
            {totalComments} thread{totalComments !== 1 ? 's' : ''}
            {resolvedCount > 0 && <span class="text-green-400/60"> · {resolvedCount} resolved</span>}
            {textCount > 0 && ` · ${textCount} text`}
          </span>
        </div>
        <button
          type="button"
          onClick={() => (showAnnotationPanel.value = false)}
          class="w-7 h-7 rounded-xl grid place-items-center cursor-pointer
                 bg-transparent border-none text-white/45 hover:text-white
                 hover:bg-white/[0.1] active:bg-white/[0.05] active:scale-[0.94] transition-all duration-150"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* List */}
      <div class="flex-1 overflow-y-auto">
        {items.length === 0 && (
          <div class="flex flex-col items-center justify-center h-40 gap-2">
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="text-white/10"
              aria-hidden="true"
            >
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            <span class="text-[13px] text-white/20">No comments yet</span>
            <span class="text-[11px] text-white/15">Use the comment tool (C) to add one</span>
          </div>
        )}

        {items.map((item) => {
          if (item.kind === 'comment') {
            return <CommentThread key={item.op.id} op={item.op} onScrollTo={onScrollTo} />;
          }

          const { op } = item;
          return (
            <button
              key={op.id}
              type="button"
              class="w-full text-left px-4 py-3 border-b border-white/[0.06]
                     bg-transparent cursor-pointer transition-colors duration-100
                     hover:bg-white/[0.04]"
              onClick={() => onScrollTo(op.x, op.y)}
            >
              <div class="flex items-center gap-2 mb-1">
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke={op.color}
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                >
                  <polyline points="4 7 4 4 20 4 20 7" />
                  <line x1="9" y1="20" x2="15" y2="20" />
                  <line x1="12" y1="4" x2="12" y2="20" />
                </svg>
                <span class="text-[11px] text-white/40 font-medium">Text</span>
              </div>
              <p class="text-[12px] m-0 line-clamp-2 leading-relaxed" style={{ color: op.color }}>
                {op.text}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
