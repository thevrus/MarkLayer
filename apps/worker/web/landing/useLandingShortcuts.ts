import { activeTool, redo, showAnnotationPanel, showShareDialog, toolForKeyEvent, undo } from '@ext/lib/state';
import { useEffect } from 'preact/hooks';

/**
 * The page's keyboard layer: the product's own tool shortcuts, plus undo/redo.
 *
 * Raw `keydown` rather than tinykeys, deliberately and unlike the rest of the
 * app: this has to defer to whatever the visitor is typing into the URL field,
 * so it needs the event target before it decides anything, and `toolForKeyEvent`
 * already owns the tool mapping.
 */
export function useLandingShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;
      const tag = target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
        if (e.key === 'Escape') target.blur();
        return;
      }
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'z' && !e.shiftKey) {
          e.preventDefault();
          undo();
          return;
        }
        if (e.key === 'y' || (e.shiftKey && (e.key === 'z' || e.key === 'Z'))) {
          e.preventDefault();
          redo();
          return;
        }
      }
      const m = toolForKeyEvent(e);
      if (m) {
        activeTool.value = m;
        e.preventDefault();
        return;
      }
      if (e.key === 'Escape') {
        if (showShareDialog.value) {
          showShareDialog.value = false;
          e.preventDefault();
          return;
        }
        if (showAnnotationPanel.value) {
          showAnnotationPanel.value = false;
          e.preventDefault();
          return;
        }
        activeTool.value = 'navigate';
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
