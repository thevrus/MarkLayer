import { useSignalEffect } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { ensureHostMutationObserver, ensureScrollTickListener } from '../lib/host-mutations';
import { overlayHost } from '../lib/overlay-mount';
import { theme } from '../lib/prefs';
import { useRoomConnection } from '../lib/room';
import { trackPageScroller } from '../lib/scroller';

/** What every overlay on a live page needs, shared by the extension's App and the embeddable widget. */
export function useOverlayHost() {
  // One rAF-coalesced scroll listener and one host MutationObserver feed every layer
  // that repositions on scroll or re-resolves selectors on reflow / SPA routing.
  useEffect(() => {
    ensureScrollTickListener();
    ensureHostMutationObserver();
    trackPageScroller();
  }, []);

  useRoomConnection();

  useSignalEffect(() => {
    const t = theme.value;
    const host = overlayHost();
    if (!host) return;
    host.classList.remove('ml-dark', 'ml-light');
    t !== 'system' && host.classList.add(t === 'dark' ? 'ml-dark' : 'ml-light');
  });
}
