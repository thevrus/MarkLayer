import { PriorityPicker } from '@ext/components/PriorityPicker';
import { SelectionEdit } from '@ext/components/SelectionEdit';
import { submitBtn, textareaCls } from '@ext/lib/buttons';
import { geist } from '@ext/lib/geist';
import { glass } from '@ext/lib/glass';
import { useEdgeClamp } from '@ext/lib/popover';
import { color, lineWidth, localUser } from '@ext/lib/state';
import type { SelectionOp, SelectionRect } from '@ext/lib/types';
import {
  type CaptureViewport,
  type CommentPriority,
  cn,
  normalizeSuggestion,
  type TargetElement,
} from '@marklayer/types';
import { nanoid } from 'nanoid';
import { useEffect, useRef, useState } from 'preact/hooks';
import { pushDeviceOp } from './signals';

interface Props {
  text: string;
  rects: SelectionRect[];
  screenX: number;
  screenY: number;
  target?: TargetElement;
  captureViewport?: CaptureViewport;
  onClose: () => void;
}

export function WebSelectionPopover({ text, rects, screenX, screenY, target, captureViewport, onClose }: Props) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [priority, setPriority] = useState<CommentPriority | undefined>(undefined);
  const [suggestion, setSuggestion] = useState<string | null>(null);

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
        suggestion: normalizeSuggestion({ text, suggestion }),
        priority,
        color: color.value,
        lineWidth: lineWidth.value,
        ts: Date.now(),
        author: localUser.name,
        target,
        captureViewport,
      };
      pushDeviceOp(op);
    }
    window.getSelection()?.removeAllRanges();
    onClose();
  };

  const left = Math.min(screenX + 16, innerWidth - 300);
  const { ref: panelRef, top } = useEdgeClamp({ top: screenY + 16 });

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
      <SelectionEdit text={text} suggestion={suggestion} onChange={setSuggestion} onSubmit={() => commit(true)} />

      <div class={cn(geist.divider, 'mx-3.5')} />

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
        <PriorityPicker value={priority} onChange={setPriority} class="mt-1.5 -ml-1.5" />
      </div>

      <div class={cn(geist.divider, 'mx-3.5')} />

      <div class="flex items-center justify-between px-4 py-2.5">
        <div class="flex items-center gap-2">
          <kbd class={geist.kbd}>Esc</kbd>
          <span class="text-[12px] text-(--ds-gray-900) font-medium">skip comment</span>
        </div>
        <button type="button" onClick={() => commit(true)} class={submitBtn}>
          Save ↵
        </button>
      </div>
    </div>
  );
}
