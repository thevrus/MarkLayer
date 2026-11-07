import { computed, signal } from '@preact/signals';
import type { Peer } from './types';

/**
 * Realtime sync status. `null` = no room joined (extension on a normal page).
 * Set by `connectRoom`; the toolbar shows a pulse dot when non-null.
 */
export type ConnectionStatus = null | 'connecting' | 'connected' | 'disconnected';
export const connectionStatus = signal<ConnectionStatus>(null);

export const peers = signal<Map<string, Peer>>(new Map());
/** Total peers including self (peers map excludes local user) */
export const peerCount = computed(() => peers.value.size + 1);

/** Someone who was in the room and is not now. */
export interface DepartedPeer {
  id: string;
  name: string;
  color: string;
  leftAt: number;
}
/**
 * Kept so presence can still say who was here after they go — a `peer_leave`
 * otherwise drops the only record that they ever were. Newest first, and short:
 * this answers "did I just miss them", not "who visited this week".
 */
export const departedPeers = signal<DepartedPeer[]>([]);
const MAX_DEPARTED = 6;

export function noteDeparture(peer: DepartedPeer) {
  departedPeers.value = [peer, ...departedPeers.value.filter((p) => p.id !== peer.id)].slice(0, MAX_DEPARTED);
}

/** They are back — presence reads the live list for them now. */
export function clearDeparture(peerId: string) {
  if (departedPeers.value.some((p) => p.id === peerId)) {
    departedPeers.value = departedPeers.value.filter((p) => p.id !== peerId);
  }
}

export const onCursorMove = signal<((x: number, y: number, tool: string) => void) | null>(null);
