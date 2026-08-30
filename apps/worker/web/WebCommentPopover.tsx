import { CancelButton } from '@ext/components/CancelButton';
import { PriorityPicker } from '@ext/components/PriorityPicker';
import { submitBtn, textareaCls } from '@ext/lib/buttons';
import { geist } from '@ext/lib/geist';
import { glass } from '@ext/lib/glass';
import { useEdgeClamp } from '@ext/lib/popover';
import { color, commentCounter, getCommentMeta, lineWidth, signedBy } from '@ext/lib/state';
import { type CommentPriority, cn } from '@marklayer/types';
import { useSignal } from '@preact/signals';
import { nanoid } from 'nanoid';
import { useEffect, useRef } from 'preact/hooks';
import { frameViewport, pickFrameTarget } from './iframeOverlay';
import { pushDeviceOp } from './signals';

interface Props {
  x: number;
  y: number;
  scale: number;
  scrollY: number;
  /** Absent on the landing-page demo, which annotates the host page directly. */
  frameRef?: { current: HTMLIFrameElement | null };
  onClose: () => void;
}

export function WebCommentPopover({ x, y, scale: s, scrollY, frameRef, onClose }: Props) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const num = commentCounter.value + 1;
  const priority = useSignal<CommentPriority | undefined>(undefined);

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
        ...signedBy(),
        status: 'open',
        priority: priority.value,
        meta: getCommentMeta(),
        target: pickFrameTarget({ frame: frameRef?.current ?? null, x, y }),
        captureViewport: frameViewport(frameRef?.current ?? null),
      });
    }
    onClose();
  };

  // Position in viewport coords — convert document-space (x,y) through CSS scale
  const vx = x * s;
  const vy = (y - scrollY) * s;
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
