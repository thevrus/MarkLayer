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
        // Named rather than matched by shape: style.css styles `.ml-root`, and
        // the container is the only element the app owns directly under the
        // shadow root. A `:host > :not(style)` rule would key the overlay's
        // geometry and type on WXT's private structure instead.
        container.classList.add('ml-root');
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
