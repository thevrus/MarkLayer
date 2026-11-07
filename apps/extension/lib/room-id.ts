import { signal } from '@preact/signals';
import { nanoid } from 'nanoid';
import { connectionStatus } from './presence';

/** The room this canvas is bound to, or null while it is purely local. Written on
 * join or first share, never during render, so reading the id opens no socket. */
export const activeRoomId = signal<string | null>(null);

/** The id the first share will use. Held apart from `activeRoomId` because reading it binds nothing. */
let mintedId: string | null = null;
/** Whether this browser joined the current room rather than minting it. */
let joined = false;

/** Bind this browser to a room someone else's ops already live in. */
export function setAnnotationId(id: string) {
  activeRoomId.value = id;
  joined = true;
}

/** The room id every share surface addresses (generates one if needed). */
export function getRoomId(): string {
  const active = activeRoomId.peek();
  if (active) return active;
  mintedId ??= nanoid();
  return mintedId;
}

/** A room's ops are not all ours to replace, so anything wholesale asks this first. */
export const isJoinedRoom = (): boolean => joined;

/** Whether this browser is the room's only writer — it minted the id and no live
 * socket is carrying anyone else's ops. Read by every guard, so none can drift. */
export function canPushSnapshot(): boolean {
  return !joined && connectionStatus.peek() === null;
}

/** Test-only: room identity is a module singleton, so a spec needs a way back to zero. */
export function resetRoomIdentity() {
  activeRoomId.value = null;
  mintedId = null;
  joined = false;
}
