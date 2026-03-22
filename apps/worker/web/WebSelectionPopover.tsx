import { glass } from '@ext/lib/glass';
import { color, lineWidth, localUser } from '@ext/lib/state';
import type { SelectionOp, SelectionRect } from '@ext/lib/types';
import { clsx } from 'clsx';
import { nanoid } from 'nanoid';
import { useEffect, useRef } from 'preact/hooks';
import { pushDeviceOp } from './signals';

interface Props {
  text: string;
  rects: SelectionRect[];
  screenX: number;
  screenY: number;
  onClose: () => void;
}

export function WebSelectionPopover({ text, rects, screenX, screenY, onClose }: Props) {
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    taRef.current?.focus();
  }, []);

  const commit = (save: boolean) => {
    const comment = taRef.current?.value.trim();
    if (save && rects.length > 0) {
      pushDeviceOp({
        id: nanoid(),
        tool: 'selection' as const,
        text,
        rects,
        comment: comment || undefined,
        color: color.value,
        lineWidth: lineWidth.value,
        ts: Date.now(),
        author: localUser.name,
      } as SelectionOp);
    }
    window.getSelection()?.removeAllRanges();
    onClose();
  };

  const left = Math.min(screenX + 16, innerWidth - 300);
  const top = screenY + 24 > innerHeight - 200 ? Math.max(4, screenY - 200) : screenY + 16;

  return (
    <div
      class={clsx('fixed z-[2147483647]', glass.surface, glass.font, 'overflow-hidden w-[290px]')}
      style={{ left: Math.max(4, left), top }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Selected text preview */}
      <div class="px-4 pt-3.5 pb-2">
        <span class="text-[10px] text-ml-glass-fg/30 font-medium uppercase tracking-wider">Selected text</span>
        <p class="text-[12px] text-ml-glass-fg/50 m-0 mt-1 italic line-clamp-3 leading-relaxed">"{text}"</p>
      </div>

      <div class={clsx(glass.divider, 'mx-3.5')} />

      <div class="p-3.5">
        <textarea
          name="comment"
          ref={taRef}
          placeholder="Add a comment (optional)…"
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
            'w-full bg-ml-glass-accent/[0.04] border border-ml-glass-fg/[0.08] rounded-xl px-3.5 py-2.5',
            'text-ml-glass-fg/90 text-[13px] leading-relaxed',
            'resize-none outline-none min-h-10 max-h-[140px]',
            'caret-[oklch(0.65_0.15_300)]',
            'transition-all duration-150',
            'focus:border-[oklch(0.65_0.15_300/0.35)]',
            'focus:shadow-[0_0_0_3px_oklch(0.65_0.15_300/0.06),inset_0_0.5px_0_oklch(1_0_0/0.04)]',
            'focus:bg-ml-glass-accent/[0.06]',
            'placeholder:text-ml-glass-fg/18',
            glass.font,
          )}
          style={{ fieldSizing: 'content', boxSizing: 'border-box' } as Record<string, string>}
        />
      </div>

      <div class={clsx(glass.divider, 'mx-3.5')} />

      <div class="flex items-center justify-between px-4 py-2.5">
        <div class="flex items-center gap-2">
          <kbd
            class="text-[10px] text-ml-glass-fg/25 bg-ml-glass-accent/[0.05] border border-ml-glass-fg/[0.07]
                      rounded-md px-1.5 py-0.5 font-mono leading-none"
          >
            Esc
          </kbd>
          <span class="text-[10px] text-ml-glass-fg/20">skip comment</span>
        </div>
        <button
          type="button"
          onClick={() => commit(true)}
          class="px-4 py-1.5 text-[12px] font-semibold rounded-[10px] border-none cursor-pointer
                 bg-gradient-to-b from-[oklch(0.68_0.15_300)] to-[oklch(0.58_0.15_300)]
                 text-white
                 shadow-[inset_0_1px_0_oklch(1_0_0/0.15),0_1px_3px_oklch(0_0_0/0.2)]
                 transition-all duration-150
                 hover:from-[oklch(0.72_0.15_300)] hover:to-[oklch(0.62_0.15_300)]
                 hover:shadow-[inset_0_1px_0_oklch(1_0_0/0.2),0_2px_16px_oklch(0.65_0.15_300/0.2)]
                 active:scale-[0.96]"
        >
          Save ↵
        </button>
      </div>
    </div>
  );
}
