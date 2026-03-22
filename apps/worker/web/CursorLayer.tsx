import { peers } from '@ext/lib/state';
import { useEffect, useRef } from 'preact/hooks';
import { CursorArrow } from './CursorArrow';
import { followingPeer } from './signals';
import { peerVideoStreams, voiceSpeaking } from './useVoiceRoom';

interface Props {
  scale: number;
  scrollY: number;
}

/** Attaches a MediaStream to a <video> element via ref — avoids re-mounting on cursor moves */
function PeerVideo({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted
      class="w-8 h-8 rounded-full object-cover shrink-0 ring-2 ring-white/30"
    />
  );
}

export function CursorLayer({ scale: s, scrollY }: Props) {
  const peerMap = peers.value;
  if (peerMap.size === 0) return null;

  const speaking = voiceSpeaking.value;
  const following = followingPeer.value;
  const videoStreams = peerVideoStreams.value;

  return (
    <div class="absolute inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 999 }}>
      {Array.from(peerMap.values()).map((peer) => {
        if (!peer.cursor) return null;
        const vx = peer.cursor.x * s;
        const vy = peer.cursor.y * s - scrollY;
        const isSpeaking = speaking.has(peer.id);
        const isFollowing = following === peer.id;
        const videoStream = videoStreams.get(peer.id);

        return (
          <div key={peer.id} class="absolute transition-[left,top] duration-75 ease-out" style={{ left: vx, top: vy }}>
            <CursorArrow color={peer.color} />
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
              {videoStream && <PeerVideo stream={videoStream} />}
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
