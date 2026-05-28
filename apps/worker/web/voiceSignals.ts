// Voice/video signals split from useVoiceRoom so reading them doesn't drag
// the WebRTC engine into the main client chunk.

import { signal } from '@preact/signals';

export const voiceActive = signal(false);
export const voiceMuted = signal(false);
export const videoActive = signal(false);
export const videoMuted = signal(false);
/** Set of peer IDs currently speaking (audio level above threshold) */
export const voiceSpeaking = signal<Set<string>>(new Set());
/** Local mic level 0–1 (updated at ~10 Hz when voice is active) */
export const voiceLevel = signal(0);
/** Map of peerId → MediaStream for remote video tracks */
export const peerVideoStreams = signal<Map<string, MediaStream>>(new Map());
/** Local video stream for self-view */
export const localVideoStream = signal<MediaStream | null>(null);

/** Browser autoplay policy blocked remote audio playback — UI shows an "enable audio" prompt. */
export const audioBlocked = signal(false);

// Lives here (not in useVoiceRoom) so the banner's click handler doesn't pull
// the WebRTC engine chunk into the main viewer bundle. Scoped to peer-audio
// elements (tagged by useVoiceRoom) to avoid touching unrelated <audio> tags.
// Only clear the banner once at least one play() resolves — otherwise the user
// is stuck with audio still blocked and no affordance to retry.
export async function resumeBlockedAudio() {
  const els = document.querySelectorAll<HTMLAudioElement>('audio[data-ml-voice]');
  if (els.length === 0) return;
  const results = await Promise.allSettled(Array.from(els, (el) => el.play()));
  if (results.some((r) => r.status === 'fulfilled')) audioBlocked.value = false;
}

export type ConnQuality = 'good' | 'fair' | 'poor';
export const peerConnQuality = signal<Map<string, ConnQuality>>(new Map());

/** Peer-ids whose tile has been popped out into a draggable MediaBubble. */
export const expandedPeers = signal<Set<string>>(new Set());

/** Ring color for a peer bubble/avatar based on connection quality. */
export function qualityRing(q: ConnQuality | undefined, fallback: string): string {
  if (q === 'poor') return '#ef4444';
  if (q === 'fair') return '#f59e0b';
  return fallback;
}

export type QualityPreset = 'low' | 'medium' | 'hd';
const QUALITY_KEY = 'ml-video-quality';
function parseQuality(raw: string | null): QualityPreset {
  return raw === 'medium' || raw === 'hd' ? raw : 'low';
}
export const videoQuality = signal<QualityPreset>(
  typeof localStorage !== 'undefined' ? parseQuality(localStorage.getItem(QUALITY_KEY)) : 'low',
);
export const QUALITY_CONSTRAINTS: Record<QualityPreset, MediaTrackConstraints> = {
  low: { width: { ideal: 160 }, height: { ideal: 160 }, frameRate: { ideal: 15 } },
  medium: { width: { ideal: 320 }, height: { ideal: 240 }, frameRate: { ideal: 24 } },
  hd: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } },
};
export function persistQuality(q: QualityPreset) {
  videoQuality.value = q;
  try {
    localStorage.setItem(QUALITY_KEY, q);
  } catch {
    /* quota / private mode */
  }
}
