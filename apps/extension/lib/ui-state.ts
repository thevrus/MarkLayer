import { signal } from '@preact/signals';
import { track, trackChanges } from './analytics';
import { host } from './host-config';
import { toast } from './toasts';
import { activeTool } from './tool-state';

export const visible = signal(false);

/**
 * Figma's hide-UI. Every piece of chrome off, the annotations left on screen.
 * Deliberately not persisted: a reload that came back with no visible UI would
 * read as the tool being broken, and the shortcut to undo it is invisible too.
 */
export const uiHidden = signal(false);

export function toggleUiHidden() {
  const next = !uiHidden.value;
  uiHidden.value = next;
  if (!next) return;
  // The way back is two shortcuts with nothing on screen pointing at either, so say it.
  toast('Interface hidden — Esc or ⌘/ to bring it back', { duration: 2600 });
  // A dialog is a transient surface, not chrome to restore later; drop it outright.
  showSettings.value = false;
  showShareDialog.value = false;
  // Drawing with the toolbar gone means no colour, no width and no way to see
  // which tool is armed, so hiding the UI drops to the move tool the way Figma does.
  activeTool.value = 'navigate';
}

/** Transient open state for the floating settings panel. Not persisted. */
export const showSettings = signal(false);

export const showShareDialog = signal(false);

/** Started by `initHost`, so importing this module changes nothing. */
export function wireUiState() {
  // Six places close this panel and two open it, so counting at the buttons could
  // never balance. The signal is the one thing they all agree on.
  trackChanges(showSettings, (open) => track('settings_panel', { open }));
}

/** What the Share control does: the host's own flow where it has one. */
export function requestShare() {
  if (host.actions.onShare) host.actions.onShare();
  else showShareDialog.value = true;
}

/**
 * Opens the support card, or null where there is no card to open.
 *
 * The settings panel is shared with the web app, but the card is web-only on
 * purpose (see apps/worker/web/support.ts: in a content script `localStorage`
 * belongs to whatever page is being annotated, so the "asked once" record would
 * scatter across every site and never be readable again). The web app sets
 * this; the extension leaves it null and the row simply is not there.
 */
export const onSupport = signal<(() => void) | null>(null);
