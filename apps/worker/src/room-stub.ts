import type { AgentJoin, AgentSnapshot, AgentWatchRequest, AgentWatchResult, ClientMsg } from '@marklayer/types/wire';

/** The REST save's two forms. Merge only adds: its caller's list may be stale, so it can neither undo nor revert. */
export type SaveMode = 'replace' | 'merge';

/**
 * A room as the Worker's routes reach it. The real `DurableObjectStub<AnnotationRoom>`
 * satisfies this; a test's fake does too without carrying the runtime's RPC brands.
 */
export interface RoomStub {
  fetch(request: Request): Promise<Response>;
  join(peer: { id: string; uid: string; name: string; color: string }): Promise<AgentJoin>;
  snapshot(): Promise<AgentSnapshot>;
  send(msg: ClientMsg): Promise<boolean>;
  watch(request: AgentWatchRequest): Promise<AgentWatchResult>;
  saveOps(change: { ops: unknown[]; userId: string | undefined; mode: SaveMode }): Promise<boolean>;
  reset(): Promise<void>;
  refreshAccess(): Promise<void>;
  revoke(gen: number): Promise<void>;
}

export interface RoomNamespace {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): RoomStub;
}
