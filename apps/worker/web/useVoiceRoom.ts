import { peers } from '@ext/lib/state';
import { signal } from '@preact/signals';
import { useEffect, useRef } from 'preact/hooks';
import { onRtcMessage, wsSend } from './useRealtimeSync';

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

const FALLBACK_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }],
};

let _rtcConfig: RTCConfiguration | null = null;
async function getRtcConfig(): Promise<RTCConfiguration> {
  if (_rtcConfig) return _rtcConfig;
  try {
    const res = await fetch('/api/turn');
    if (!res.ok) throw new Error();
    const data = await res.json<{ iceServers: RTCIceServer[] }>();
    if (data.iceServers?.length) {
      _rtcConfig = { iceServers: data.iceServers };
      return _rtcConfig;
    }
  } catch {
    /* fall through */
  }
  return FALLBACK_CONFIG;
}

interface PeerConn {
  pc: RTCPeerConnection;
  audio: HTMLAudioElement;
  analyser: AnalyserNode | null;
  videoStream: MediaStream | null;
}

const SPEAKING_THRESHOLD = 15; // 0-255 byte frequency amplitude
const ANALYSIS_INTERVAL = 100; // ms

export function useVoiceRoom(localPeerId: string) {
  const connsRef = useRef(new Map<string, PeerConn>());
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const localAnalyserRef = useRef<AnalyserNode | null>(null);

  // Read during render so the component subscribes to voiceActive changes
  const active = voiceActive.value;

  useEffect(() => {
    if (!active) return;
    let destroyed = false;

    const conns = connsRef.current;

    // Read wsSend lazily so the voice room survives WS reconnects
    function sendSignaling(msg: Record<string, unknown>) {
      wsSend.value?.(msg);
    }

    function getAudioCtx() {
      if (!audioCtxRef.current) audioCtxRef.current = new AudioContext();
      return audioCtxRef.current;
    }

    function attachAnalyser(stream: MediaStream): AnalyserNode {
      const ctx = getAudioCtx();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.3;
      ctx.createMediaStreamSource(stream).connect(analyser);
      return analyser;
    }

    // Poll all analysers and update voiceSpeaking signal
    const buf = new Uint8Array(64);
    const pollTimer = setInterval(() => {
      const speaking = new Set<string>();

      // Check local mic
      const la = localAnalyserRef.current;
      if (la) {
        la.getByteFrequencyData(buf);
        const p = peak(buf);
        voiceLevel.value = Math.min(p / 128, 1);
        if (!voiceMuted.value && p > SPEAKING_THRESHOLD) speaking.add(localPeerId);
      } else {
        voiceLevel.value = 0;
      }

      // Check remote peers
      for (const [id, entry] of conns) {
        if (entry.analyser) {
          entry.analyser.getByteFrequencyData(buf);
          if (peak(buf) > SPEAKING_THRESHOLD) speaking.add(id);
        }
      }

      // Only update signal if changed
      const prev = voiceSpeaking.value;
      if (speaking.size !== prev.size || [...speaking].some((id) => !prev.has(id))) {
        voiceSpeaking.value = speaking;
      }
    }, ANALYSIS_INTERVAL);

    async function getLocalStream() {
      if (streamRef.current) return streamRef.current;
      const wantVideo = videoActive.value;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: wantVideo ? { width: 160, height: 160, frameRate: 15 } : false,
      });
      streamRef.current = stream;
      localAnalyserRef.current = attachAnalyser(stream);
      if (wantVideo) localVideoStream.value = stream;
      return stream;
    }

    function createPeerConnection(remotePeerId: string, stream: MediaStream, config: RTCConfiguration): PeerConn {
      const pc = new RTCPeerConnection(config);
      const audio = new Audio();
      let analyser: AnalyserNode | null = null;

      // Add local tracks
      for (const track of stream.getTracks()) {
        pc.addTrack(track, stream);
      }

      // Receive remote tracks
      pc.ontrack = (e) => {
        if (e.track.kind === 'video') {
          const videoStream = e.streams[0] || new MediaStream([e.track]);
          entry.videoStream = videoStream;
          const next = new Map(peerVideoStreams.value);
          next.set(remotePeerId, videoStream);
          peerVideoStreams.value = next;
          e.track.onended = () => {
            entry.videoStream = null;
            const m = new Map(peerVideoStreams.value);
            m.delete(remotePeerId);
            peerVideoStreams.value = m;
          };
          return;
        }
        // Audio track
        const remoteStream = e.streams[0] || new MediaStream([e.track]);
        audio.srcObject = remoteStream;
        audio.play().catch(() => {});
        analyser = attachAnalyser(remoteStream);
        entry.analyser = analyser;
      };

      // Send ICE candidates
      pc.onicecandidate = (e) => {
        if (e.candidate) {
          sendSignaling({ type: 'rtc_ice', to: remotePeerId, candidate: e.candidate.toJSON() });
        }
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
          removePeer(remotePeerId);
        }
      };

      const entry: PeerConn = { pc, audio, analyser, videoStream: null };
      conns.set(remotePeerId, entry);
      return entry;
    }

    function removePeer(id: string) {
      const entry = conns.get(id);
      if (entry) {
        entry.pc.close();
        entry.audio.srcObject = null;
        conns.delete(id);
      }
    }

    async function startVoice() {
      if (destroyed) return;
      const [stream, rtcConfig] = await Promise.all([getLocalStream(), getRtcConfig()]);
      applyMute(stream);

      // Initiate connections to all existing peers (caller role)
      for (const [peerId] of peers.value) {
        if (peerId === localPeerId || conns.has(peerId)) continue;
        const { pc } = createPeerConnection(peerId, stream, rtcConfig);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        sendSignaling({ type: 'rtc_offer', to: peerId, sdp: pc.localDescription!.toJSON() });
      }

      // Handle incoming signaling (polite peer pattern to resolve glare)
      onRtcMessage.value = async (msg) => {
        if (destroyed) return;
        const from = msg.from as string;

        if (msg.type === 'rtc_offer') {
          const existing = conns.get(from);
          const hasLocalOffer = existing?.pc.signalingState === 'have-local-offer';

          // Glare: both sides sent offers simultaneously
          if (hasLocalOffer) {
            const polite = localPeerId < from;
            if (!polite) return; // impolite peer ignores incoming offer — our offer wins
            existing!.pc.close();
            conns.delete(from);
          } else if (existing) {
            existing.pc.close();
            conns.delete(from);
          }

          const stream = await getLocalStream();
          const { pc } = createPeerConnection(from, stream, rtcConfig);
          await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp as RTCSessionDescriptionInit));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          sendSignaling({ type: 'rtc_answer', to: from, sdp: pc.localDescription!.toJSON() });
        } else if (msg.type === 'rtc_answer') {
          const entry = conns.get(from);
          if (entry && entry.pc.signalingState !== 'stable') {
            await entry.pc.setRemoteDescription(new RTCSessionDescription(msg.sdp as RTCSessionDescriptionInit));
          }
        } else if (msg.type === 'rtc_ice') {
          const entry = conns.get(from);
          if (entry && msg.candidate) {
            await entry.pc.addIceCandidate(new RTCIceCandidate(msg.candidate as RTCIceCandidateInit)).catch(() => {});
          }
        }
      };
    }

    startVoice().catch((err) => {
      console.warn('Voice room failed:', err);
      voiceActive.value = false;
    });

    return () => {
      destroyed = true;
      onRtcMessage.value = null;
      clearInterval(pollTimer);
      voiceSpeaking.value = new Set();
      voiceLevel.value = 0;
      peerVideoStreams.value = new Map();
      localVideoStream.value = null;
      for (const [, entry] of conns) {
        entry.pc.close();
        entry.audio.srcObject = null;
      }
      conns.clear();
      localAnalyserRef.current = null;
      if (streamRef.current) {
        for (const track of streamRef.current.getTracks()) track.stop();
        streamRef.current = null;
      }
      audioCtxRef.current?.close();
      audioCtxRef.current = null;
    };
  }, [active, localPeerId]);

  // React to mute toggle
  useEffect(() => {
    const stream = streamRef.current;
    if (stream) applyMute(stream);
  }, [voiceMuted.value]);

  // React to video toggle — add/remove video track on existing connections
  useEffect(() => {
    const wantVideo = videoActive.value;
    const conns = connsRef.current;
    if (!voiceActive.value) return;

    (async () => {
      const stream = streamRef.current;
      if (!stream) return;

      if (wantVideo) {
        // Add video track if not already present
        if (stream.getVideoTracks().length === 0) {
          try {
            const videoStream = await navigator.mediaDevices.getUserMedia({
              video: { width: 160, height: 160, frameRate: 15 },
            });
            const videoTrack = videoStream.getVideoTracks()[0];
            stream.addTrack(videoTrack);
            localVideoStream.value = stream;
            // Add track to all existing peer connections
            for (const [, entry] of conns) {
              entry.pc.addTrack(videoTrack, stream);
            }
            // Renegotiate with all peers
            for (const [peerId, entry] of conns) {
              const offer = await entry.pc.createOffer();
              await entry.pc.setLocalDescription(offer);
              wsSend.value?.({ type: 'rtc_offer', to: peerId, sdp: entry.pc.localDescription!.toJSON() });
            }
          } catch {
            videoActive.value = false;
          }
        }
      } else {
        // Remove video tracks
        for (const track of stream.getVideoTracks()) {
          track.stop();
          stream.removeTrack(track);
          for (const [, entry] of conns) {
            const sender = entry.pc.getSenders().find((s) => s.track === track);
            if (sender) entry.pc.removeTrack(sender);
          }
        }
        localVideoStream.value = null;
        // Renegotiate
        for (const [peerId, entry] of conns) {
          try {
            const offer = await entry.pc.createOffer();
            await entry.pc.setLocalDescription(offer);
            wsSend.value?.({ type: 'rtc_offer', to: peerId, sdp: entry.pc.localDescription!.toJSON() });
          } catch {
            /* peer may have disconnected */
          }
        }
      }

      // Apply video mute state
      for (const track of stream.getVideoTracks()) {
        track.enabled = !videoMuted.value;
      }
    })();
  }, [videoActive.value]);

  // React to video mute toggle
  useEffect(() => {
    const stream = streamRef.current;
    if (stream) {
      for (const track of stream.getVideoTracks()) {
        track.enabled = !videoMuted.value;
      }
    }
  }, [videoMuted.value]);
}

function applyMute(stream: MediaStream) {
  for (const track of stream.getAudioTracks()) {
    track.enabled = !voiceMuted.value;
  }
}

function peak(buf: Uint8Array): number {
  let max = 0;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] > max) max = buf[i];
  }
  return max;
}
