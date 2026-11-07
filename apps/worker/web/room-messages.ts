import { peers } from '@ext/lib/presence';
import { toast } from '@ext/lib/toasts';
import { isAgentPeer } from '@marklayer/types/agents';
import type { ServerMsg } from '@marklayer/types/wire';
import { noteSupportSignal } from './support';
import { followingPeer, onFollowScroll } from './ui-state';

const FOLLOW_SCROLL_MS = 200;

/** What the viewer alone makes of room frames: follow, presenting and the agent signal. One per connection. */
export function viewerRoomMessages(): (msg: ServerMsg) => void {
  let lastFollowScroll = Number.NEGATIVE_INFINITY;

  return (msg) => {
    switch (msg.type) {
      case 'init':
        // An agent in the room means someone wired the MCP server into real work.
        if (msg.peers?.some((p) => isAgentPeer(p.id))) noteSupportSignal('mcp');
        break;
      case 'peer_join':
        if (isAgentPeer(msg.peer.id)) noteSupportSignal('mcp');
        break;
      case 'cursor': {
        const now = performance.now();
        if (followingPeer.value !== msg.peerId || now - lastFollowScroll < FOLLOW_SCROLL_MS) break;
        lastFollowScroll = now;
        onFollowScroll.value?.(msg.y);
        break;
      }
      case 'flock': {
        const who = peers.value.get(msg.peerId)?.name || msg.name || 'Someone';
        if (msg.on) {
          followingPeer.value = msg.peerId;
          // Say why the page just moved, or being pulled reads as a bug.
          toast(`${who} is presenting — scroll to break away`, { type: 'info', duration: 4000 });
        } else if (followingPeer.value === msg.peerId) {
          followingPeer.value = null;
          toast(`${who} stopped presenting`, { type: 'info', duration: 2500 });
        }
        break;
      }
      case 'peer_leave':
        if (followingPeer.value === msg.peerId) followingPeer.value = null;
        break;
    }
  };
}
