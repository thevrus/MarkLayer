import { useSignalEffect } from '@preact/signals';
import { host } from './host-config';
import { mergeOps } from './mergeOps';
import { operations } from './ops';
import { connectRoom } from './realtime';
import { activeRoomId, setAnnotationId } from './room-id';
import { loadAnnotations } from './share';

/** Point this browser at an existing room and fold its ops in. Merged, not assigned:
 * a joiner has usually drawn something already, and replacing it has no undo. */
export async function joinRoom({ id }: { id: string }): Promise<boolean> {
  const remote = await loadAnnotations(id);
  if (!remote) return false;
  operations.value = mergeOps({ local: operations.value, remote });
  // Bound only once the room answers: a typo'd id would otherwise become the next share's target.
  setAnnotationId(id);
  return true;
}

/** Binds a room to a live connection for as long as one is set. */
export function useRoomConnection() {
  useSignalEffect(() => {
    const id = activeRoomId.value;
    if (!id) return;
    return connectRoom({ roomId: id, origin: host.origin });
  });
}
