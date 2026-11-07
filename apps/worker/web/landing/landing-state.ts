import { signal } from '@preact/signals';

/** True while an embedded room holds most of the screen, so the host page's own toolbar can step aside. */
export const embedInView = signal(false);

export const isMobileDevice = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) && 'ontouchstart' in window;
