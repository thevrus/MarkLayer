import { ORIGIN } from '@marklayer/brand';
import type { DraftStore, DraftStoreOptions } from './drafts';
import type { DrawOp } from './types';

/** Where a person's name, colour and client id live between visits. */
export interface StoredIdentity {
  name?: string | null;
  color?: string | null;
  id?: string | null;
}
export interface IdentityStore {
  load: () => StoredIdentity;
  save: (identity: StoredIdentity) => void;
}

/** What a room does for the people in it, beyond syncing. A host opts in, so an embed on a stranger's site stays quiet. */
export interface RoomFx {
  arrived: (args: { ops: DrawOp[]; room: string }) => void;
  opReceived: (args: { op: DrawOp; room: string }) => void;
  peerJoined: (name: string) => void;
  peerLeft: (name: string) => void;
  ripple: (ripple: { peerId: string; color: string; x: number; y: number }) => void;
  reset: () => void;
}

/**
 * Booleans say what a host allows. Implementations are passed in rather than imported
 * by the kernel, so a host that leaves one out does not bundle it: that is what keeps
 * IndexedDB, tab capture, audio and the `ml-*` identity keys out of the widget.
 */
export interface HostCapabilities {
  /** Whether MarkLayer may read and write this origin's localStorage. */
  persist: boolean;
  share: boolean;
  contextMenu: boolean;
  /** Whether this person may delete annotations and change their status. */
  triage: boolean;
  batch: boolean;
  drafts?: (options: DraftStoreOptions) => DraftStore;
  capture?: (crop: { x: number; y: number; width: number; height: number }) => Promise<ImageBitmap>;
  identity?: IdentityStore;
  fx?: RoomFx;
}

export interface HostActions {
  /** Runs the host's share flow. Absent, the Share control raises `showShareDialog`. */
  onShare?: () => void;
  /** Each op this person makes in this tab: never one from a room (their other tab included), a redo, or a seeded demo op. */
  onOpMade?: (op: DrawOp) => void;
}

const DEFAULT_CAPABILITIES: HostCapabilities = {
  persist: true,
  share: true,
  contextMenu: true,
  triage: true,
  batch: false,
};

/** Set once by `initHost`, before anything renders, and never read as reactive state. */
export const host: { origin: string; capabilities: HostCapabilities; actions: HostActions } = {
  origin: ORIGIN,
  capabilities: DEFAULT_CAPABILITIES,
  actions: {},
};

export function configureHost({
  origin = ORIGIN,
  capabilities,
  actions = {},
}: {
  origin?: string;
  capabilities?: Partial<HostCapabilities>;
  actions?: HostActions;
}) {
  host.origin = origin;
  host.capabilities = { ...DEFAULT_CAPABILITIES, ...capabilities };
  host.actions = actions;
}
