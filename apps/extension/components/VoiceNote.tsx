import { cn, MAX_VOICE_SECONDS } from '@marklayer/types';
import { Loader2, Mic } from 'lucide-preact';
import { track } from '../lib/analytics';
import { geist } from '../lib/geist';
import { type OpenedStream, type RecorderSlot, useRecorder } from '../lib/recorder';
import { toast } from '../lib/state';
import { MediaDraft, RecorderStop } from './MediaNote';
import { Tooltip } from './Tooltip';

/** Opus in WebM where the browser has it, MP4 for Safari; the first one MediaRecorder admits to. */
export const AUDIO_MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/mp4'];

interface VoiceNoteOptions {
  /** Same injected upload as the attachments' — the two apps reach `/f` through different origins. */
  upload: (file: File | Blob) => Promise<string | null>;
  /** The note's transcript; null when the model was unavailable. */
  transcribe: (id: string) => Promise<string | null>;
  /** Called with the transcript once it lands, so the composer can put it in the text box. */
  onText: (text: string) => void;
  /** The user's picked microphone, where the app lets them pick one. */
  constraint?: () => MediaTrackConstraints;
  slot?: RecorderSlot;
}

/** One composer's voice note: a recording that ends in an upload id and a transcript in the text box. */
export function useVoiceNote({ upload, transcribe, onText, constraint, slot }: VoiceNoteOptions) {
  const recorder = useRecorder({
    kind: 'voice',
    slot,
    mimeTypes: AUDIO_MIME_CANDIDATES,
    maxSeconds: MAX_VOICE_SECONDS,
    upload,
    onUploaded: async ({ id }) => {
      const text = await transcribe(id);
      track('voice_note_recorded', { seconds: recorder.elapsed.peek(), transcribed: Boolean(text) });
      if (text) onText(text);
      else toast('No transcript. The audio is still attached');
    },
  });

  const openMic = async (): Promise<OpenedStream | null> => {
    try {
      return { stream: await navigator.mediaDevices.getUserMedia({ audio: constraint?.() ?? true }) };
    } catch {
      toast('Microphone unavailable');
      return null;
    }
  };

  return {
    ...recorder,
    toggle: () => {
      if (recorder.status.value === 'recording') recorder.stop();
      else {
        track('voice_note_started');
        void recorder.start(openMic);
      }
    },
  };
}

export type VoiceNote = ReturnType<typeof useVoiceNote>;

/** Bare mic control for a composer's action row; becomes stop-and-clock while recording. */
export function VoiceButton({ voice, label }: { voice: VoiceNote; label?: boolean }) {
  const status = voice.status.value;
  if (status === 'recording') return <RecorderStop recorder={voice} />;
  const pending = status === 'starting' || status === 'working';
  return (
    <button
      type="button"
      disabled={voice.blocked.value || pending || voice.id.value !== null}
      onClick={voice.toggle}
      aria-label={label ? undefined : 'Record a voice note'}
      class={cn(
        geist.ctlXs,
        geist.ctlIdle,
        label && geist.ctlLabel,
        'disabled:opacity-40 disabled:pointer-events-none',
      )}
    >
      {pending ? (
        <Loader2 size={14} class="animate-spin" aria-hidden="true" />
      ) : (
        <Mic size={14} strokeWidth={1.75} aria-hidden="true" />
      )}
      {label && 'Voice'}
      <Tooltip text="Record a voice note" />
    </button>
  );
}

/** A posted voice note: the browser's own player over the stored audio. */
export function VoicePlayer({ id, resolveUrl }: { id: string; resolveUrl: (id: string) => string }) {
  return (
    // The transcript is the comment's own text, right above the player.
    // biome-ignore lint/a11y/useMediaCaption: speech with its transcript beside it
    <audio
      controls
      preload="metadata"
      src={resolveUrl(id)}
      aria-label="Voice note"
      class="mt-1.5 h-8 w-full max-w-full"
    />
  );
}

export function VoiceDraft({ voice, resolveUrl }: { voice: VoiceNote; resolveUrl: (id: string) => string }) {
  const id = voice.id.value;
  if (!id) return null;
  return (
    <MediaDraft label="Remove voice note" onClear={voice.clear}>
      <VoicePlayer id={id} resolveUrl={resolveUrl} />
    </MediaDraft>
  );
}
