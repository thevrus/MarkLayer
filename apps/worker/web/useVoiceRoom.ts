import { peers } from '@ext/lib/state';
import { effect, signal, useSignalEffect } from '@preact/signals';
import { useEffect, useRef } from 'preact/hooks';
import { onRtcMessage, turnIceServers, wsSend } from './useRealtimeSync';

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

function isSessionDescription(v: unknown): v is RTCSessionDescriptionInit {
  return typeof v === 'object' && v !== null && 'type' in v && 'sdp' in v;
}

function isIceCandidate(v: unknown): v is RTCIceCandidateInit {
  return typeof v === 'object' && v !== null && 'candidate' in v;
}

// ICE servers arrive via the WS `init` message (see useRealtimeSync). If the
// WS init hasn't landed yet by the time the user toggles voice, wait briefly
// for it, then fall back to STUN-only. Bounded by 5s so a stalled init
// doesn't trap voice in a loading state.
async function getRtcConfig(): Promise<RTCConfiguration> {
  if (turnIceServers.value) return { iceServers: turnIceServers.value };
  return new Promise<RTCConfiguration>((resolve) => {
    let done = false;
    const finish = (cfg: RTCConfiguration) => {
      if (done) return;
      done = true;
      dispose();
      clearTimeout(timer);
      resolve(cfg);
    };
    const dispose = effect(() => {
      if (turnIceServers.value) finish({ iceServers: turnIceServers.value });
    });
    const timer = setTimeout(() => finish(FALLBACK_CONFIG), 5000);
  });
}

interface PeerConn {
  pc: RTCPeerConnection;
  audio: HTMLAudioElement;
  analyser: AnalyserNode | null;
  videoStream: MediaStream | null;
  // Perfect-negotiation flags (https://w3c.github.io/webrtc-pc/#perfect-negotiation-example)
  makingOffer: boolean;
  ignoreOffer: boolean;
  // ICE candidates received before remoteDescription is set
  pendingCandidates: RTCIceCandidateInit[];
}

const SPEAKING_THRESHOLD = 15; // 0-255 byte frequency amplitude
const ANALYSIS_INTERVAL = 100; // ms

export function useVoiceRoom(localPeerId: string) {
  const connsRef = useRef(new Map<string, PeerConn>());
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const localAnalyserRef = useRef<AnalyserNode | null>(null);
  const rtcConfigRef = useRef<RTCConfiguration | null>(null);

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
      if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
        audioCtxRef.current = new AudioContext();
      }
      if (audioCtxRef.current.state === 'suspended') {
        audioCtxRef.current.resume().catch(() => {});
      }
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

    // Poll all analysers and update voiceSpeaking signal.
    // Skip while tab is hidden — browsers throttle timers and analyser data goes stale.
    const buf = new Uint8Array(64);
    const pollTimer = setInterval(() => {
      if (document.hidden) return;
      const speaking = new Set<string>();

      const la = localAnalyserRef.current;
      let nextLevel = 0;
      if (la) {
        la.getByteFrequencyData(buf);
        const p = peak(buf);
        nextLevel = Math.min(p / 128, 1);
        if (!voiceMuted.value && p > SPEAKING_THRESHOLD) speaking.add(localPeerId);
      }
      // Coarse-grained no-op guard: re-render only on perceptible (~1%) change.
      if (Math.abs(nextLevel - voiceLevel.peek()) > 0.01) voiceLevel.value = nextLevel;

      for (const [id, entry] of conns) {
        if (entry.analyser) {
          entry.analyser.getByteFrequencyData(buf);
          if (peak(buf) > SPEAKING_THRESHOLD) speaking.add(id);
        }
      }

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

    async function flushPendingCandidates(entry: PeerConn) {
      const queued = entry.pendingCandidates;
      entry.pendingCandidates = [];
      for (const c of queued) {
        try {
          await entry.pc.addIceCandidate(new RTCIceCandidate(c));
        } catch (err) {
          if (!entry.ignoreOffer) console.warn('addIceCandidate (flush) failed:', err);
        }
      }
    }

    function createPeerConnection(remotePeerId: string, stream: MediaStream, config: RTCConfiguration): PeerConn {
      const pc = new RTCPeerConnection(config);
      const audio = new Audio();

      const entry: PeerConn = {
        pc,
        audio,
        analyser: null,
        videoStream: null,
        makingOffer: false,
        ignoreOffer: false,
        pendingCandidates: [],
      };
      conns.set(remotePeerId, entry);

      // Add local tracks. This triggers `negotiationneeded` once microtask drains,
      // so the caller doesn't need to manually createOffer/setLocalDescription.
      for (const track of stream.getTracks()) {
        pc.addTrack(track, stream);
      }

      pc.onnegotiationneeded = async () => {
        if (destroyed) return;
        try {
          entry.makingOffer = true;
          await pc.setLocalDescription();
          if (pc.localDescription) {
            sendSignaling({ type: 'rtc_offer', to: remotePeerId, sdp: pc.localDescription.toJSON() });
          }
        } catch (err) {
          console.warn('negotiationneeded failed:', err);
        } finally {
          entry.makingOffer = false;
        }
      };

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
        entry.analyser = attachAnalyser(remoteStream);
      };

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

      return entry;
    }

    function removePeer(id: string) {
      const entry = conns.get(id);
      if (!entry) return;
      entry.pc.close();
      entry.audio.srcObject = null;
      entry.analyser?.disconnect();
      conns.delete(id);
      if (peerVideoStreams.value.has(id)) {
        const m = new Map(peerVideoStreams.value);
        m.delete(id);
        peerVideoStreams.value = m;
      }
    }

    function bootstrapPeer(remotePeerId: string) {
      if (destroyed || remotePeerId === localPeerId || conns.has(remotePeerId)) return;
      const stream = streamRef.current;
      const config = rtcConfigRef.current;
      if (!stream || !config) return;
      createPeerConnection(remotePeerId, stream, config);
      // onnegotiationneeded will fire from addTrack and send the first offer.
    }

    async function handleRtc(msg: { type: string; from: string; [k: string]: unknown }) {
      if (destroyed) return;
      const from = msg.from;
      if (typeof from !== 'string' || from === localPeerId) return;

      if (msg.type === 'rtc_offer') {
        const sdp = msg.sdp;
        if (!isSessionDescription(sdp)) return;

        // Ensure a PC exists for this peer (callee path for a peer we never offered to)
        let entry = conns.get(from);
        if (!entry) {
          const stream = streamRef.current;
          const config = rtcConfigRef.current;
          if (!stream || !config) return;
          entry = createPeerConnection(from, stream, config);
        }
        const { pc } = entry;

        const offerCollision = entry.makingOffer || pc.signalingState !== 'stable';
        const polite = localPeerId < from;
        entry.ignoreOffer = !polite && offerCollision;
        if (entry.ignoreOffer) return;

        try {
          // setRemoteDescription with an offer in a non-stable state performs
          // an implicit rollback of our pending local offer (perfect negotiation).
          await pc.setRemoteDescription(new RTCSessionDescription(sdp));
          if (destroyed) return;
          await flushPendingCandidates(entry);
          await pc.setLocalDescription();
          if (destroyed) return;
          if (pc.localDescription) {
            sendSignaling({ type: 'rtc_answer', to: from, sdp: pc.localDescription.toJSON() });
          }
        } catch (err) {
          console.warn('rtc_offer handling failed:', err);
        }
      } else if (msg.type === 'rtc_answer') {
        const entry = conns.get(from);
        const sdp = msg.sdp;
        if (!entry || !isSessionDescription(sdp)) return;
        // Only apply an answer while we have an outstanding local offer.
        if (entry.pc.signalingState !== 'have-local-offer') return;
        try {
          await entry.pc.setRemoteDescription(new RTCSessionDescription(sdp));
          if (destroyed) return;
          await flushPendingCandidates(entry);
        } catch (err) {
          console.warn('rtc_answer handling failed:', err);
        }
      } else if (msg.type === 'rtc_ice') {
        const entry = conns.get(from);
        const candidate = msg.candidate;
        if (!entry || !isIceCandidate(candidate)) return;
        // Buffer until remoteDescription is set — otherwise candidates are dropped
        // and NAT'd peers can fail to connect.
        if (!entry.pc.remoteDescription) {
          entry.pendingCandidates.push(candidate);
          return;
        }
        try {
          await entry.pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (err) {
          if (!entry.ignoreOffer) console.warn('addIceCandidate failed:', err);
        }
      }
    }

    async function start() {
      if (destroyed) return;
      const [stream, rtcConfig] = await Promise.all([getLocalStream(), getRtcConfig()]);
      if (destroyed) return;
      rtcConfigRef.current = rtcConfig;
      applyMute(stream);

      // Wire incoming signaling before bootstrapping so any in-flight offers
      // from peers who initiated against us don't get dropped.
      onRtcMessage.value = handleRtc;

      // Initiate connections to all existing peers
      for (const [peerId] of peers.value) {
        bootstrapPeer(peerId);
      }
    }

    start().catch((err) => {
      console.warn('Voice room failed:', err);
      voiceActive.value = false;
    });

    // Subscribe to peer-set changes so late joiners get a PC.
    // Uses raw effect() (not useSignalEffect) so we can close over the local
    // helpers above without leaking them to module scope.
    const knownPeers = new Set<string>();
    const disposeBootstrap = effect(() => {
      for (const id of peers.value.keys()) {
        if (!knownPeers.has(id)) {
          knownPeers.add(id);
          bootstrapPeer(id);
        }
      }
      // Drop ids that are no longer in the peer map so a rejoin re-bootstraps.
      for (const id of knownPeers) {
        if (!peers.value.has(id)) knownPeers.delete(id);
      }
    });

    return () => {
      destroyed = true;
      disposeBootstrap();
      onRtcMessage.value = null;
      clearInterval(pollTimer);
      voiceSpeaking.value = new Set();
      voiceLevel.value = 0;
      peerVideoStreams.value = new Map();
      localVideoStream.value = null;
      for (const [, entry] of conns) {
        entry.pc.close();
        entry.audio.srcObject = null;
        entry.analyser?.disconnect();
      }
      conns.clear();
      localAnalyserRef.current = null;
      if (streamRef.current) {
        for (const track of streamRef.current.getTracks()) track.stop();
        streamRef.current = null;
      }
      audioCtxRef.current?.close();
      audioCtxRef.current = null;
      rtcConfigRef.current = null;
    };
  }, [active, localPeerId]);

  // Mute toggle — subscribe via signal effect so we don't depend on `.value` in deps array.
  useSignalEffect(() => {
    const muted = voiceMuted.value;
    const stream = streamRef.current;
    if (!stream) return;
    for (const track of stream.getAudioTracks()) track.enabled = !muted;
  });

  // Video toggle — add/remove the camera track. addTrack/removeTrack fire
  // `negotiationneeded` on every PC, so renegotiation happens automatically
  // via the perfect-negotiation loop above. No manual createOffer here.
  useSignalEffect(() => {
    const wantVideo = videoActive.value;
    if (!voiceActive.value) return;
    const conns = connsRef.current;
    const stream = streamRef.current;
    if (!stream) return;

    (async () => {
      if (wantVideo) {
        if (stream.getVideoTracks().length === 0) {
          try {
            const videoStream = await navigator.mediaDevices.getUserMedia({
              video: { width: 160, height: 160, frameRate: 15 },
            });
            const videoTrack = videoStream.getVideoTracks()[0];
            // Voice may have been disabled (or the stream replaced) while we
            // awaited the camera prompt — drop the track instead of mutating
            // a torn-down stream.
            if (!voiceActive.value || streamRef.current !== stream) {
              videoTrack.stop();
              return;
            }
            videoTrack.enabled = !videoMuted.value;
            stream.addTrack(videoTrack);
            localVideoStream.value = stream;
            for (const [, entry] of conns) {
              entry.pc.addTrack(videoTrack, stream);
            }
          } catch {
            videoActive.value = false;
          }
        }
      } else {
        for (const track of stream.getVideoTracks()) {
          track.stop();
          stream.removeTrack(track);
          for (const [, entry] of conns) {
            const sender = entry.pc.getSenders().find((s) => s.track === track);
            if (sender) entry.pc.removeTrack(sender);
          }
        }
        localVideoStream.value = null;
      }
    })();
  });

  // Video mute — track.enabled flip is cheap and doesn't renegotiate.
  useSignalEffect(() => {
    const muted = videoMuted.value;
    const stream = streamRef.current;
    if (!stream) return;
    for (const track of stream.getVideoTracks()) track.enabled = !muted;
  });
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
