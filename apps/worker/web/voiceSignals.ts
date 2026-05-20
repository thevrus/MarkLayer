// Signals consumed across the app (CursorLayer, Viewer chrome). Split out of
// useVoiceRoom.ts so reading these doesn't drag the WebRTC engine into the
// main client chunk — the engine is lazy-loaded on first voice/video toggle.

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
