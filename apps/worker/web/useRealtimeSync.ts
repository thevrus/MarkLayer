import { connectRoom } from '@ext/lib/realtime';
import { useEffect } from 'preact/hooks';
import { capture } from './analytics';
import { canEditFromRoom, followingPeer, isReadonly, onFollowScroll, onPresentChange, presenting } from './signals';
import { noteSupportSignal } from './support';

export {
  activeRipples,
  connected,
  createdAt,
  emitRipple,
  expiresAt,
  isOwned,
  localPeerId,
  onRtcMessage,
  peerCursorSamples,
  serverUrl,
  serverWidth,
  turnIceServers,
  wsSend,
} from '@ext/lib/realtime';

export function useRealtimeSync(annotationId: string) {
  useEffect(() => {
    return connectRoom({
      roomId: annotationId,
      origin: location.origin,
      hooks: {
        canEditFromRoom,
        isReadonly,
        followingPeer,
        onFollowScroll,
        presenting,
        onPresentChange,
        capture,
        noteSupportSignal,
      },
    });
  }, [annotationId]);
}
