/**
 * Force a crosshair cursor across an entire document while a tool is active.
 * `!important` is required to beat page CSS that targets links/buttons/inputs.
 * Returns a cleanup that removes the style — meant to be returned from useSignalEffect.
 */
export function injectCrosshairCursor(doc: Document | null | undefined): (() => void) | undefined {
  if (!doc?.head) return;
  const style = doc.createElement('style');
  style.textContent = '*, *::before, *::after { cursor: crosshair !important; }';
  doc.head.appendChild(style);
  return () => style.remove();
}

/**
 * The editable element a key event is aimed at, if any. The composed path sees through the
 * open shadow root our UI lives in, so the overlay's own fields count as well as the page's.
 */
export function editableTarget(e: KeyboardEvent): HTMLElement | null {
  const t = e.composedPath()[0];
  if (!(t instanceof HTMLElement)) return null;
  const tag = t.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable) return t;
  return null;
}
