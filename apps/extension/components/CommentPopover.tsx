import { type CaptureViewport, type CommentPriority, cn, type TargetElement } from '@marklayer/types';
import { useSignal } from '@preact/signals';
import { nanoid } from 'nanoid';
import { useEffect, useRef } from 'preact/hooks';
import { submitBtn, textareaCls } from '../lib/buttons';
import { geist } from '../lib/geist';
import { glass } from '../lib/glass';
import { useEdgeClamp } from '../lib/popover';
import { color, commentCounter, getCommentMeta, lineWidth, signedBy } from '../lib/state';
import type { CommentOp } from '../lib/types';
import { CancelButton } from './CancelButton';
import { PriorityPicker } from './PriorityPicker';

interface Props {
  /** Point the comment is pinned to, in the annotated page's document space. */
  at: { x: number; y: number };
  /** The same point in host-viewport pixels — the extension and the web viewer
   *  reach it through different transforms (page scroll vs. iframe scroll and
   *  CSS scale), so the conversion is the caller's, and only the conversion. */
  anchorAt: { x: number; y: number };
  /** Bind the point to the element under it so the pin survives a reflow. */
  capture: () => { target?: TargetElement; captureViewport: CaptureViewport };
  push: (op: CommentOp) => void;
  onClose: () => void;
}

export function CommentPopover({ at, anchorAt, capture, push, onClose }: Props) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const num = commentCounter.value + 1;
  const priority = useSignal<CommentPriority | undefined>(undefined);

  useEffect(() => {
    taRef.current?.focus();
  }, []);

  const commit = (save: boolean) => {
    const txt = taRef.current?.value.trim();
    if (save && txt) {
      push({
        id: nanoid(),
        tool: 'comment' as const,
        num,
        text: txt,
        x: at.x,
        y: at.y,
        color: color.value,
        lineWidth: lineWidth.value,
        ts: Date.now(),
        ...signedBy(),
        status: 'open',
        priority: priority.value,
        meta: getCommentMeta(),
        ...capture(),
      });
    }
    onClose();
  };

  const left = Math.min(anchorAt.x + 16, innerWidth - 300);
  const { ref: panelRef, top } = useEdgeClamp({ top: anchorAt.y + 16 });

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
      <div class="flex items-center gap-2.5 px-4 pt-3.5 pb-2">
        <div
          class="w-6 h-6 rounded-full text-white text-meta font-medium grid place-items-center shrink-0
                 shadow-[inset_0_1px_0_oklch(1_0_0/0.15)]"
          style={{ background: color.value }}
        >
          {num}
        </div>
        <span class="text-ui text-(--ds-gray-1000) font-semibold tracking-ui flex-1">New comment</span>
      </div>

      <div class={cn(geist.divider, 'mx-3.5')} />

      <div class="p-3.5">
        <textarea
          name="comment"
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

      <div class="flex items-center justify-between px-4 py-2.5">
        <CancelButton onClick={() => commit(false)} />
        <button type="button" onClick={() => commit(true)} class={submitBtn}>
          Post ↵
        </button>
      </div>
    </div>
  );
}
