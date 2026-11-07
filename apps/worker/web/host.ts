import type { HostActions } from '@ext/lib/host-config';
import { localIdentity } from '@ext/lib/identity-store';
import { presenceFx } from '@ext/lib/presence-fx';

/**
 * The web app runs on our own origin and keeps every other default. What a surface does
 * with sharing is an argument so that the dashboard, which has no room, imports no room code.
 */
export const webHost = ({ share = false, actions }: { share?: boolean; actions?: HostActions } = {}) => ({
  origin: location.origin,
  capabilities: { identity: localIdentity, fx: presenceFx, share },
  actions,
});
