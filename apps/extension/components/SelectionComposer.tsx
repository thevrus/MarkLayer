import {
  type CaptureViewport,
  type CommentPriority,
  normalizeSuggestion,
  type TargetElement,
} from '@marklayer/types/ops';
import { cn } from '@marklayer/ui/cn';
import { nanoid } from 'nanoid';
import type { ComponentChildren } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { track } from '../lib/analytics';
import { submitBtn, textareaCls } from '../lib/buttons';
import { geist } from '../lib/geist';
import { glass } from '../lib/glass';
import { signedBy } from '../lib/identity';
import { useEdgeClamp, useSelectionDismiss } from '../lib/popover';
import { color, lineWidth } from '../lib/prefs';
import type { SelectionOp, SelectionRect } from '../lib/types';
import { CancelButton } from './CancelButton';
import { MentionTextarea, useMentions } from './MentionTextarea';
import { PriorityPicker } from './PriorityPicker';
import { SelectionEdit } from './SelectionEdit';

/** The note on a fresh selection, shared by the extension and the viewer. */
export function SelectionComposer({
  text,
  rects,
  target,
  auto,
  suggestion: initial,
  doc,
  anchor,
  captureViewport,
  push,
  onClose,
  class: className,
  fieldClass,
  fieldName,
  children,
}: {
  text: string;
  rects: SelectionRect[];
  target?: TargetElement;
  /** Opened by the selection alone rather than by arming the selection tool. */
  auto: boolean;
  /** Pre-filled replacement, set when the text was edited in place. */
  suggestion?: string;
  /** Document holding the watched selection — the proxied page's frame, in the viewer. */
  doc?: Document | null;
  /** The selection's end in viewport coords, read each render: on a host page that moves with its scroll. */
  anchor: () => { x: number; y: number };
  /** Read at save, not at open: the extension records the window as it is then. */
  captureViewport: () => CaptureViewport | undefined;
  push: (op: SelectionOp) => void;
  onClose: () => void;
  class?: string;
  fieldClass: string;
  fieldName?: string;
  /** Sits ahead of Cancel in the footer. */
  children?: ComponentChildren;
}) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [priority, setPriority] = useState<CommentPriority | undefined>(undefined);
  const [suggestion, setSuggestion] = useState<string | null>(initial ?? null);
  const { mentionProps, mentions } = useMentions();

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
        mentions: mentions(),
        color: color.value,
        lineWidth: lineWidth.value,
        ts: Date.now(),
        ...signedBy(),
        target,
        captureViewport: captureViewport(),
      };
      push(op);
      track('selection_committed', {
        auto,
        has_note: Boolean(comment),
        has_suggestion: Boolean(op.suggestion),
        has_priority: Boolean(priority),
        mentions: op.mentions?.length ?? 0,
        chars: text.length,
      });
    } else {
      track('selection_cancelled', { auto, has_suggestion: suggestion !== null });
    }
    window.getSelection()?.removeAllRanges();
    onClose();
  };

  const { panelProps } = useSelectionDismiss({ auto, doc, focusRef: taRef, onDismiss: () => commit(false) });

  const { x, y } = anchor();
  const left = Math.min(x + 16, innerWidth - 300);
  const { ref: panelRef, top } = useEdgeClamp({ top: y + 16 });

  return (
    <div
      class={cn(
        'fixed z-2147483647',
        className,
        'animate-[fadeInDown_180ms_cubic-bezier(0.16,1,0.3,1)]',
        geist.surface,
        glass.font,
        'overflow-hidden w-[290px]',
      )}
      ref={panelRef}
      style={{ left: Math.max(4, left), top }}
      onClick={(e) => e.stopPropagation()}
      {...panelProps}
    >
      <SelectionEdit text={text} suggestion={suggestion} onChange={setSuggestion} onSubmit={() => commit(true)} />

      <div class={cn(geist.divider, 'mx-3.5')} />

      <div class="p-3.5">
        <MentionTextarea
          name={fieldName}
          taRef={taRef}
          {...mentionProps}
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
          class={cn(textareaCls, 'w-full min-h-10', fieldClass, glass.font)}
          style={{ fieldSizing: 'content', boxSizing: 'border-box' }}
        />
        <PriorityPicker value={priority} onChange={setPriority} class="mt-1.5 -ml-1.5" />
      </div>

      <div class={cn(geist.divider, 'mx-3.5')} />

      <div class="flex items-center justify-between px-4 py-2.5">
        {children}
        <CancelButton onClick={() => commit(false)} />
        <button type="button" onClick={() => commit(true)} class={submitBtn}>
          Save ↵
        </button>
      </div>
    </div>
  );
}
