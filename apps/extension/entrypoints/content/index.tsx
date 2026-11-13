import { App } from '../../components/App';
import { shootViewport } from '../../lib/capture';
import { createDraftStore } from '../../lib/drafts';
import { initHost } from '../../lib/host';
import { localIdentity } from '../../lib/identity-store';
import { isToggleMessage } from '../../lib/messages';
import { listenForNetworkErrors } from '../../lib/net-errors';
import { restoreDraft } from '../../lib/ops';
import { mountOverlay, OVERLAY_TAG, overlayHost, pageHasMarkLayer } from '../../lib/overlay-mount';
import { listenForPageErrors } from '../../lib/page-errors';
import { presenceFx } from '../../lib/presence-fx';
import { visible } from '../../lib/ui-state';
import './style.css';

export default defineContentScript({
  matches: [],
  registration: 'runtime',
  cssInjectionMode: 'ui',

  async main(ctx) {
    // Skip injection where MarkLayer is already on the page, the web app or the widget.
    if (pageHasMarkLayer() || overlayHost()) return;

    initHost({
      capabilities: {
        batch: true,
        capture: shootViewport,
        drafts: createDraftStore,
        fx: presenceFx,
        identity: localIdentity,
      },
    });

    visible.value = true;
    restoreDraft();
    listenForPageErrors();
    listenForNetworkErrors();

    browser.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (!isToggleMessage(msg)) return;
      visible.value = !visible.value;
      // The background injects when its message fails, so answer: silence is not a promised success.
      sendResponse(true);
    });

    let unmount: (() => void) | undefined;

    const ui = await createShadowRootUi(ctx, {
      name: OVERLAY_TAG,
      // Both of WXT's styling conveniences are declined: `applyPosition` sets
      // `position: relative` inline on the host, and an unset `inheritStyles`
      // prepends `:host{all:initial !important}`. Each silently outranked the
      // `:host` block in style.css, which owns the host's geometry, z-index and
      // type — a top-layer popover that is not `fixed` slid by one scroll
      // offset, and the overlay rendered in the browser's default serif.
      position: 'inline',
      inheritStyles: true,
      // Mount on <html>, not <body>. A transform (or filter, or `contain`) on
      // body makes it the containing block for `position: fixed`, so every
      // fixed layer we own — toolbar, tooltips, panels — was laid out against
      // the document instead of the viewport and ended up at the page's bottom,
      // out of view. `translateZ(0)` on body is common enough that this is not
      // an edge case.
      anchor: 'html',
      append: 'last',
      onMount(container) {
        unmount = mountOverlay({ container, app: <App /> });
        return container;
      },
      onRemove() {
        unmount?.();
      },
    });
    ui.mount();
  },
});
