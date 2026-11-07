import { type ComponentChild, render } from 'preact';
import { portalContainer } from './portal';

export const OVERLAY_TAG = 'mark-layer';
/** The widget loader's own button. It is ours, so nothing may target it or photograph it. */
export const FEEDBACK_TAG = 'marklayer-feedback';
export const HOST_TAGS = [OVERLAY_TAG, FEEDBACK_TAG] as const;
const HOST_SELECTOR = HOST_TAGS.join(',');

export const overlayHost = (): Element | null => document.querySelector(OVERLAY_TAG);

export const isInsideMarkLayer = (el: Element): boolean => !!el.closest?.(HOST_SELECTOR);

/** A page that already has MarkLayer on it: the web app, or a site running the widget. */
export function pageHasMarkLayer(): boolean {
  const { marklayer, marklayerWidget } = document.documentElement.dataset;
  return Boolean(marklayer || marklayerWidget);
}

/**
 * The one way an overlay enters a page, shared by the extension and the widget.
 * `container` already sits inside its shadow root. Returns the unmount.
 */
export function mountOverlay({ container, app }: { container: HTMLElement; app: ComponentChild }): () => void {
  const root = container.getRootNode();
  const hostEl = root instanceof ShadowRoot ? root.host : null;
  let zoomWatch: MutationObserver | undefined;
  let zoomFrame = 0;

  if (hostEl instanceof HTMLElement) {
    // The top layer, via a manual popover: it is laid out against the
    // viewport no matter what ancestors do (a transform on <html> defeats
    // even `position: fixed`), and it paints above any page z-index — a page
    // with its own `z-index: 2147483647` bar used to cover the toolbar.
    // `manual` so nothing light-dismisses it; Esc is ours to handle.
    if ('popover' in hostEl) {
      hostEl.popover = 'manual';
      try {
        hostEl.showPopover();
      } catch {
        // Already showing, or the element is not connected yet — the CSS
        // still positions the overlay correctly either way.
      }
    }
    // A page `zoom` on <html> compounds into the host, drawing every layer
    // at that multiple of its viewport-sized buffer. `zoom: 1` can't undo
    // it (nested zooms multiply); the inverse does.
    const unzoom = () => {
      const z = Number.parseFloat(getComputedStyle(document.documentElement).zoom);
      hostEl.style.zoom = z > 0 ? String(1 / z) : '';
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

  // Named rather than matched by shape: style.css styles `.ml-root`, and the
  // container is the only element the app owns directly under the shadow root.
  container.classList.add('ml-root');
  portalContainer.value = container;
  render(app, container);

  return () => {
    zoomWatch?.disconnect();
    cancelAnimationFrame(zoomFrame);
    portalContainer.value = null;
    render(null, container);
  };
}
