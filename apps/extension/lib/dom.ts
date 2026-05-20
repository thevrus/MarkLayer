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
