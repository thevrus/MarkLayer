import { cn, MAX_VOICE_SECONDS } from '@marklayer/types';
import { useSignal } from '@preact/signals';
import { Loader2, Mic, Square, X } from 'lucide-preact';
import { useEffect, useRef } from 'preact/hooks';
import { geist } from '../lib/geist';
import { toast } from '../lib/state';

/** Opus in WebM where the browser has it, MP4 for Safari; the first one MediaRecorder admits to. */
const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/mp4'];

const clock = (seconds: number): string => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

interface VoiceNoteOptions {
  /** Same injected upload as the attachments' — the two apps reach `/f` through different origins. */
  upload: (file: File | Blob) => Promise<string | null>;
  /** The note's transcript; null when the model was unavailable. */
  transcribe: (id: string) => Promise<string | null>;
  /** Called with the transcript once it lands, so the composer can put it in the text box. */
  onText: (text: string) => void;
  /** The user's picked microphone, where the app lets them pick one. */
  constraint?: () => MediaTrackConstraints;
}

/** One composer's recording: idle, recording, then uploading and transcribing, ending in an upload id. */
export function useVoiceNote({ upload, transcribe, onText, constraint }: VoiceNoteOptions) {
  const status = useSignal<'idle' | 'recording' | 'working'>('idle');
  const id = useSignal<string | null>(null);
  const elapsed = useSignal(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const discard = useRef(false);

  const clearTimer = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  };

  const finish = async (blob: Blob) => {
    status.value = 'working';
    const uploaded = await upload(blob);
    if (!uploaded) {
      toast('Could not save the recording');
      status.value = 'idle';
      return;
    }
    id.value = uploaded;
    const text = await transcribe(uploaded);
    if (text) onText(text);
    else toast('No transcript. The audio is still attached');
    status.value = 'idle';
  };

  const start = async () => {
    const mimeType = MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type));
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: constraint?.() ?? true });
    } catch {
      toast('Microphone unavailable');
      return;
    }
    const chunks: Blob[] = [];
    const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    rec.ondataavailable = (e) => chunks.push(e.data);
    rec.onstop = () => {
      for (const track of stream.getTracks()) track.stop();
      clearTimer();
      recorder.current = null;
      if (discard.current) return;
      void finish(new Blob(chunks, { type: rec.mimeType }));
    };
    discard.current = false;
    recorder.current = rec;
    rec.start();
    const startedAt = Date.now();
    elapsed.value = 0;
    status.value = 'recording';
    timer.current = setInterval(() => {
      elapsed.value = Math.floor((Date.now() - startedAt) / 1000);
      if (elapsed.value >= MAX_VOICE_SECONDS) rec.stop();
    }, 250);
  };

  // Closing the composer mid-recording must release the mic, not leave the tab's indicator lit.
  useEffect(
    () => () => {
      discard.current = true;
      recorder.current?.stop();
      clearTimer();
    },
    [],
  );

  const toggle = () => {
    if (status.value === 'recording') recorder.current?.stop();
    else if (status.value === 'idle') void start();
  };

  return {
    status,
    id,
    elapsed,
    toggle,
    clear: () => {
      id.value = null;
    },
  };
}

export type VoiceNote = ReturnType<typeof useVoiceNote>;

/** Bare mic control for a composer's action row; becomes stop-and-clock while recording. */
export function VoiceButton({ voice }: { voice: VoiceNote }) {
  const recording = voice.status.value === 'recording';
  const working = voice.status.value === 'working';
  const label = recording ? 'Stop recording' : 'Record a voice note';
  return (
    <button
      type="button"
      disabled={working || voice.id.value !== null}
      onClick={voice.toggle}
      title={label}
      aria-label={label}
      class={cn(
        geist.ctlXs,
        recording ? geist.ctlOn : geist.ctlIdle,
        recording && 'w-auto gap-1 px-1.5 text-meta tabular-nums',
        'disabled:opacity-40 disabled:pointer-events-none',
      )}
    >
      {recording ? (
        <>
          <Square size={10} fill="currentColor" aria-hidden="true" />
          {clock(voice.elapsed.value)}
        </>
      ) : working ? (
        <Loader2 size={14} class="animate-spin" aria-hidden="true" />
      ) : (
        <Mic size={14} strokeWidth={1.75} aria-hidden="true" />
      )}
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

/** The recorded note as it sits in the composer, with a way to throw it away and record again. */
export function VoiceDraft({ voice, resolveUrl }: { voice: VoiceNote; resolveUrl: (id: string) => string }) {
  const id = voice.id.value;
  if (!id) return null;
  return (
    <div class="flex items-center gap-1.5">
      <div class="min-w-0 flex-1">
        <VoicePlayer id={id} resolveUrl={resolveUrl} />
      </div>
      <button
        type="button"
        onClick={voice.clear}
        title="Remove voice note"
        aria-label="Remove voice note"
        class={cn(geist.ctlXs, geist.ctlIdle, 'mt-1.5 shrink-0')}
      >
        <X size={12} strokeWidth={2} aria-hidden="true" />
      </button>
    </div>
  );
}
