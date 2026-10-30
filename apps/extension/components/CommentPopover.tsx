import { type CaptureViewport, type CommentPriority, cn, type TargetElement } from '@marklayer/types';
import { useSignal } from '@preact/signals';
import { nanoid } from 'nanoid';
import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { track } from '../lib/analytics';
import { submitBtn, textareaBareCls } from '../lib/buttons';
import { geist } from '../lib/geist';
import { glass } from '../lib/glass';
import { useEdgeClamp } from '../lib/popover';
import type { RecorderKind } from '../lib/recorder';
import { color, commentCounter, getCommentMeta, lineWidth, patchOp, signedBy } from '../lib/state';
import type { CommentOp } from '../lib/types';
import { AttachButton, AttachmentThumbs, useAttachments } from './AttachmentPicker';
import { BatchSwitch } from './BatchSwitch';
import { ModalSheet } from './BottomSheet';
import { DictateButton } from './DictateButton';
import { MentionTextarea, useMentions } from './MentionTextarea';
import { PriorityPicker } from './PriorityPicker';
import { Tooltip } from './Tooltip';
import { useVideoNote, VideoButton, VideoDraft, VideoLive } from './VideoNote';
import { useVoiceNote, VoiceButton, VoiceDraft } from './VoiceNote';

interface DraftProps {
  /** Point the comment is pinned to, in the annotated page's document space. */
  at: { x: number; y: number };
  /** Bind the point to the element under it so the pin survives a reflow. */
  capture: () => { target?: TargetElement; captureViewport: CaptureViewport };
  push: (op: CommentOp) => void;
  onClose: () => void;
  /** Omitted where uploads shouldn't be offered — the marketing page's live demo, which
   *  stays text-only rather than opening an anonymous upload endpoint to public traffic. */
  media?: {
    upload: (file: File | Blob) => Promise<string | null>;
    resolveUrl: (id: string) => string;
    /** A mic button; the audio rides `upload`. */
    voice?: {
      transcribe: (id: string) => Promise<string | null>;
      constraint?: () => MediaTrackConstraints;
    };
    /** A camera/screen recorder. The extension omits it: a content script records
     *  under the host site's permissions and dies on navigation. */
    video?: {
      upload: (file: File | Blob) => Promise<string | null>;
      /** Transcribes a clip from the audio track recorded beside it. */
      transcribe?: (clip: { id: string; audio: Blob }) => Promise<string | null>;
    };
    /** The upload id of a screenshot taken around the pin, already in flight when the composer opens. */
    snapshot?: Promise<string | null>;
  };
}

const CARD_WIDTH = 360;

const noUpload = async (): Promise<null> => null;

type Draft = ReturnType<typeof useCommentDraft>;

/** The comment being written, independent of the surface it is written on. */
function useCommentDraft({ at, capture, push, onClose, media }: DraftProps) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  /** Mirrors the uncontrolled field so Post and dictation can react to what is typed. */
  const text = useSignal('');
  const num = commentCounter.value + 1;
  const priority = useSignal<CommentPriority | undefined>(undefined);
  const { mentionProps, mentions } = useMentions();
  const picker = useAttachments({ upload: media?.upload ?? noUpload, pending: media?.snapshot });
  const slot = useSignal<RecorderKind | null>(null);
  // A transcript is a draft: it lands in the box to be edited, after anything already typed.
  const onText = (heard: string) => {
    const ta = taRef.current;
    if (!ta || !heard) return;
    ta.value = ta.value.trim() ? `${ta.value.trim()} ${heard}` : heard;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.focus();
  };
  const voice = useVoiceNote({
    slot,
    upload: media?.upload ?? noUpload,
    transcribe: media?.voice?.transcribe ?? noUpload,
    constraint: media?.voice?.constraint,
    onText,
  });
  const video = useVideoNote({
    slot,
    upload: media?.video?.upload ?? noUpload,
    transcribe: media?.video?.transcribe,
    onText,
  });
  const recording = slot.value !== null;
  const postable = text.value.trim() !== '' || picker.picked > 0 || voice.id.value !== null || video.id.value !== null;
  /** Post was pressed while an upload was still landing; the comment goes up the moment it does. */
  const posting = useSignal(false);

  const commit = async (save: boolean) => {
    // Once Post is pressed the comment is on its way; a stray Escape must not drop it.
    if (posting.value) return;
    const txt = taRef.current?.value.trim();
    if (save && (txt || picker.picked || voice.id.value || video.id.value)) {
      if (recording) return;
      posting.value = picker.uploading && !picker.capturing;
      const attachments = await picker.settled();
      const id = nanoid();
      const mentioned = mentions();
      track('comment_submitted', {
        chars: txt?.length ?? 0,
        has_attachment: attachments.length > 0,
        has_voice: voice.id.value !== null,
        has_video: video.id.value !== null,
        has_priority: priority.value !== undefined,
        mentions: mentioned?.length ?? 0,
      });
      // The screenshot lands after the comment: a Post held for a capture felt broken.
      picker.late().then((shot) => {
        if (shot) patchOp({ opId: id, patch: { attachments: [...attachments, shot] } });
      });
      push({
        id,
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
        mentions: mentioned,
        attachments: attachments.length ? attachments : undefined,
        voice: voice.id.value ?? undefined,
        video: video.id.value ?? undefined,
        meta: getCommentMeta(),
        ...capture(),
      });
    }
    onClose();
  };

  return {
    taRef,
    text,
    num,
    priority,
    mentionProps,
    picker,
    media,
    voice,
    video,
    recording,
    postable,
    posting,
    commit,
  };
}

/** The field, with the pin's number leading the text like an avatar, so no header is needed. */
function ComposerField({ draft }: { draft: Draft }) {
  const { taRef, text, num, mentionProps, picker, media, voice, video, commit } = draft;
  return (
    <div class="flex items-start gap-2.5 px-3 pt-3">
      <div
        class="mt-px size-5 rounded-full text-white text-mini font-semibold tabular-nums grid place-items-center shrink-0"
        style={{ background: color.value }}
        aria-hidden="true"
      >
        {num}
      </div>
      <div class="min-w-0 flex-1">
        <MentionTextarea
          name="comment"
          aria-label={`Comment ${num}`}
          taRef={taRef}
          {...mentionProps}
          placeholder="Leave a comment…"
          rows={1}
          onInput={(e) => {
            text.value = e.currentTarget.value;
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              commit(true);
            }
          }}
          class={cn(textareaBareCls, 'block w-full min-h-[22px] max-h-60 p-0 resize-none', glass.font)}
          style={{ fieldSizing: 'content' }}
          onPaste={media ? (e) => picker.onPaste(e) : undefined}
        />
        {media && <AttachmentThumbs attachments={picker} resolveUrl={media.resolveUrl} class="mt-2" />}
        {media?.voice && <VoiceDraft voice={voice} resolveUrl={media.resolveUrl} />}
        {media?.video && (
          <>
            <VideoLive video={video} />
            <VideoDraft video={video} resolveUrl={media.resolveUrl} />
          </>
        )}
      </div>
    </div>
  );
}

/** The row under the field. Each surface composes it: tools on the left, then whatever it puts on the right. */
function ComposerRow({ children }: { children: ComponentChildren }) {
  return <div class="flex flex-wrap items-center gap-y-1 gap-x-0.5 px-2 pt-2 pb-2">{children}</div>;
}

/** Bare marks with tooltips, so the row never wraps into a second line. */
function ComposerTools({ draft }: { draft: Draft }) {
  const { taRef, priority, picker, media, voice, video } = draft;
  return (
    <>
      {media && <AttachButton attachments={picker} />}
      {media?.voice && <VoiceButton voice={voice} />}
      {media?.video && <VideoButton video={video} />}
      <PriorityPicker bare value={priority.value} onChange={(p) => (priority.value = p)} class="ml-1" />
      <BatchSwitch />
      <DictateButton field={taRef} />
    </>
  );
}

function ComposerCancel({ draft }: { draft: Draft }) {
  return (
    <button
      type="button"
      onClick={() => {
        track('comment_cancelled', { had_text: draft.text.value.trim() !== '' });
        draft.commit(false);
      }}
      class={cn(geist.ctlSm, geist.ctlIdle, 'mr-1 w-auto px-2 text-ui font-medium')}
    >
      Cancel
      <Tooltip text="Esc" />
    </button>
  );
}

/** `children` is what the button says: the surface with a keyboard adds the Enter glyph. */
function ComposerSubmit({
  draft,
  class: cls,
  children,
}: {
  draft: Draft;
  class?: string;
  children?: ComponentChildren;
}) {
  const { postable, posting, recording, commit } = draft;
  return (
    <button
      type="button"
      onClick={() => commit(true)}
      disabled={!postable || posting.value || recording}
      class={cn(
        submitBtn,
        'h-7 px-2.5',
        'disabled:pointer-events-none disabled:bg-(--ds-gray-alpha-200) disabled:text-(--ds-gray-700)',
        cls,
      )}
    >
      {posting.value ? 'Posting…' : children}
    </button>
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

  const { ref: panelRef, top } = useEdgeClamp({ top: anchorAt.y + 16 });

  useEffect(() => {
    draft.taRef.current?.focus();
    // A press anywhere else discards the draft, as it does on every other popover. Base UI
    // portals (priority menu, mention list) sit outside the panel, so a press on one is kept.
    const onDown = (e: PointerEvent) => {
      const path = e.composedPath();
      if (panelRef.current && path.includes(panelRef.current)) return;
      if (path.some((n) => n instanceof HTMLElement && n.matches('[role="menu"],[role="listbox"],[role="dialog"]')))
        return;
      draft.commit(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, []);

  const left = Math.min(anchorAt.x + 16, innerWidth - CARD_WIDTH - 4);

  return (
    <div
      class={cn(
        'fixed z-2147483647 pointer-events-auto',
        'animate-[fadeInDown_180ms_cubic-bezier(0.16,1,0.3,1)]',
        geist.surface,
        glass.font,
        'overflow-hidden',
      )}
      ref={panelRef}
      style={{ left: Math.max(4, left), top, width: CARD_WIDTH }}
      role="dialog"
      aria-label="New comment"
      onClick={(e) => e.stopPropagation()}
      // Escape cancels from anywhere in the panel, not just the field: after a click on
      // the toolbar, focus sits on a button. The mention list stops its own Escape.
      onKeyDown={(e) => {
        if (e.key !== 'Escape' || e.defaultPrevented) return;
        e.preventDefault();
        draft.commit(false);
      }}
    >
      <ComposerField draft={draft} />
      <ComposerRow>
        <ComposerTools draft={draft} />
        <div class="ml-auto flex items-center">
          <ComposerCancel draft={draft} />
          <ComposerSubmit draft={draft}>
            Post
            <span class="text-ui leading-none opacity-60" aria-hidden="true">
              ↵
            </span>
          </ComposerSubmit>
        </div>
      </ComposerRow>
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
      <ComposerField draft={draft} />
      <ComposerRow>
        <ComposerTools draft={draft} />
        <ComposerSubmit draft={draft} class="ml-auto">
          Post
        </ComposerSubmit>
      </ComposerRow>
    </ModalSheet>
  );
}
