import { computed, signal, useSignalEffect } from '@preact/signals';
import { mergeOps } from './mergeOps';
import { connectRoom } from './realtime';
import { APP_ORIGIN, loadAnnotations, setAnnotationId } from './share';
import { operations } from './state';

/** The room this canvas is bound to, or null while it is purely local. Written on
 * join or first share, never during render, so reading the id opens no socket. */
export const activeRoomId = signal<string | null>(null);

/** What the room says about our write access. Undefined until it says. */
export const canEditFromRoom = signal<boolean | undefined>(undefined);

/** No `?readonly=1` to OR in as the web viewer has, so the room is the only word on it. */
export const isReadonly = computed(() => canEditFromRoom.value === false);

/** Point this browser at an existing room and fold its ops in. Merged, not assigned:
 * a joiner has usually drawn something already, and replacing it has no undo. */
export async function joinRoom({ id }: { id: string }): Promise<boolean> {
  setAnnotationId(id);
  const remote = await loadAnnotations(id);
  if (!remote || !Array.isArray(remote)) return false;
  operations.value = mergeOps({ local: operations.value, remote });
  activeRoomId.value = id;
  return true;
}

/** Binds a room to a live connection for as long as one is set. */
export function useRoomConnection() {
  useSignalEffect(() => {
    const id = activeRoomId.value;
    if (!id) return;
    return connectRoom({ roomId: id, origin: APP_ORIGIN, hooks: { canEditFromRoom, isReadonly } });
  });
}
