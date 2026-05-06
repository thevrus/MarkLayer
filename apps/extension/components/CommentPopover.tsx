import { cn } from '@marklayer/types';
import { nanoid } from 'nanoid';
import { useEffect, useRef } from 'preact/hooks';
import { submitBtn, textareaCls } from '../lib/buttons';
import { glass } from '../lib/glass';
import { captureTarget } from '../lib/selector';
import { color, commentCounter, getCommentMeta, lineWidth, localUser, pushOp } from '../lib/state';

interface Props {
  x: number;
  y: number;
  el: Element | null;
  onClose: () => void;
}

export function CommentPopover({ x, y, el, onClose }: Props) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const num = commentCounter.value + 1;

  useEffect(() => {
    taRef.current?.focus();
  }, []);

  const commit = (save: boolean) => {
    const txt = taRef.current?.value.trim();
    if (save && txt) {
      pushOp({
        id: nanoid(),
        tool: 'comment' as const,
        num,
        text: txt,
        x,
        y,
        color: color.value,
        lineWidth: lineWidth.value,
        ts: Date.now(),
        author: localUser.name,
        status: 'open',
        meta: getCommentMeta(),
        target: el ? captureTarget(el) : undefined,
      });
    }
    onClose();
  };

  const vx = x - scrollX;
  const vy = y - scrollY;
  const left = Math.min(vx + 16, innerWidth - 300);
  const top = vy + 24 > innerHeight - 200 ? Math.max(4, vy - 200) : vy + 16;

  return (
    <div
      class={cn(
        'fixed z-2147483647',
        'animate-[fadeInDown_180ms_cubic-bezier(0.16,1,0.3,1)]',
        glass.surface,
        glass.font,
        'overflow-hidden w-[290px]',
      )}
      style={{ left: Math.max(4, left), top }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div class="flex items-center gap-2.5 px-4 pt-3.5 pb-2">
        <div
          class="w-6 h-6 rounded-full text-white text-[10px] font-bold grid place-items-center shrink-0
                 shadow-[inset_0_1px_0_oklch(1_0_0/0.15)]"
          style={{ background: color.value }}
        >
          {num}
        </div>
        <span class="text-[13px] text-ml-glass-fg font-semibold tracking-[-0.01em]">New comment</span>
      </div>

      <div class={cn(glass.divider, 'mx-3.5')} />

      {/* Input area */}
      <div class="p-3.5">
        <textarea
          ref={taRef}
          placeholder="Leave a comment…"
          rows={1}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              commit(true);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              commit(false);
            }
          }}
          class={cn(textareaCls, 'w-full min-h-10 max-h-[140px]', glass.font)}
          style={{ fieldSizing: 'content', boxSizing: 'border-box' }}
        />
      </div>

      <div class={cn(glass.divider, 'mx-3.5')} />

      {/* Footer */}
      <div class="flex items-center justify-between px-4 py-2.5">
        <div class="flex items-center gap-2">
          <kbd
            class="text-[10.5px] text-ml-glass-fg/75 bg-ml-glass-fg/8 border border-ml-glass-fg/15
                      rounded-md px-1.5 py-0.5 font-mono font-medium leading-none"
          >
            Esc
          </kbd>
          <span class="text-[11px] text-ml-glass-fg/55 font-medium">cancel</span>
        </div>
        <button type="button" onClick={() => commit(true)} class={submitBtn}>
          Post ↵
        </button>
      </div>
    </div>
  );
}
