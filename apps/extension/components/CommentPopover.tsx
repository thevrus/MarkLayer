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
import { AttachmentRow, useAttachments } from './AttachmentPicker';
import { ModalSheet } from './BottomSheet';
import { CancelButton } from './CancelButton';
import { MentionTextarea, useMentions } from './MentionTextarea';
import { PriorityPicker } from './PriorityPicker';
import { useVoiceNote, VoiceButton, VoiceDraft } from './VoiceNote';

interface DraftProps {
  /** Point the comment is pinned to, in the annotated page's document space. */
  at: { x: number; y: number };
  /** Bind the point to the element under it so the pin survives a reflow. */
  capture: () => { target?: TargetElement; captureViewport: CaptureViewport };
  push: (op: CommentOp) => void;
  onClose: () => void;
  /** Omitted where screenshot attachments shouldn't be offered — the marketing
   *  page's live demo, which stays text-only rather than opening an anonymous
   *  upload endpoint to public traffic. */
  attachments?: {
    upload: (file: File | Blob) => Promise<string | null>;
    resolveUrl: (id: string) => string;
  };
  /** Offers a mic button that records a voice note into the comment. Needs `attachments`,
   *  since the audio rides the same upload; omitted wherever those are. */
  voice?: {
    transcribe: (id: string) => Promise<string | null>;
    constraint?: () => MediaTrackConstraints;
  };
}

type Draft = ReturnType<typeof useCommentDraft>;

/** The comment being written, independent of the surface it is written on. */
function useCommentDraft({ at, capture, push, onClose, attachments, voice: voiceConfig }: DraftProps) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const num = commentCounter.value + 1;
  const priority = useSignal<CommentPriority | undefined>(undefined);
  const { mentionProps, mentions } = useMentions();
  const picker = useAttachments(attachments?.upload ?? (async () => null));
  const voice = useVoiceNote({
    upload: attachments?.upload ?? (async () => null),
    transcribe: voiceConfig?.transcribe ?? (async () => null),
    constraint: voiceConfig?.constraint,
    // The transcript is a draft: it lands in the box to be edited, after anything already typed.
    onText: (text) => {
      const ta = taRef.current;
      if (!ta || !text) return;
      ta.value = ta.value.trim() ? `${ta.value.trim()} ${text}` : text;
      ta.focus();
    },
  });

  const commit = (save: boolean) => {
    const txt = taRef.current?.value.trim();
    if (save && (txt || voice.id.value)) {
      if (picker.uploading || voice.status.value !== 'idle') return;
      push({
        id: nanoid(),
        tool: 'comment' as const,
        num,
        text: txt ?? '',
        x: at.x,
        y: at.y,
        color: color.value,
        lineWidth: lineWidth.value,
        ts: Date.now(),
        ...signedBy(),
        status: 'open',
        priority: priority.value,
        mentions: mentions(),
        attachments: picker.ids.length ? picker.ids : undefined,
        voice: voice.id.value ?? undefined,
        meta: getCommentMeta(),
        ...capture(),
      });
    }
    onClose();
  };

  return { taRef, num, priority, mentionProps, picker, attachments, voice, voiceConfig, commit };
}

/** Header, field and actions: the same composer on either surface. `submit` is
 *  the button's label, which carries the Enter hint only where there is a keyboard. */
function ComposerBody({ draft, submit }: { draft: Draft; submit: string }) {
  const { taRef, num, priority, mentionProps, picker, attachments, voice, voiceConfig, commit } = draft;
  return (
    <>
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
        <MentionTextarea
          name="comment"
          taRef={taRef}
          {...mentionProps}
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
          class={cn(textareaCls, 'w-full min-h-10 max-h-100', glass.font)}
          style={{ fieldSizing: 'content', boxSizing: 'border-box' }}
          onPaste={attachments ? (e) => picker.onPaste(e) : undefined}
        />
        {attachments && <AttachmentRow attachments={picker} resolveUrl={attachments.resolveUrl} />}
        {attachments && voiceConfig && (
          <>
            <VoiceDraft voice={voice} resolveUrl={attachments.resolveUrl} />
            <div class="mt-1.5 flex items-center">
              <VoiceButton voice={voice} />
            </div>
          </>
        )}
        <PriorityPicker value={priority.value} onChange={(p) => (priority.value = p)} class="mt-1.5 -ml-1.5" />
      </div>

      <div class={cn(geist.divider, 'mx-3.5')} />

      <div class="flex items-center justify-between px-4 py-2.5">
        <CancelButton onClick={() => commit(false)} />
        <button
          type="button"
          onClick={() => commit(true)}
          disabled={picker.uploading || voice.status.value !== 'idle'}
          class={cn(submitBtn, 'disabled:pointer-events-none disabled:opacity-50')}
        >
          {submit}
        </button>
      </div>
    </>
  );
}

/** The composer floating beside the point it pins, on a screen with a pointer and a keyboard. */
export function CommentPopover({
  anchorAt,
  ...props
}: DraftProps & {
  /** The same point in host-viewport pixels — the extension and the web viewer
   *  reach it through different transforms (page scroll vs. iframe scroll and
   *  CSS scale), so the conversion is the caller's, and only the conversion. */
  anchorAt: { x: number; y: number };
}) {
  const draft = useCommentDraft(props);

  useEffect(() => {
    draft.taRef.current?.focus();
  }, []);

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
      <ComposerBody draft={draft} submit="Post ↵" />
    </div>
  );
}

/** The composer on a phone: it rises from the bottom edge, clear of the keyboard,
 *  rather than floating beside a pin it would cover. Dismissing it discards the draft. */
export function CommentSheet(props: DraftProps) {
  const draft = useCommentDraft(props);
  return (
    <ModalSheet
      open
      onOpenChange={(open) => !open && draft.commit(false)}
      label="New comment"
      initialFocus={draft.taRef}
    >
      <ComposerBody draft={draft} submit="Post" />
    </ModalSheet>
  );
}
