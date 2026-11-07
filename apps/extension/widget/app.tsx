/// <reference types="vite/client" />
import { effect } from '@preact/signals';
import css from '../entrypoints/content/style.css?inline';
import { initHost } from '../lib/host';
import { mountOverlay, OVERLAY_TAG, overlayHost } from '../lib/overlay-mount';
import { joinRoom } from '../lib/room';
import { toast } from '../lib/toasts';
import { activeTool } from '../lib/tool-state';
import { visible } from '../lib/ui-state';
import { adoptStyles } from './styles';
import { WidgetApp } from './WidgetApp';

export interface WidgetController {
  toggle: () => void;
}

/**
 * Mounts the overlay on this page bound to `roomId`, or resolves null when the room
 * will not load or the extension already has this page. `onCommentingChange` lets the
 * loader's button follow Escape.
 */
export async function start({
  roomId,
  onCommentingChange,
}: {
  roomId: string;
  onCommentingChange: (on: boolean) => void;
}): Promise<WidgetController | null> {
  if (overlayHost()) return null;
  // A visitor on a customer's site: their localStorage is not ours, and the owner triages.
  // The bundle talks to whichever origin served it, so a dev worker works unchanged.
  initHost({
    origin: new URL(import.meta.url).origin,
    capabilities: { persist: false, contextMenu: false, triage: false },
  });
  if (!(await joinRoom({ id: roomId }))) return null;

  // By name: the element picker and theme sync both look the host up by tag.
  const hostEl = document.createElement(OVERLAY_TAG);
  const root = hostEl.attachShadow({ mode: 'open' });
  adoptStyles({ root, css });
  const container = document.createElement('div');
  root.append(container);
  // On <html> for the reasons spelled out in entrypoints/content/index.tsx.
  document.documentElement.append(hostEl);

  visible.value = true;
  mountOverlay({ container, app: <WidgetApp /> });
  effect(() => onCommentingChange(activeTool.value === 'comment'));

  return {
    toggle: () => {
      const on = activeTool.peek() !== 'comment';
      activeTool.value = on ? 'comment' : 'navigate';
      if (on) toast('Click anything on the page to comment on it');
    },
  };
}
