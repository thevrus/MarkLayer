import { glass } from '@ext/lib/glass';
import { color, commentCounter, getCommentMeta, lineWidth, localUser } from '@ext/lib/state';
import { clsx } from 'clsx';
import { nanoid } from 'nanoid';
import { useEffect, useRef } from 'preact/hooks';
import { pushDeviceOp } from './signals';

interface Props {
  x: number;
  y: number;
  scale: number;
  scrollY: number;
  onClose: () => void;
}

export function WebCommentPopover({ x, y, scale: s, scrollY, onClose }: Props) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const num = commentCounter.value + 1;

  useEffect(() => {
    taRef.current?.focus();
  }, []);

  const commit = (save: boolean) => {
    const txt = taRef.current?.value.trim();
    if (save && txt) {
      pushDeviceOp({
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
      });
    }
    onClose();
  };

  // Position in viewport coords — convert document-space (x,y) through CSS scale
  const vx = x * s;
  const vy = (y - scrollY) * s;
  const left = Math.min(vx + 16, innerWidth - 300);
  const top = vy + 24 > innerHeight - 200 ? Math.max(4, vy - 200) : vy + 16;

  return (
    <div
      class={clsx('fixed z-[2147483647]', glass.surface, glass.font, 'overflow-hidden w-[290px]')}
      style={{ left: Math.max(4, left), top }}
      onClick={(e) => e.stopPropagation()}
    >
      <div class="flex items-center gap-2.5 px-4 pt-3.5 pb-2">
        <div
          class="w-6 h-6 rounded-full text-white text-[10px] font-bold grid place-items-center shrink-0
                 shadow-[inset_0_1px_0_oklch(1_0_0/0.15)]"
          style={{ background: color.value }}
        >
          {num}
        </div>
        <span class="text-[13px] text-ml-glass-fg font-semibold tracking-[-0.01em] flex-1">New comment</span>
      </div>

      <div class={clsx(glass.divider, 'mx-3.5')} />

      <div class="p-3.5">
        <textarea
          name="comment"
          ref={taRef}
          placeholder="Leave a comment..."
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
          class={clsx(
            'w-full bg-ml-glass-fg/4 border border-ml-glass-fg/12 rounded-xl px-3.5 py-2.5',
            'text-ml-glass-fg text-[13.5px] leading-relaxed',
            'resize-none outline-none min-h-10 max-h-[140px]',
            'caret-[oklch(0.65_0.15_300)]',
            'transition-[border-color,background-color,box-shadow] duration-150',
            'focus:border-[oklch(0.65_0.15_300/0.5)]',
            'focus:shadow-[0_0_0_3px_oklch(0.65_0.15_300/0.12),inset_0_0.5px_0_oklch(1_0_0/0.04)]',
            'focus:bg-ml-glass-fg/6',
            'placeholder:text-ml-glass-fg/45',
            glass.font,
          )}
          style={{ fieldSizing: 'content', boxSizing: 'border-box' }}
        />
      </div>

      <div class={clsx(glass.divider, 'mx-3.5')} />

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
        <button
          type="button"
          onClick={() => commit(true)}
          class="px-4 py-1.5 text-[12px] font-semibold rounded-[10px] border-none cursor-pointer
                 bg-linear-to-b from-[oklch(0.68_0.15_300)] to-[oklch(0.58_0.15_300)]
                 text-white
                 shadow-[inset_0_1px_0_oklch(1_0_0/0.15),0_1px_3px_oklch(0_0_0/0.2)]
                 transition-[box-shadow,transform] duration-150
                 hover:from-[oklch(0.72_0.15_300)] hover:to-[oklch(0.62_0.15_300)]
                 hover:shadow-[inset_0_1px_0_oklch(1_0_0/0.2),0_2px_16px_oklch(0.65_0.15_300/0.2)]
                 active:scale-[0.96]"
        >
          Post
        </button>
      </div>
    </div>
  );
}
