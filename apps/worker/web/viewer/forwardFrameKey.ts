import type { FrameMessage } from '../../shared/frame-protocol';

/**
 * Replays a key pressed inside the frame on the host window, where the keymap listens.
 * A press aimed at a field in the page stays the page's. Its release still crosses, or a
 * modifier held since before the field took focus would stick.
 */
export function forwardFrameKey({
  message,
  host,
}: {
  message: Extract<FrameMessage, { type: 'ml-key' }>;
  host: Pick<EventTarget, 'dispatchEvent'>;
}) {
  if (message.phase === 'keydown' && message.editable) return;
  const { phase, key, code, metaKey, ctrlKey, shiftKey, altKey } = message;
  host.dispatchEvent(new KeyboardEvent(phase, { key, code, metaKey, ctrlKey, shiftKey, altKey }));
}
