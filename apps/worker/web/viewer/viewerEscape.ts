import { dismissTop } from '@ext/lib/keymap';
import { activeTool, handTool } from '@ext/lib/tool-state';
import { toggleUiHidden, uiHidden } from '@ext/lib/ui-state';
import { isReadonly } from '../viewer-state';

/**
 * Escape unwinds one level at a time: hidden chrome, the newest surface, the hand, the tool.
 * The first two sit above the read-only bail because a guest can reach them too.
 */
export function viewerEscape(e: Pick<KeyboardEvent, 'target' | 'preventDefault'>) {
  // An open menu takes its own Escape; the surface under it closes on the next one.
  if (e.target instanceof Element && e.target.closest('[role="menu"]')) return;
  e.preventDefault();
  if (uiHidden.value) {
    toggleUiHidden();
    return;
  }
  if (dismissTop() || isReadonly.value) return;
  if (handTool.value) {
    handTool.value = false;
    return;
  }
  activeTool.value = 'navigate';
}
