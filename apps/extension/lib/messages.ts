/** Messages between the extension's background worker and its content script. The one definition of both names. */
export const TOGGLE_ANNOTATE = 'toggle-annotate';
export const CAPTURE_ELEMENT = 'capture-element';

export const isToggleMessage = (msg: unknown): boolean =>
  typeof msg === 'object' && msg !== null && 'type' in msg && msg.type === TOGGLE_ANNOTATE;
