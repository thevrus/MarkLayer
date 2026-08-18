import { signal } from '@preact/signals';

/**
 * Where Base UI portals (popups, dialogs, tooltips) should render.
 *
 * The extension mounts inside a shadow root, so portals must target a node in
 * that root — portaling to document.body would drop popups outside the
 * injected stylesheet and under the host page's stacking context. The content
 * script sets this at mount. The web app leaves it null and Base UI falls back
 * to its default (document.body), where global styles apply.
 */
export const portalContainer = signal<HTMLElement | null>(null);
