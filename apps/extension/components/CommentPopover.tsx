import { type CommentPriority, cn } from '@marklayer/types';
import { useSignal } from '@preact/signals';
import { nanoid } from 'nanoid';
import { useEffect, useRef } from 'preact/hooks';
import { submitBtn, textareaCls } from '../lib/buttons';
import { geist } from '../lib/geist';
import { glass } from '../lib/glass';
import { useEdgeClamp } from '../lib/popover';
import { captureTarget } from '../lib/selector';
import { color, commentCounter, getCommentMeta, lineWidth, localUser, pushOp } from '../lib/state';
import { PriorityPicker } from './PriorityPicker';

interface Props {
  x: number;
  y: number;
  el: Element | null;
  onClose: () => void;
}

export function CommentPopover({ x, y, el, onClose }: Props) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const num = commentCounter.value + 1;
  const priority = useSignal<CommentPriority | undefined>(undefined);

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
        priority: priority.value,
        meta: getCommentMeta(),
        target: el ? captureTarget({ el, anchor: { x, y } }) : undefined,
        captureViewport: { width: window.innerWidth, height: window.innerHeight },
      });
    }
    onClose();
  };

  const vx = x - scrollX;
  const vy = y - scrollY;
  const left = Math.min(vx + 16, innerWidth - 300);
  const { ref: panelRef, top } = useEdgeClamp({ top: vy + 16 });

  return (
    <div
      class={cn(
        'fixed z-2147483647',
        'animate-[fadeInDown_180ms_cubic-bezier(0.16,1,0.3,1)]',
        geist.surface,
        glass.font,
        'overflow-hidden w-[290px]',
      )}
      ref={panelRef}
      style={{ left: Math.max(4, left), top }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div class="flex items-center gap-2.5 px-4 pt-3.5 pb-2">
        <div
          class="w-6 h-6 rounded-full text-white text-[12px] font-medium grid place-items-center shrink-0
                 shadow-[inset_0_1px_0_oklch(1_0_0/0.15)]"
          style={{ background: color.value }}
        >
          {num}
        </div>
        <span class="text-[13px] text-(--ds-gray-1000) font-semibold tracking-[-0.01em]">New comment</span>
      </div>

      <div class={cn(geist.divider, 'mx-3.5')} />

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
        <PriorityPicker value={priority.value} onChange={(p) => (priority.value = p)} class="mt-1.5 -ml-1.5" />
      </div>

      <div class={cn(geist.divider, 'mx-3.5')} />

      {/* Footer */}
      <div class="flex items-center justify-between px-4 py-2.5">
        {/* A real button, not a hint: it looked clickable, so it has to be. */}
        <button
          type="button"
          onClick={() => commit(false)}
          class={cn(geist.ctlSm, geist.ctlIdle, 'w-auto gap-1.5 px-2 text-[13px] font-medium')}
        >
          Cancel
          <kbd class={geist.kbd}>Esc</kbd>
        </button>
        <button type="button" onClick={() => commit(true)} class={submitBtn}>
          Post ↵
        </button>
      </div>
    </div>
  );
}
