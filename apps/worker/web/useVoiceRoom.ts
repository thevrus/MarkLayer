import { peers, toast } from '@ext/lib/state';
import { effect, useSignalEffect } from '@preact/signals';
import { useEffect, useRef } from 'preact/hooks';
import {
  audioConstraint,
  refreshDevices,
  selectedAudioInput,
  selectedAudioOutput,
  selectedVideoInput,
  unwatchDevices,
  videoConstraint,
  watchDevices,
} from './devicePrefs';
import { onRtcMessage, turnIceServers, wsSend } from './useRealtimeSync';
import {
  audioBlocked,
  type ConnQuality,
  expandedPeers,
  localVideoStream,
  peerConnQuality,
  peerVideoStreams,
  QUALITY_CONSTRAINTS,
  videoActive,
  videoMuted,
  videoQuality,
  voiceActive,
  voiceLevel,
  voiceMuted,
  voiceSpeaking,
} from './voiceSignals';

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
  // Number of consecutive ICE-restart attempts since the last successful connect.
  iceRestartAttempts: number;
  // Pending ICE-restart timer id — prevents `failed → disconnected → failed`
  // flapping from queueing two restarts that race on signalingState.
  iceRestartTimer: ReturnType<typeof setTimeout> | null;
  // For getStats deltas
  lastStats: { packetsLost: number; packetsReceived: number; ts: number } | null;
}

const SPEAKING_THRESHOLD = 15; // 0-255 byte frequency amplitude
const ANALYSIS_INTERVAL = 100; // ms
const STATS_INTERVAL = 2000; // ms
const MAX_ICE_RESTARTS = 3;

// Module-level audio plumbing. Reused across voice toggles so we don't pay the
// AudioContext create/close cost (50–200ms on mobile, 6-context cap on Safari)
// every time the user joins/leaves voice.
let sharedAudioCtx: AudioContext | null = null;
function getSharedAudioCtx(): AudioContext {
  if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') {
    sharedAudioCtx = new AudioContext();
  }
  if (sharedAudioCtx.state === 'suspended') {
    sharedAudioCtx.resume().catch(() => {});
  }
  return sharedAudioCtx;
}

// Hidden container for `<audio>` elements. Safari can GC detached HTMLAudioElement
// instances; keeping them in the live DOM avoids that and lets us setSinkId() reliably.
let audioContainer: HTMLDivElement | null = null;
function getAudioContainer(): HTMLDivElement {
  if (!audioContainer?.isConnected) {
    audioContainer = document.createElement('div');
    audioContainer.setAttribute('aria-hidden', 'true');
    audioContainer.style.cssText = 'position:fixed;left:-9999px;top:0;width:0;height:0;pointer-events:none;';
    document.body.appendChild(audioContainer);
  }
  return audioContainer;
}

// `setSinkId` is non-standard (Chrome/Edge only) and absent from lib.dom — one
// commented DOM-interop cast per CLAUDE.md guidance.
type WithSinkId = HTMLMediaElement & { setSinkId?: (id: string) => Promise<void> };
function setSinkIdSafe(el: HTMLMediaElement, deviceId: string | null) {
  if (!deviceId) return;
  const setSinkId = (el as WithSinkId).setSinkId;
  if (typeof setSinkId !== 'function') return;
  setSinkId.call(el, deviceId).catch(() => {});
}

function describeGumError(err: unknown): { title: string; hint?: string } {
  const name = err instanceof Error ? err.name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return { title: 'Permission denied', hint: 'Allow microphone/camera access in your browser address bar.' };
    case 'NotFoundError':
    case 'OverconstrainedError':
      return { title: 'Device not found', hint: 'The selected microphone or camera is unavailable.' };
    case 'NotReadableError':
    case 'AbortError':
      return { title: 'Device is busy', hint: 'Another app may be using your microphone or camera.' };
    default:
      return { title: 'Could not access device' };
  }
}

export function useVoiceRoom(localPeerId: string) {
  const connsRef = useRef(new Map<string, PeerConn>());
  const streamRef = useRef<MediaStream | null>(null);
  const localAnalyserRef = useRef<AnalyserNode | null>(null);
  const rtcConfigRef = useRef<RTCConfiguration | null>(null);

  // Read during render so the component subscribes to voiceActive changes
  const active = voiceActive.value;

  useEffect(() => {
    if (!active) return;
    let destroyed = false;

    const conns = connsRef.current;

    watchDevices();

    // Read lazily — wsSend rotates on WS reconnect; capturing the value here
    // would pin the stale send fn for the lifetime of the voice room.
    function sendSignaling(msg: Record<string, unknown>) {
      wsSend.value?.(msg);
    }

    function attachAnalyser(stream: MediaStream): AnalyserNode {
      const ctx = getSharedAudioCtx();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.3;
      ctx.createMediaStreamSource(stream).connect(analyser);
      return analyser;
    }

    // Poll all analysers and update voiceSpeaking signal.
    // Skip while tab is hidden — browsers throttle timers and analyser data goes stale.
    // Buffer matches `frequencyBinCount` (fftSize/2 = 128) so getByteFrequencyData
    // doesn't silently truncate the upper half of the spectrum.
    const buf = new Uint8Array(128);
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

    const statsTimer = setInterval(() => {
      if (document.hidden || conns.size === 0) return;
      for (const [id, entry] of conns) {
        sampleStats(id, entry);
      }
    }, STATS_INTERVAL);

    async function sampleStats(id: string, entry: PeerConn) {
      // Only worth polling once the candidate pair is up; pre-connect
      // reports are mostly empty and waste a per-tick allocation.
      const ice = entry.pc.iceConnectionState;
      if (ice !== 'connected' && ice !== 'completed') return;
      try {
        const report = await entry.pc.getStats();
        let lost = 0;
        let recv = 0;
        let hasInbound = false;
        let rtt: number | null = null;
        report.forEach((stat) => {
          if (stat.type === 'inbound-rtp') {
            hasInbound = true;
            if (typeof stat.packetsLost === 'number') lost += stat.packetsLost;
            if (typeof stat.packetsReceived === 'number') recv += stat.packetsReceived;
          } else if (stat.type === 'candidate-pair') {
            if (stat.state === 'succeeded' && typeof stat.currentRoundTripTime === 'number') {
              rtt = stat.currentRoundTripTime;
            }
          }
        });

        if (!hasInbound) return;
        const prev = entry.lastStats;
        entry.lastStats = { packetsLost: lost, packetsReceived: recv, ts: Date.now() };
        if (!prev) return;
        const lostDelta = lost - prev.packetsLost;
        const recvDelta = recv - prev.packetsReceived;
        const denom = lostDelta + recvDelta;
        const lossRate = denom > 0 ? lostDelta / denom : 0;

        let quality: ConnQuality = 'good';
        if (lossRate > 0.08 || (rtt !== null && rtt > 0.4)) quality = 'poor';
        else if (lossRate > 0.03 || (rtt !== null && rtt > 0.2)) quality = 'fair';

        const map = peerConnQuality.value;
        if (map.get(id) !== quality) {
          const next = new Map(map);
          next.set(id, quality);
          peerConnQuality.value = next;
        }
      } catch {
        /* getStats can throw if the pc is closing */
      }
    }

    async function getLocalStream() {
      if (streamRef.current) return streamRef.current;
      const wantVideo = videoActive.value;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraint(),
        video: wantVideo ? videoConstraint(QUALITY_CONSTRAINTS[videoQuality.value]) : false,
      });
      streamRef.current = stream;
      localAnalyserRef.current = attachAnalyser(stream);
      if (wantVideo) localVideoStream.value = stream;
      // Re-enumerate now that labels are populated by the permission grant.
      refreshDevices();
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
      audio.autoplay = true;
      audio.dataset.mlVoice = '';
      getAudioContainer().appendChild(audio);
      setSinkIdSafe(audio, selectedAudioOutput.value);

      const entry: PeerConn = {
        pc,
        audio,
        analyser: null,
        videoStream: null,
        makingOffer: false,
        ignoreOffer: false,
        pendingCandidates: [],
        iceRestartAttempts: 0,
        iceRestartTimer: null,
        lastStats: null,
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
        audio.play().catch((err) => {
          // Autoplay policy block — surface a one-click "enable audio" prompt.
          if (err instanceof Error && err.name === 'NotAllowedError') audioBlocked.value = true;
        });
        entry.analyser = attachAnalyser(remoteStream);
      };

      pc.onicecandidate = (e) => {
        if (e.candidate) {
          sendSignaling({ type: 'rtc_ice', to: remotePeerId, candidate: e.candidate.toJSON() });
        }
      };

      pc.oniceconnectionstatechange = () => {
        if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
          // `disconnected` is transient — the browser may recover within a few seconds.
          // `failed` is permanent without intervention. In both, try ICE restart up to
          // a few times, then refetch TURN creds (they may have expired) before giving up.
          if (entry.iceRestartAttempts < MAX_ICE_RESTARTS) {
            entry.iceRestartAttempts += 1;
            scheduleIceRestart(remotePeerId, entry, pc.iceConnectionState === 'failed' ? 0 : 4000);
          } else {
            removePeer(remotePeerId);
          }
        } else if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
          entry.iceRestartAttempts = 0;
        }
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'closed') removePeer(remotePeerId);
      };

      return entry;
    }

    function scheduleIceRestart(remotePeerId: string, entry: PeerConn, delayMs: number) {
      // Coalesce repeat triggers — `failed → disconnected → failed` flapping
      // fires this twice; only the latest schedule survives.
      if (entry.iceRestartTimer !== null) return;
      entry.iceRestartTimer = setTimeout(async () => {
        entry.iceRestartTimer = null;
        if (destroyed) return;
        const live = conns.get(remotePeerId);
        if (live !== entry) return;
        // If the state recovered on its own, no-op.
        if (entry.pc.iceConnectionState === 'connected' || entry.pc.iceConnectionState === 'completed') {
          entry.iceRestartAttempts = 0;
          return;
        }
        // setLocalDescription/createOffer is only valid from a stable signaling
        // state; perfect-negotiation may have left us mid-offer.
        if (entry.pc.signalingState !== 'stable') return;
        try {
          // On the 2nd+ attempt, refresh TURN creds — the previous ones may have aged out.
          if (entry.iceRestartAttempts >= 2) {
            sendSignaling({ type: 'rtc_request_ice' });
          }
          entry.makingOffer = true;
          await entry.pc.setLocalDescription(await entry.pc.createOffer({ iceRestart: true }));
          if (entry.pc.localDescription) {
            sendSignaling({ type: 'rtc_offer', to: remotePeerId, sdp: entry.pc.localDescription.toJSON() });
          }
        } catch (err) {
          console.warn('ICE restart failed:', err);
        } finally {
          entry.makingOffer = false;
        }
      }, delayMs);
    }

    function removePeer(id: string) {
      const entry = conns.get(id);
      if (!entry) return;
      if (entry.iceRestartTimer !== null) {
        clearTimeout(entry.iceRestartTimer);
        entry.iceRestartTimer = null;
      }
      entry.pc.close();
      entry.audio.srcObject = null;
      entry.audio.remove();
      entry.analyser?.disconnect();
      conns.delete(id);
      if (peerVideoStreams.value.has(id)) {
        const m = new Map(peerVideoStreams.value);
        m.delete(id);
        peerVideoStreams.value = m;
      }
      if (peerConnQuality.value.has(id)) {
        const m = new Map(peerConnQuality.value);
        m.delete(id);
        peerConnQuality.value = m;
      }
      if (expandedPeers.value.has(id)) {
        const s = new Set(expandedPeers.value);
        s.delete(id);
        expandedPeers.value = s;
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
      let stream: MediaStream;
      let rtcConfig: RTCConfiguration;
      try {
        [stream, rtcConfig] = await Promise.all([getLocalStream(), getRtcConfig()]);
      } catch (err) {
        const { title, hint } = describeGumError(err);
        toast(hint ? `${title}: ${hint}` : title, 'error', 6000);
        voiceActive.value = false;
        videoActive.value = false;
        return;
      }
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

    start();

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

    // Apply refreshed TURN creds to active PCs without dropping the call.
    // setConfiguration() is supported in all evergreen browsers; on failure
    // the next ICE restart will pick the new creds anyway.
    const disposeIceServers = effect(() => {
      const next = turnIceServers.value;
      if (!next) return;
      const newConfig: RTCConfiguration = { iceServers: next };
      rtcConfigRef.current = newConfig;
      for (const [, entry] of conns) {
        try {
          entry.pc.setConfiguration(newConfig);
        } catch {
          /* older browsers may throw; ignore */
        }
      }
    });

    return () => {
      destroyed = true;
      disposeBootstrap();
      disposeIceServers();
      onRtcMessage.value = null;
      clearInterval(pollTimer);
      clearInterval(statsTimer);
      unwatchDevices();
      voiceSpeaking.value = new Set();
      voiceLevel.value = 0;
      peerVideoStreams.value = new Map();
      peerConnQuality.value = new Map();
      expandedPeers.value = new Set();
      localVideoStream.value = null;
      audioBlocked.value = false;
      for (const [, entry] of conns) {
        if (entry.iceRestartTimer !== null) clearTimeout(entry.iceRestartTimer);
        entry.pc.close();
        entry.audio.srcObject = null;
        entry.audio.remove();
        entry.analyser?.disconnect();
      }
      conns.clear();
      localAnalyserRef.current = null;
      if (streamRef.current) {
        for (const track of streamRef.current.getTracks()) track.stop();
        streamRef.current = null;
      }
      // Suspend the shared AudioContext rather than closing — keeps creation cost
      // off the next voice toggle and avoids Safari's 6-context cap. The
      // audioContainer is kept alive for the same reason (peer audio elements
      // were already removed per-peer above; the container itself is empty).
      sharedAudioCtx?.suspend().catch(() => {});
      rtcConfigRef.current = null;
    };
  }, [active, localPeerId]);

  useSignalEffect(() => {
    const muted = voiceMuted.value;
    const stream = streamRef.current;
    if (!stream) return;
    for (const track of stream.getAudioTracks()) track.enabled = !muted;
  });

  // addTrack/removeTrack fires `negotiationneeded` on every PC; renegotiation
  // is handled by the perfect-negotiation loop above.
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
              video: videoConstraint(QUALITY_CONSTRAINTS[videoQuality.value]),
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
            refreshDevices();
          } catch (err) {
            const { title, hint } = describeGumError(err);
            toast(hint ? `${title}: ${hint}` : title, 'error', 6000);
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

  useSignalEffect(() => {
    const muted = videoMuted.value;
    const stream = streamRef.current;
    if (!stream) return;
    for (const track of stream.getVideoTracks()) track.enabled = !muted;
  });

  useSignalEffect(() => {
    selectedAudioInput.value; // subscribe
    if (!voiceActive.value) return;
    const stream = streamRef.current;
    if (!stream || stream.getAudioTracks().length === 0) return;
    void hotSwapTrack('audio', stream, connsRef.current, localAnalyserRef);
  });

  useSignalEffect(() => {
    selectedVideoInput.value; // subscribe
    if (!voiceActive.value || !videoActive.value) return;
    const stream = streamRef.current;
    if (!stream || stream.getVideoTracks().length === 0) return;
    void hotSwapTrack('video', stream, connsRef.current, localAnalyserRef);
  });

  useSignalEffect(() => {
    const sinkId = selectedAudioOutput.value;
    if (!sinkId) return;
    for (const [, entry] of connsRef.current) {
      setSinkIdSafe(entry.audio, sinkId);
    }
  });

  // applyConstraints is cheap on the wire — the encoder picks up the new target on the next keyframe.
  useSignalEffect(() => {
    const q = videoQuality.value;
    if (!voiceActive.value || !videoActive.value) return;
    const stream = streamRef.current;
    if (!stream) return;
    for (const track of stream.getVideoTracks()) {
      track.applyConstraints(videoConstraint(QUALITY_CONSTRAINTS[q])).catch(() => {});
    }
  });
}

async function hotSwapTrack(
  kind: 'audio' | 'video',
  stream: MediaStream,
  conns: Map<string, PeerConn>,
  analyserRef: { current: AnalyserNode | null },
) {
  const constraints: MediaStreamConstraints =
    kind === 'audio'
      ? { audio: audioConstraint() }
      : { video: videoConstraint(QUALITY_CONSTRAINTS[videoQuality.value]) };

  let next: MediaStream;
  try {
    next = await navigator.mediaDevices.getUserMedia(constraints);
  } catch (err) {
    const { title, hint } = describeGumError(err);
    toast(hint ? `${title}: ${hint}` : title, 'error', 5000);
    return;
  }

  const oldTrack = kind === 'audio' ? stream.getAudioTracks()[0] : stream.getVideoTracks()[0];
  const newTrack = kind === 'audio' ? next.getAudioTracks()[0] : next.getVideoTracks()[0];
  if (!newTrack) return;
  const mutedSignal = kind === 'audio' ? voiceMuted : videoMuted;
  newTrack.enabled = oldTrack ? oldTrack.enabled : !mutedSignal.value;

  // replaceTrack is per-PC and independent — parallelize.
  await Promise.all(
    Array.from(conns.values(), (entry) => {
      const sender = entry.pc.getSenders().find((s) => s.track === oldTrack);
      return sender
        ? sender.replaceTrack(newTrack).catch((err) => {
            console.warn(`replaceTrack (${kind}) failed:`, err);
          })
        : undefined;
    }),
  );

  if (oldTrack) {
    oldTrack.stop();
    stream.removeTrack(oldTrack);
  }
  stream.addTrack(newTrack);

  if (kind === 'audio') {
    // Rebind the local analyser so the mic-level meter follows the new source.
    // Feed it from a fresh MediaStream containing only the new track — Firefox
    // snapshots tracks at MediaStreamSource creation, so passing the mutated
    // `stream` would leave the analyser reading from the (stopped) old track.
    analyserRef.current?.disconnect();
    const ctx = getSharedAudioCtx();
    const fresh = ctx.createAnalyser();
    fresh.fftSize = 256;
    fresh.smoothingTimeConstant = 0.3;
    ctx.createMediaStreamSource(new MediaStream([newTrack])).connect(fresh);
    analyserRef.current = fresh;
  } else {
    // Bump signal identity so MediaBubble re-binds srcObject. Wrap in a fresh
    // MediaStream because the underlying stream object is unchanged — Preact
    // signals compare with Object.is and would skip the update otherwise.
    localVideoStream.value = new MediaStream(stream.getTracks());
  }
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
