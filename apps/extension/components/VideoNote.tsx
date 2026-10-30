import { Menu } from '@base-ui/react/menu';
import { cn, MAX_VIDEO_SECONDS } from '@marklayer/types';
import { useSignal } from '@preact/signals';
import { Loader2, Monitor, Square, Video, X } from 'lucide-preact';
import { track } from '../lib/analytics';
import { geist } from '../lib/geist';
import { glass } from '../lib/glass';
import { portalContainer } from '../lib/portal';
import { type OpenedStream, type RecorderSlot, useRecorder } from '../lib/recorder';
import { toast } from '../lib/state';
import { clock } from './MediaNote';
import { Tooltip } from './Tooltip';
import { AUDIO_MIME_CANDIDATES } from './VoiceNote';

/** H.264 in MP4 where the browser records it (Safari, recent Chrome), else VP9/VP8 in WebM. */
const MIME_CANDIDATES = [
  'video/mp4;codecs=avc1,mp4a',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];

export type VideoSource = 'camera' | 'screen';

/** Absent on mobile browsers, which then get the camera alone. */
export const canRecordScreen = (): boolean =>
  typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getDisplayMedia === 'function';

/** A dismissed screen picker or permission prompt is the user's choice, not a fault to report. */
const isDismissal = (err: unknown): boolean => err instanceof DOMException && err.name === 'NotAllowedError';

/** The tracks to record; a screen's own track ends the recording when the user stops sharing. */
async function openStream(source: VideoSource): Promise<OpenedStream | null> {
  if (source === 'camera') {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: true,
      });
      return { stream };
    } catch {
      toast('Camera unavailable');
      return null;
    }
  }
  let display: MediaStream;
  try {
    display = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 15 } }, audio: false });
  } catch (err) {
    if (!isDismissal(err)) toast('Screen recording unavailable');
    return null;
  }
  // Narration is optional: a denied mic still records the screen.
  const mic = await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => null);
  const [screen] = display.getVideoTracks();
  return {
    stream: new MediaStream([...display.getVideoTracks(), ...(mic?.getAudioTracks() ?? [])]),
    ended: screen,
  };
}

interface VideoNoteOptions {
  /** Uploads with `kind=video`; the plain attachment upload would store the clip as audio. */
  upload: (file: File | Blob) => Promise<string | null>;
  /** The clip's transcript, from the audio track recorded beside it; null when the model was unavailable. */
  transcribe?: (clip: { id: string; audio: Blob }) => Promise<string | null>;
  /** Called with the transcript once it lands, so the composer can put it in the text box. */
  onText?: (text: string) => void;
  slot?: RecorderSlot;
}

/** One composer's clip, from the camera or a shared screen, ending in an upload id and, if it had sound, a transcript. */
export function useVideoNote({ upload, transcribe, onText, slot }: VideoNoteOptions) {
  const source = useSignal<VideoSource>('camera');
  const recorder = useRecorder({
    kind: 'video',
    slot,
    mimeTypes: MIME_CANDIDATES,
    maxSeconds: MAX_VIDEO_SECONDS,
    bitrates: { videoBitsPerSecond: 1_000_000, audioBitsPerSecond: 64_000 },
    upload,
    // 64kbps over MAX_VIDEO_SECONDS stays well inside MAX_VOICE_BYTES, the cap the server holds it to.
    audioTrack: transcribe ? { mimeTypes: AUDIO_MIME_CANDIDATES, bitsPerSecond: 64_000 } : undefined,
    onUploaded: async ({ id, audio }) => {
      track('video_note_recorded', {
        seconds: recorder.elapsed.peek(),
        source: source.value,
        has_audio: Boolean(audio),
      });
      // A silent screen recording has nothing to transcribe, and nothing to apologise for.
      if (!audio || !transcribe) return;
      const text = await transcribe({ id, audio });
      if (text) onText?.(text);
      else toast('No transcript. The video is still attached');
    },
  });
  return {
    ...recorder,
    source,
    record: (from: VideoSource) => {
      source.value = from;
      track('video_note_started', { source: from });
      return recorder.start(() => openStream(from));
    },
  };
}

export type VideoNote = ReturnType<typeof useVideoNote>;

const itemCls = cn(
  'flex items-center gap-2 px-2.5 py-1.5',
  'text-meta font-medium leading-none',
  glass.menuItem,
  glass.menuItemHighlight,
);

/**
 * Camera control for a composer's action row, a menu of camera or screen where
 * the browser can share one; becomes stop-and-clock while recording.
 */
export function VideoButton({ video, label }: { video: VideoNote; label?: boolean }) {
  const status = video.status.value;
  // The clock and the labelled stop live on the preview; here the control just reads as on.
  if (status === 'recording')
    return (
      <button
        type="button"
        onClick={video.stop}
        aria-label={label ? undefined : 'Stop recording'}
        aria-pressed="true"
        class={cn(geist.ctlXs, geist.ctlOn, label && geist.ctlLabel)}
      >
        <Video size={14} strokeWidth={1.75} aria-hidden="true" />
        {label && 'Video'}
        <Tooltip text="Stop recording" />
      </button>
    );
  const pending = status === 'starting' || status === 'working';
  const busy = video.blocked.value || pending || video.id.value !== null;
  const trigger = {
    disabled: busy,
    'aria-label': label ? undefined : 'Record a video note',
    className: cn(
      geist.ctlXs,
      geist.ctlIdle,
      label && geist.ctlLabel,
      'disabled:opacity-40 disabled:pointer-events-none',
    ),
    children: (
      <>
        {pending ? (
          <Loader2 size={14} class="animate-spin" aria-hidden="true" />
        ) : (
          <Video size={14} strokeWidth={1.75} aria-hidden="true" />
        )}
        {label && 'Video'}
        <Tooltip text={canRecordScreen() ? 'Record your camera or screen' : 'Record a video note'} />
      </>
    ),
  };

  if (!canRecordScreen()) return <button type="button" onClick={() => void video.record('camera')} {...trigger} />;

  return (
    <Menu.Root>
      <Menu.Trigger {...trigger} />
      <Menu.Portal container={portalContainer.value ?? undefined}>
        <Menu.Positioner
          side="bottom"
          align="start"
          sideOffset={4}
          collisionPadding={6}
          className="z-2147483647 outline-none"
        >
          <Menu.Popup className={cn('min-w-40', glass.menuPopup, geist.surfaceSmall, glass.font)}>
            <Menu.Item className={itemCls} onClick={() => void video.record('camera')}>
              <Video size={14} strokeWidth={1.75} aria-hidden="true" />
              Record camera
            </Menu.Item>
            <Menu.Item className={itemCls} onClick={() => void video.record('screen')}>
              <Monitor size={14} strokeWidth={1.75} aria-hidden="true" />
              Record screen
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

/** Dark chrome laid over footage; solid rather than blurred, so it reads on any frame. */
const overlayChip = 'inline-flex items-center gap-1.5 h-6 px-2 rounded-sm bg-black/65 text-white text-meta font-medium';

/** What is being recorded, live. The camera is mirrored like any selfie view (the take is not);
 *  a screen is letterboxed, since its edges are usually the point. */
export function VideoLive({ video }: { video: VideoNote }) {
  const stream = video.live.value;
  if (!stream) return null;
  const camera = video.source.value === 'camera';
  return (
    <div class="relative mt-2 aspect-video w-full overflow-hidden rounded-md bg-black">
      <video
        ref={(el) => {
          if (el && el.srcObject !== stream) el.srcObject = stream;
        }}
        autoPlay
        muted
        playsInline
        aria-label={camera ? 'Camera preview' : 'Screen preview'}
        class={cn('h-full w-full', camera ? 'object-cover -scale-x-100' : 'object-contain')}
      />
      <div class={cn(overlayChip, 'absolute top-2 left-2 tabular-nums pointer-events-none')}>
        <span class="size-1.5 rounded-full bg-(--ds-red-700)" aria-hidden="true" />
        {clock(video.elapsed.value)}
        <span class="text-white/60">/ {clock(MAX_VIDEO_SECONDS)}</span>
      </div>
      <button
        type="button"
        onClick={video.stop}
        class="absolute bottom-2 left-1/2 -translate-x-1/2 inline-flex items-center gap-1.5 h-7 px-3
               rounded-md border-none bg-white text-black text-meta font-medium cursor-pointer outline-none
               transition-[background-color] duration-150 ease-out hover:bg-white/85
               focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2
               focus-visible:outline-white"
      >
        <Square size={9} fill="currentColor" aria-hidden="true" />
        Stop recording
      </button>
    </div>
  );
}

/**
 * The finished take, playing from the local blob so it is watchable the moment
 * recording stops rather than after the upload.
 */
export function VideoDraft({ video, resolveUrl }: { video: VideoNote; resolveUrl: (id: string) => string }) {
  const id = video.id.value;
  const saving = video.status.value === 'working';
  const src = video.clip.value ?? (id ? resolveUrl(id) : null);
  if (!src || (!id && !saving)) return null;
  return (
    <div class="relative mt-2">
      {/* biome-ignore lint/a11y/useMediaCaption: the reviewer's own take, before it is posted */}
      <video
        controls
        playsInline
        preload="metadata"
        src={src}
        aria-label="Video note"
        class="block aspect-video w-full rounded-md bg-black object-contain"
      />
      {saving ? (
        <div class={cn(overlayChip, 'absolute top-2 left-2 pointer-events-none')}>
          <Loader2 size={12} class="animate-spin" aria-hidden="true" />
          Saving
        </div>
      ) : (
        <button
          type="button"
          onClick={video.clear}
          aria-label="Remove video"
          class={cn(
            overlayChip,
            'absolute top-2 right-2 w-6 justify-center px-0 border-none cursor-pointer outline-none',
            'transition-[background-color] duration-150 ease-out hover:bg-black/85',
            'focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-white',
          )}
        >
          <X size={12} strokeWidth={2.25} aria-hidden="true" />
          <Tooltip text="Remove video" />
        </button>
      )}
    </div>
  );
}
