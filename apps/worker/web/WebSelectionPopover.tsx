import { submitBtn, textareaCls } from '@ext/lib/buttons';
import { glass } from '@ext/lib/glass';
import { color, lineWidth, localUser } from '@ext/lib/state';
import type { SelectionOp, SelectionRect } from '@ext/lib/types';
import { cn } from '@marklayer/types';
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
      const op: SelectionOp = {
        id: nanoid(),
        tool: 'selection',
        text,
        rects,
        comment: comment || undefined,
        color: color.value,
        lineWidth: lineWidth.value,
        ts: Date.now(),
        author: localUser.name,
      };
      pushDeviceOp(op);
    }
    window.getSelection()?.removeAllRanges();
    onClose();
  };

  const left = Math.min(screenX + 16, innerWidth - 300);
  const top = screenY + 24 > innerHeight - 200 ? Math.max(4, screenY - 200) : screenY + 16;

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
      {/* Selected text preview */}
      <div class="px-4 pt-3.5 pb-2">
        <span class="text-[10.5px] text-ml-glass-fg/65 font-bold uppercase tracking-[0.08em]">Selected text</span>
        <p class="text-[12.5px] text-ml-glass-fg/80 m-0 mt-1 italic line-clamp-3 leading-relaxed">"{text}"</p>
      </div>

      <div class={cn(glass.divider, 'mx-3.5')} />

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
          class={cn(textareaCls, 'w-full min-h-10 max-h-[140px]', glass.font)}
          style={{ fieldSizing: 'content', boxSizing: 'border-box' }}
        />
      </div>

      <div class={cn(glass.divider, 'mx-3.5')} />

      <div class="flex items-center justify-between px-4 py-2.5">
        <div class="flex items-center gap-2">
          <kbd
            class="text-[10.5px] text-ml-glass-fg/75 bg-ml-glass-fg/8 border border-ml-glass-fg/15
                      rounded-md px-1.5 py-0.5 font-mono font-medium leading-none"
          >
            Esc
          </kbd>
          <span class="text-[11px] text-ml-glass-fg/55 font-medium">skip comment</span>
        </div>
        <button type="button" onClick={() => commit(true)} class={submitBtn}>
          Save ↵
        </button>
      </div>
    </div>
  );
}
