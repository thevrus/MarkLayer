// Thin component wrapper so the WebRTC engine can be lazy-loaded by Viewer.
// Rendered only when voiceActive or videoActive flips true; unmounting tears
// down peer connections via the hook's effect cleanup.

import { useVoiceRoom } from './useVoiceRoom';

export default function VoiceEngine({ localPeerId }: { localPeerId: string }) {
  useVoiceRoom(localPeerId);
  return null;
}
