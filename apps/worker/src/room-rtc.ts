import type { RtcMessageType } from '@marklayer/types/wire';
import type { PeerInfo } from './peers';

/** Forward one SDP/ICE message, verbatim, to the peer it names. */
export function relayRtc({
  sockets,
  peerOf,
  from,
  msg,
}: {
  sockets: WebSocket[];
  peerOf: (ws: WebSocket) => PeerInfo | null;
  from: PeerInfo;
  msg: { type: RtcMessageType; to: string };
}): void {
  for (const sock of sockets) {
    if (peerOf(sock)?.id === msg.to && sock.readyState === WebSocket.OPEN) {
      sock.send(JSON.stringify({ ...msg, from: from.id }));
      return;
    }
  }
}
