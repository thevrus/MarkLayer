import { glass } from '@ext/lib/glass';
import { getReplies, pushReply, setOpStatus } from '@ext/lib/state';
import { timeAgo } from '@ext/lib/time';
import type { CommentOp } from '@ext/lib/types';
import { clsx } from 'clsx';
import { Check } from 'lucide-preact';
import { useRef, useState } from 'preact/hooks';

interface Props {
  op: CommentOp;
  scale: number;
  scrollY: number;
}

export function WebCommentPin({ op, scale: s, scrollY }: Props) {
  const left = op.x * s;
  const top = op.y * s - scrollY;
  const resolved = op.resolved;
  const replies = getReplies(op.id);
  const [showReply, setShowReply] = useState(false);
  const replyRef = useRef<HTMLTextAreaElement>(null);

  if (op.parentId)
    // Don't render reply comments as pins — they're shown inside the parent's card
    return null;

  const submitReply = () => {
    const txt = replyRef.current?.value.trim();
    if (!txt) return;
    pushReply(op, txt);
    setShowReply(false);
  };

  return (
    <div class={clsx('absolute pointer-events-auto cursor-pointer group/pin', glass.font)} style={{ left, top }}>
      <div class="relative -translate-x-1/2 -translate-y-1/2">
        {/* Pin dot */}
        <div
          class="w-7 h-7 rounded-full text-white text-[11px] font-semibold
                 grid place-items-center
                 shadow-[0_0_0_2.5px_oklch(0_0_0/0.2),0_2px_10px_oklch(0_0_0/0.35),inset_0_1px_0_oklch(1_0_0/0.2)]
                 transition-all duration-200 ease-out
                 group-hover/pin:scale-[1.15] group-hover/pin:shadow-[0_0_0_2.5px_oklch(1_0_0/0.12),0_4px_20px_oklch(0_0_0/0.45),inset_0_1px_0_oklch(1_0_0/0.25)]"
          style={{
            background: `linear-gradient(to bottom, color-mix(in oklch, ${op.color} 100%, white 20%), ${op.color})`,
          }}
        >
          {op.num}
          {resolved && (
            <div class="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-green-500 text-white text-[9px] font-bold grid place-items-center shadow-sm border border-ml-glass-fg/80">
              <Check size={9} strokeWidth={2.5} aria-hidden="true" />
            </div>
          )}
          {replies.length > 0 && !resolved && (
            <div class="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-white text-[8px] font-bold text-black/70 grid place-items-center shadow-sm">
              {replies.length}
            </div>
          )}
        </div>

        {/* Hover card */}
        <div
          class={clsx(
            'absolute top-0 left-[calc(100%+10px)]',
            'bg-[var(--ml-glass-bg-small)] border border-[var(--ml-glass-border)]',
            'shadow-[0_0_0_0.5px_oklch(0_0_0/0.5),0_6px_24px_oklch(0_0_0/0.35),0_16px_48px_oklch(0_0_0/0.25)]',
            'rounded-xl',
            'w-[300px]',
            'opacity-0 scale-90 translate-x-[-6px] pointer-events-none',
            'transition-all duration-200 ease-out',
            'group-hover/pin:opacity-100 group-hover/pin:scale-100 group-hover/pin:translate-x-0 group-hover/pin:pointer-events-auto',
            'max-h-[400px] overflow-y-auto',
          )}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Root comment */}
          <div style={{ padding: '12px 14px 8px' }} class="flex items-center gap-2.5">
            <div
              class="rounded-full text-white text-[9px] font-bold grid place-items-center shrink-0
                     shadow-[inset_0_1px_0_oklch(1_0_0/0.15)]"
              style={{ background: op.color, width: 20, height: 20 }}
            >
              {op.num}
            </div>
            <span class="text-[10px] text-ml-glass-fg/30 font-medium tracking-wide flex-1">
              {op.author || 'Anonymous'}
            </span>
            <span class="text-[10px] text-ml-glass-fg/20 font-medium">{timeAgo(op.ts)}</span>
          </div>

          <div style={{ padding: '4px 14px 10px' }}>
            <p
              style={{
                margin: 0,
                color: 'color-mix(in srgb, var(--color-ml-glass-fg) 75%, transparent)',
                fontSize: '12.5px',
                lineHeight: 1.55,
                wordBreak: 'break-word',
                whiteSpace: 'pre-wrap',
              }}
            >
              {op.text}
            </p>
          </div>

          {/* Replies */}
          {replies.length > 0 && (
            <div>
              <div
                style={{ margin: '0 12px', height: 1 }}
                class="bg-gradient-to-r from-transparent via-white/[0.07] to-transparent"
              />
              {replies.map((reply) => (
                <div key={reply.id} style={{ padding: '8px 14px' }} class="border-l-2 border-ml-glass-fg/[0.06] ml-3">
                  <div class="flex items-center gap-2 mb-1">
                    <div
                      class="w-4 h-4 rounded-full text-white text-[7px] font-bold grid place-items-center shrink-0"
                      style={{ background: reply.color }}
                    >
                      {(reply.author || '?').charAt(0).toUpperCase()}
                    </div>
                    <span class="text-[10px] text-ml-glass-fg/40 font-medium">{reply.author || 'Anonymous'}</span>
                    <span class="text-[9px] text-ml-glass-fg/20">{timeAgo(reply.ts)}</span>
                  </div>
                  <p
                    style={{
                      margin: 0,
                      color: 'color-mix(in srgb, var(--color-ml-glass-fg) 65%, transparent)',
                      fontSize: '12px',
                      lineHeight: 1.5,
                      wordBreak: 'break-word',
                      whiteSpace: 'pre-wrap',
                    }}
                  >
                    {reply.text}
                  </p>
                </div>
              ))}
            </div>
          )}

          {/* Divider */}
          <div
            style={{ margin: '0 12px', height: 1 }}
            class="bg-gradient-to-r from-transparent via-white/[0.07] to-transparent"
          />

          {/* Reply input */}
          {showReply ? (
            <div style={{ padding: '8px 12px 10px' }}>
              <textarea
                ref={replyRef}
                placeholder="Reply..."
                rows={1}
                class={clsx(
                  'w-full bg-ml-glass-accent/[0.04] border border-ml-glass-fg/[0.08] rounded-lg px-3 py-2',
                  'text-ml-glass-fg/90 text-[12px] leading-relaxed',
                  'resize-none outline-none min-h-8 max-h-[80px]',
                  'caret-[oklch(0.65_0.15_300)]',
                  'focus:border-[oklch(0.65_0.15_300/0.35)] focus:bg-ml-glass-accent/[0.06]',
                  'placeholder:text-ml-glass-fg/18',
                  glass.font,
                )}
                style={{ fieldSizing: 'content', boxSizing: 'border-box' } as Record<string, string>}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    submitReply();
                  } else if (e.key === 'Escape') {
                    setShowReply(false);
                  }
                }}
              />
              <div class="flex items-center justify-end gap-2 mt-1.5">
                <button
                  type="button"
                  onClick={() => setShowReply(false)}
                  class="text-[10px] text-ml-glass-fg/30 hover:text-ml-glass-fg/60 bg-transparent border-none cursor-pointer px-2 py-1"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={submitReply}
                  class="text-[10px] font-semibold px-3 py-1 rounded-md cursor-pointer border-none
                         bg-gradient-to-b from-[oklch(0.68_0.15_300)] to-[oklch(0.58_0.15_300)]
                         text-white shadow-[inset_0_1px_0_oklch(1_0_0/0.15)]
                         hover:from-[oklch(0.72_0.15_300)] hover:to-[oklch(0.62_0.15_300)]
                         active:scale-[0.96] transition-all duration-150"
                >
                  Reply
                </button>
              </div>
            </div>
          ) : (
            <div style={{ padding: '8px 14px 10px' }} class="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowReply(true);
                  setTimeout(() => replyRef.current?.focus(), 50);
                }}
                class="text-[11px] font-medium px-3 py-1.5 rounded-lg cursor-pointer
                       border border-ml-glass-fg/[0.08] bg-ml-glass-accent/[0.05]
                       text-ml-glass-fg/50 hover:text-ml-glass-fg/80 hover:bg-ml-glass-accent/[0.1]
                       transition-all duration-150"
              >
                Reply
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setOpStatus(op.id, resolved ? 'open' : 'resolved');
                }}
                class="text-[11px] font-medium px-3 py-1.5 rounded-lg cursor-pointer
                       border border-ml-glass-fg/[0.08] bg-ml-glass-accent/[0.05]
                       text-ml-glass-fg/50 hover:text-ml-glass-fg/80 hover:bg-ml-glass-accent/[0.1]
                       transition-all duration-150"
              >
                {resolved ? 'Reopen' : 'Resolve'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
