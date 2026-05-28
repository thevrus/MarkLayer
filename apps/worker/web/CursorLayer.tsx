import { peers } from '@ext/lib/state';
import { useEffect, useRef } from 'preact/hooks';
import { CursorArrow } from './CursorArrow';
import { followingPeer } from './signals';
import { activeRipples, peerCursorSamples } from './useRealtimeSync';
import { expandedPeers, peerConnQuality, peerVideoStreams, qualityRing, voiceSpeaking } from './voiceSignals';

/**
 * Render lag for client-side interpolation. Sender throttles cursor packets to
 * 50 ms intervals, so 90 ms of intentional delay guarantees we always have a
 * future-of-render-time sample to interpolate towards — the rAF loop reads
 * "now − 90 ms" and finds the two surrounding samples in the buffer.
 */
const CURSOR_RENDER_DELAY_MS = 90;

interface Props {
  scale: number;
  scrollY: number;
}

function PeerVideo({ stream, onClick, ringColor }: { stream: MediaStream; onClick: () => void; ringColor: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      title="Pop out video"
      class="p-0 m-0 border-none bg-transparent cursor-pointer"
    >
      <video
        ref={ref}
        autoPlay
        playsInline
        muted
        class="w-8 h-8 rounded-full object-cover shrink-0 pointer-events-none"
        style={{ boxShadow: `0 0 0 2px ${ringColor}` }}
      />
    </button>
  );
}

export function CursorLayer({ scale: s, scrollY }: Props) {
  const peerMap = peers.value;
  const ripples = activeRipples.value;

  const speaking = voiceSpeaking.value;
  const following = followingPeer.value;
  const videoStreams = peerVideoStreams.value;
  const quality = peerConnQuality.value;
  const expanded = expandedPeers.value;
  // Map peer → latest ripple id so the CursorArrow wrapper can be keyed on it
  // and re-mount (= replay the click pulse) on each fresh click.
  const latestRippleByPeer = new Map<string, string>();
  for (const r of ripples) latestRippleByPeer.set(r.peerId, r.id);

  // Refs read by the rAF loop. Updated each render so the loop sees the
  // latest scroll/scale without restarting.
  const nodesRef = useRef(new Map<string, HTMLDivElement>());
  const scrollYRef = useRef(scrollY);
  const scaleRef = useRef(s);
  scrollYRef.current = scrollY;
  scaleRef.current = s;

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const renderTime = performance.now() - CURSOR_RENDER_DELAY_MS;
      const scale = scaleRef.current;
      const scrollOffset = scrollYRef.current;
      for (const [peerId, node] of nodesRef.current) {
        const buf = peerCursorSamples.get(peerId);
        if (!buf || buf.length === 0) continue;
        let x: number;
        let y: number;
        if (buf.length === 1 || renderTime <= buf[0].t) {
          x = buf[0].x;
          y = buf[0].y;
        } else if (renderTime >= buf[buf.length - 1].t) {
          // No future sample yet — pin to the latest so the cursor stops
          // cleanly instead of overshooting via extrapolation.
          const last = buf[buf.length - 1];
          x = last.x;
          y = last.y;
        } else {
          // Find the segment [a, b] surrounding renderTime, lerp between them.
          let i = 0;
          while (i < buf.length - 1 && buf[i + 1].t <= renderTime) i++;
          const a = buf[i];
          const b = buf[i + 1];
          const span = b.t - a.t;
          const u = span > 0 ? (renderTime - a.t) / span : 1;
          x = a.x + (b.x - a.x) * u;
          y = a.y + (b.y - a.y) * u;
        }
        const vx = x * scale;
        const vy = y * scale - scrollOffset;
        node.style.transform = `translate3d(${vx}px, ${vy}px, 0)`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  if (peerMap.size === 0 && ripples.length === 0) return null;

  return (
    <div class="absolute inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 999 }}>
      {ripples.map((r) => {
        const left = r.x * s;
        const top = r.y * s - scrollY;
        return (
          <div key={r.id} class="absolute" style={{ left, top, width: 0, height: 0 }}>
            {[0, 140].map((delay) => (
              <span
                key={delay}
                class="absolute left-0 top-0 w-10 h-10 rounded-full border"
                style={{
                  borderColor: r.color,
                  animation: 'mlRipple 700ms cubic-bezier(0.2, 0.6, 0.2, 1) forwards',
                  animationDelay: `${delay}ms`,
                  opacity: 0,
                }}
              />
            ))}
          </div>
        );
      })}
      {Array.from(peerMap.values()).map((peer) => {
        if (!peer.cursor) return null;
        const vx = peer.cursor.x * s;
        const vy = peer.cursor.y * s - scrollY;
        const isSpeaking = speaking.has(peer.id);
        const isFollowing = following === peer.id;
        const videoStream = expanded.has(peer.id) ? undefined : videoStreams.get(peer.id);

        const rippleId = latestRippleByPeer.get(peer.id);
        return (
          // The rAF loop above drives `transform: translate3d` at 60 fps using
          // a 90 ms render delay and lerping between buffered samples — that
          // gives true continuous motion instead of the CSS-transition stepping
          // we get for free between 20 Hz packets. Initial transform comes from
          // peer.cursor so the first frame paints before rAF takes over.
          <div
            key={peer.id}
            ref={(el) => {
              if (el) nodesRef.current.set(peer.id, el);
              else nodesRef.current.delete(peer.id);
            }}
            class="absolute top-0 left-0 will-change-transform"
            style={{ transform: `translate3d(${vx}px, ${vy}px, 0)` }}
          >
            {rippleId ? (
              <span
                key={rippleId}
                class="inline-block origin-top-left"
                style={{ animation: 'mlCursorClick 260ms cubic-bezier(0.34, 1.56, 0.64, 1)' }}
              >
                <CursorArrow color={peer.color} />
              </span>
            ) : (
              <CursorArrow color={peer.color} />
            )}
            <div
              class="absolute left-5 top-6 whitespace-nowrap rounded-full py-1.5 text-[13px] font-semibold text-white leading-none flex items-center gap-1.5 pointer-events-auto cursor-pointer select-none"
              style={{
                paddingLeft: videoStream ? '4px' : isSpeaking ? '8px' : '12px',
                paddingRight: '12px',
                background: peer.color,
                boxShadow: isFollowing
                  ? `0 0 0 2px ${peer.color}, 0 0 0 4px white, 0 2px 8px ${peer.color}40`
                  : isSpeaking
                    ? `0 0 0 2px ${peer.color}40, 0 2px 8px ${peer.color}40`
                    : `0 2px 8px ${peer.color}40`,
                transition: 'box-shadow 0.15s ease-out, padding 0.15s ease-out',
              }}
              onClick={(e) => {
                e.stopPropagation();
                followingPeer.value = isFollowing ? null : peer.id;
              }}
              title={isFollowing ? 'Stop following' : `Follow ${peer.name}`}
            >
              {videoStream && (
                <PeerVideo
                  stream={videoStream}
                  ringColor={qualityRing(quality.get(peer.id), 'rgba(255,255,255,0.3)')}
                  onClick={() => {
                    const next = new Set(expandedPeers.value);
                    next.add(peer.id);
                    expandedPeers.value = next;
                  }}
                />
              )}
              {!videoStream && isSpeaking && (
                <span class="flex items-center gap-[2px] shrink-0" aria-hidden="true">
                  <span class="w-[2.5px] h-[8px] rounded-full bg-white/80 animate-[voiceBar_0.4s_ease-in-out_infinite_alternate]" />
                  <span class="w-[2.5px] h-[11px] rounded-full bg-white/80 animate-[voiceBar_0.4s_ease-in-out_0.15s_infinite_alternate]" />
                  <span class="w-[2.5px] h-[6px] rounded-full bg-white/80 animate-[voiceBar_0.4s_ease-in-out_0.3s_infinite_alternate]" />
                </span>
              )}
              {peer.name}
            </div>
          </div>
        );
      })}
    </div>
  );
}
