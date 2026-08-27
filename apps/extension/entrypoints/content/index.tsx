import { render } from 'preact';
import { App } from '../../components/App';
import { portalContainer } from '../../lib/portal';
import { restoreDraft, visible } from '../../lib/state';
import './style.css';

export default defineContentScript({
  matches: [],
  registration: 'runtime',
  cssInjectionMode: 'ui',

  async main(ctx) {
    // Skip injection when inside the MarkLayer web app (it has its own toolbar)
    if (document.documentElement.dataset.marklayer) return;

    // Injected on-demand via icon click — show immediately
    visible.value = true;
    restoreDraft();

    // Listen for toggle message from background script (subsequent icon clicks)
    browser.runtime.onMessage.addListener((msg) => {
      if (msg?.type === 'toggle-annotate') {
        visible.value = !visible.value;
      }
    });

    const ui = await createShadowRootUi(ctx, {
      name: 'mark-layer',
      position: 'overlay',
      // Mount on <html>, not <body>. A transform (or filter, or `contain`) on
      // body makes it the containing block for `position: fixed`, so every
      // fixed layer we own — toolbar, tooltips, panels — was laid out against
      // the document instead of the viewport and ended up at the page's bottom,
      // out of view. `translateZ(0)` on body is common enough that this is not
      // an edge case.
      anchor: 'html',
      append: 'last',
      // Without this the host sits at `z-index: auto`, so it only beat page
      // content on DOM order — and anything the page appended after we mounted
      // (lazily-inserted headers, banners) painted straight over the toolbar
      // while the page was still loading. The overlay owns the top of the page.
      zIndex: 2147483647,
      onMount(container) {
        // The top layer, via a manual popover: it is laid out against the
        // viewport no matter what ancestors do (a transform on <html> defeats
        // even `position: fixed`), and it paints above any page z-index — a page
        // with its own `z-index: 2147483647` bar used to cover the toolbar.
        // `manual` so nothing light-dismisses it; Esc is ours to handle.
        const root = container.getRootNode();
        const host = root instanceof ShadowRoot ? root.host : null;
        if (host instanceof HTMLElement && 'popover' in host) {
          host.popover = 'manual';
          try {
            host.showPopover();
          } catch {
            // Already showing, or the element is not connected yet — the CSS
            // below still positions the overlay correctly either way.
          }
        }
        portalContainer.value = container;
        render(<App />, container);
        return container;
      },
      onRemove(container) {
        portalContainer.value = null;
        if (container) render(null, container);
      },
    });
    ui.mount();
  },
});
