import { render } from 'preact';
import { App } from '../../components/App';
import { listenForPageErrors } from '../../lib/page-errors';
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
    listenForPageErrors();

    // Listen for toggle message from background script (subsequent icon clicks)
    browser.runtime.onMessage.addListener((msg) => {
      if (msg?.type === 'toggle-annotate') {
        visible.value = !visible.value;
      }
    });

    let zoomWatch: MutationObserver | undefined;
    let zoomFrame = 0;

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
        if (host instanceof HTMLElement) {
          // A page `zoom` on <html> compounds into the host, drawing every layer
          // at that multiple of its viewport-sized buffer. `zoom: 1` can't undo
          // it (nested zooms multiply); the inverse does.
          const unzoom = () => {
            const z = Number.parseFloat(getComputedStyle(document.documentElement).zoom);
            host.style.zoom = z > 0 ? String(1 / z) : '';
          };
          unzoom();
          // One style read per frame: pages that churn <html> classes would force a recalc per batch.
          zoomWatch = new MutationObserver(() => {
            if (zoomFrame) return;
            zoomFrame = requestAnimationFrame(() => {
              zoomFrame = 0;
              unzoom();
            });
          });
          zoomWatch.observe(document.documentElement, { attributeFilter: ['style', 'class'] });
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
        zoomWatch?.disconnect();
        cancelAnimationFrame(zoomFrame);
        portalContainer.value = null;
        if (container) render(null, container);
      },
    });
    ui.mount();
  },
});
