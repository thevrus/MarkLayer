import { signal } from '@preact/signals';

/** "This page" as drafts, page errors and saved rooms mean it: the address minus its hash, read when asked so an SPA route counts. */
export const pageUrl = (href: string = location.href): string => href.split('#')[0] ?? href;

/**
 * The page an annotation is actually about.
 *
 * The extension is injected into that page, so `location.href` is already right
 * and it leaves this null. The web viewer is a wrapper around a *proxied* page,
 * where `location.href` is the share URL — so it sets this to the page it framed,
 * or every comment records where it was read instead of what it was about.
 */
export const annotatedUrl = signal<string | null>(null);
