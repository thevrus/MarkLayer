import { peers } from '@ext/lib/state';
import { CursorArrow } from './CursorArrow';

interface Props {
  scale: number;
  scrollY: number;
}

export function CursorLayer({ scale: s, scrollY }: Props) {
  const peerMap = peers.value;
  if (peerMap.size === 0) return null;

  return (
    <div class="absolute inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 999 }}>
      {Array.from(peerMap.values()).map((peer) => {
        if (!peer.cursor) return null;
        const vx = peer.cursor.x * s;
        const vy = peer.cursor.y * s - scrollY;
        // Off-screen — skip rendering
        if (vx < -50 || vy < -50 || vx > innerWidth + 50 || vy > innerHeight + 50) return null;

        return (
          <div key={peer.id} class="absolute transition-[left,top] duration-75 ease-out" style={{ left: vx, top: vy }}>
            <CursorArrow color={peer.color} />
            {/* Name label */}
            <div
              class="absolute left-5 top-6 whitespace-nowrap rounded-full px-3 py-1.5 text-[13px] font-semibold text-white leading-none shadow-sm"
              style={{ background: peer.color, boxShadow: `0 2px 8px ${peer.color}40` }}
            >
              {peer.name}
            </div>
          </div>
        );
      })}
    </div>
  );
}
