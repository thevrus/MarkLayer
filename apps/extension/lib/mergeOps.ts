import type { DrawOp } from './types';

/**
 * Union two op lists by id, remote first. A shared id keeps the remote copy: once
 * a room exists, the server is the trusted one.
 */
export function mergeOps({ local, remote }: { local: DrawOp[]; remote: DrawOp[] }): DrawOp[] {
  const remoteIds = new Set(remote.map((op) => op.id));
  const localOnly = local.filter((op) => !remoteIds.has(op.id));
  return [...remote, ...localOnly];
}
