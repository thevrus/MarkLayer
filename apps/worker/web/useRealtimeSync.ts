import { connectRoom } from '@ext/lib/realtime';
import { useEffect } from 'preact/hooks';
import { viewerRoomMessages } from './room-messages';
import { presenting } from './ui-state';
import { urlForcesReadonly } from './viewer-state';

export function useRealtimeSync(annotationId: string) {
  useEffect(() => {
    const disconnect = connectRoom({
      roomId: annotationId,
      origin: location.origin,
      hooks: {
        forcedReadonly: urlForcesReadonly,
        onMessage: viewerRoomMessages(),
        // The page route owns the password prompt; reloading hands the visitor to it.
        onLocked: () => location.reload(),
      },
    });
    return () => {
      disconnect();
      // Presenting cannot outlive the socket that carries it. Followers are
      // released by the peer_leave this disconnect triggers on their side.
      presenting.value = false;
    };
  }, [annotationId]);
}
