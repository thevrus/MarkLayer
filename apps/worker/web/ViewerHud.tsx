import { geist } from '@ext/lib/geist';
import { glass } from '@ext/lib/glass';
import { annotationPanelOpen, peers, uiHidden } from '@ext/lib/state';
import { cn } from '@marklayer/types';
import { Lock, Mic, MicOff, MonitorPlay, X } from 'lucide-preact';
import { lazy, Suspense } from 'preact/compat';
import { Logo } from './shared';
import { followingPeer, presenting, setPresenting } from './signals';
import {
  audioBlocked,
  expandedPeers,
  localVideoStream,
  peerConnQuality,
  peerVideoStreams,
  qualityRing,
  resumeBlockedAudio,
  videoActive,
  voiceActive,
  voiceLevel,
  voiceMuted,
  voiceSpeaking,
} from './voiceSignals';

const MediaBubble = lazy(() => import('./MediaBubble').then((m) => ({ default: m.MediaBubble })));

/**
 * One "Desktop only" screen for both ways of arriving at it. `cover` is the only
 * real difference: a phone never builds the viewer, so the screen *is* the page and
 * owns the h1; a narrowed desktop already mounted one, so the gate lays over it.
 */
function DesktopOnly({ cover }: { cover: boolean }) {
  const Heading = cover ? 'h2' : 'h1';
  return (
    <div
      class={cn(
        "flex flex-col items-center justify-center px-6 text-center bg-ml-bg font-['Geist',system-ui,sans-serif]",
        cover ? 'md:hidden fixed inset-0 z-2147483647' : 'min-h-screen',
      )}
    >
      <Logo size={48} />
      <Heading class="text-title font-semibold tracking-display text-ml-fg mt-6 mb-2">Desktop only</Heading>
      <p class="text-body text-ml-fg/60 max-w-[320px] leading-relaxed mb-8">
        Annotation tools require a desktop browser. Open this link on your computer to view and collaborate.
      </p>
      <a
        href="/"
        class="px-5 py-2.5 rounded-xl bg-ml-btn text-ml-btn-fg text-ui-lg font-semibold no-underline hover:bg-ml-btn-hover transition-colors"
      >
        Back to home
      </a>
    </div>
  );
}

/** A phone gets this instead of the viewer, never behind it. */
export const MobileOnlyPage = () => <DesktopOnly cover={false} />;

/** A desktop browser narrowed past the breakpoint — a CSS gate over a mounted viewer. */
export const NarrowViewportGate = () => <DesktopOnly cover />;

/** A guest is looking at somebody else's work — say so, and offer nothing to click. */
export function ViewOnlyBadge() {
  return (
    <div
      class={cn(
        'fixed bottom-5 left-1/2 -translate-x-1/2 z-2147483646 h-9 px-3 flex items-center gap-2',
        geist.surfaceSmall,
        glass.font,
      )}
    >
      <Lock size={14} strokeWidth={1.5} class="text-(--ds-gray-900)" aria-hidden="true" />
      <span class="text-ui text-(--ds-gray-1000) font-medium">View-only mode</span>
    </div>
  );
}

/** Raycast-style mic indicator. */
export function VoicePill() {
  const muted = voiceMuted.value;
  const level = voiceLevel.value;

  return (
    <div
      class={cn(
        'fixed z-2147483646 flex items-center gap-2 px-3 py-2 rounded-xl transition-[right] duration-200',
        // Clears the top bar, and takes its place when ⌘/ has hidden it.
        uiHidden.value ? 'top-4' : 'top-[60px]',
        annotationPanelOpen.value ? 'right-[364px]' : 'right-4',
        'bg-(--ds-background-100) border border-(--ds-gray-alpha-400) [box-shadow:var(--ds-shadow-tooltip)]',
        'animate-[fadeInDown_0.2s_ease-out]',
        'select-none',
      )}
    >
      <button
        type="button"
        onClick={() => (voiceMuted.value = !voiceMuted.value)}
        class={cn(
          'w-7 h-7 rounded-lg grid place-items-center border-none cursor-pointer transition-[color,background-color] duration-150',
          muted ? 'bg-(--ds-gray-alpha-100) text-(--ds-gray-900)' : 'bg-green-500/20 text-green-400',
        )}
        title={muted ? 'Unmute' : 'Mute'}
      >
        {muted ? <MicOff size={14} aria-hidden="true" /> : <Mic size={14} aria-hidden="true" />}
      </button>

      {/* Level bars */}
      <div class="flex items-end gap-[2px] h-3.5">
        {Array.from({ length: 4 }, (_, i) => {
          const threshold = i / 4;
          const active = !muted && level > threshold;
          return (
            <div
              key={i}
              class="w-[2.5px] rounded-full transition-[opacity,transform] duration-100 ease-out"
              style={{
                height: `${40 + ((i + 1) / 4) * 60}%`,
                background: 'var(--ds-gray-700)',
                opacity: active ? 0.5 : 0.1,
                transform: active ? `scaleY(${0.7 + level * 0.3})` : 'scaleY(0.5)',
              }}
            />
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => (voiceActive.value = false)}
        class="w-6 h-6 rounded-md grid place-items-center border-none cursor-pointer bg-transparent text-(--ds-gray-900) hover:text-(--ds-gray-1000) hover:bg-(--ds-gray-alpha-100) transition-[color,background-color] duration-150"
        title="Leave voice"
      >
        <X size={11} aria-hidden="true" />
      </button>
    </div>
  );
}

/**
 * Draggable self-view + expanded peer bubbles. One Suspense boundary for all of
 * them so the MediaBubble chunk loads at most once.
 */
export function VideoBubbles() {
  if (!localVideoStream.value && expandedPeers.value.size === 0) return null;
  return (
    <Suspense fallback={null}>
      {localVideoStream.value && videoActive.value && (
        <MediaBubble id="self" stream={localVideoStream.value} muted mirror defaultSize={72} />
      )}
      {Array.from(expandedPeers.value).map((peerId) => {
        const stream = peerVideoStreams.value.get(peerId);
        const peer = peers.value.get(peerId);
        if (!stream || !peer) return null;
        const ring = qualityRing(peerConnQuality.value.get(peerId), peer.color);
        return (
          <MediaBubble
            key={peerId}
            id={`peer-${peerId}`}
            stream={stream}
            defaultSize={140}
            label={peer.name}
            ringColor={ring}
            speaking={voiceSpeaking.value.has(peerId)}
            onClose={() => {
              const next = new Set(expandedPeers.value);
              next.delete(peerId);
              expandedPeers.value = next;
            }}
          />
        );
      })}
    </Suspense>
  );
}

/** Autoplay block — a single tap unblocks remote audio. */
export function AudioUnblockPrompt() {
  if (!audioBlocked.value) return null;
  return (
    <button
      type="button"
      onClick={resumeBlockedAudio}
      class={cn(
        'fixed top-16 left-1/2 -translate-x-1/2 z-2147483647 flex items-center gap-2 h-9 px-3',
        geist.surfaceSmall,
        'text-ui font-medium text-(--ds-gray-1000) cursor-pointer border-none',
        'animate-[fadeInDown_0.2s_ease-out]',
      )}
    >
      <span class="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: 'var(--ds-amber-700)' }} />
      Click to enable call audio
    </button>
  );
}

/**
 * The one banner both viewer roles wear. Presenting and following are mutually
 * exclusive, so this is only ever on screen once, and the two states differ by a
 * leading mark, a label and what dismissing them does.
 */
function HudBanner({
  lead,
  label,
  dismissLabel,
  onDismiss,
}: {
  lead: preact.JSX.Element;
  label: string;
  dismissLabel: string;
  onDismiss: () => void;
}) {
  return (
    <div
      class={cn(
        'fixed top-3 left-1/2 -translate-x-1/2 z-2147483646 flex items-center gap-2 h-9 px-3',
        geist.surfaceSmall,
        glass.font,
        'animate-[fadeInDown_0.2s_ease-out]',
      )}
    >
      {lead}
      <span class="text-ui font-medium text-(--ds-gray-1000)">{label}</span>
      <button
        type="button"
        class="ml-1 text-(--ds-gray-900) hover:text-(--ds-gray-1000) transition-colors"
        aria-label={dismissLabel}
        onClick={onDismiss}
      >
        <X size={14} />
      </button>
    </div>
  );
}

export function FollowIndicator() {
  const followed = followingPeer.value;
  const peer = followed ? peers.value.get(followed) : null;
  // Presenting and following are mutually exclusive, so one banner covers both
  // roles and they can never stack on top of each other.
  if (presenting.value) {
    return (
      <HudBanner
        lead={<MonitorPlay size={14} strokeWidth={1.75} class="shrink-0 text-(--ds-gray-900)" aria-hidden="true" />}
        label="Presenting to everyone"
        dismissLabel="Stop presenting"
        onDismiss={() => setPresenting(false)}
      />
    );
  }
  if (!peer) return null;
  return (
    <HudBanner
      lead={<span class="w-2 h-2 rounded-full shrink-0 animate-pulse" style={{ background: peer.color }} />}
      label={`Following ${peer.name}`}
      dismissLabel="Stop following"
      onDismiss={() => {
        followingPeer.value = null;
      }}
    />
  );
}
