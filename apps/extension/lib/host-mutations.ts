import { signal } from '@preact/signals';

/**
 * Bumped at most once per animation frame on host-page scroll OR resize.
 * Components whose layout depends on `scrollX/scrollY` (CommentPin, AreaShape,
 * SelectionHighlight) subscribe via `scrollTick.value` to reposition.
 *
 * Single shared listener — `ensureScrollTickListener()` attaches once on
 * first call (idempotent) and never detaches; `passive: true` keeps scroll
 * cheap, and rAF coalesces bursts so re-renders track frames, not events.
 * The same coalesced handler also covers `resize`: a pure CSS reflow from a
 * window resize doesn't move `scrollX/scrollY` and never fires a `scroll`
 * event, so anchored pins would otherwise go stale until the next scroll.
 *
 * `capture: true` is load-bearing, not a style choice. A `scroll` event fired
 * at an ELEMENT does not bubble, so a bubble-phase listener on `window` sees
 * only the document's own scrolling. Any page that scrolls an inner container
 * instead — an app shell, a dashboard, most docs layouts — ticked never, and
 * every subscriber (the canvas, comment pins, area shapes, selection
 * highlights) kept painting at stale coordinates while the content moved out
 * from under them. Capture runs window → target, so it sees all of them.
 */
export const scrollTick = signal(0);
let _scrollListenerAttached = false;
let _scrollRaf = 0;
export function ensureScrollTickListener() {
  if (_scrollListenerAttached || typeof window === 'undefined') return;
  _scrollListenerAttached = true;
  const onScroll = () => {
    if (_scrollRaf) return;
    _scrollRaf = requestAnimationFrame(() => {
      _scrollRaf = 0;
      scrollTick.value++;
    });
  };
  window.addEventListener('scroll', onScroll, { passive: true, capture: true });
  window.addEventListener('resize', onScroll, { passive: true });
}

/**
 * Bumped (RAF-coalesced) when the host page's DOM mutates so element-
 * anchored annotations re-resolve their selectors against the new layout.
 * Mirrors the worker's `iframeMutationTick` pattern. Subscribed by the
 * same components that subscribe to `scrollTick`. Wired once via
 * `ensureHostMutationObserver()`.
 */
export const hostMutationTick = signal(0);

// DOM-change generation for anchor.ts's failed-resolution memo. A plain
// counter, not a signal: reads must never subscribe. Lives here (not in
// anchor.ts) because anchor.ts already imports this module, and both mutation
// observers — the host-page one below and the web iframe's in
// apps/worker/web/viewer-state.ts — bump it.
let _anchorGeneration = 0;
export const anchorGeneration = (): number => _anchorGeneration;
export const bumpAnchorGeneration = (): void => {
  _anchorGeneration++;
};
let _hostObserverAttached = false;
let _hostObserver: MutationObserver | null = null;
let _hostMutRaf = 0;
export function ensureHostMutationObserver() {
  if (_hostObserverAttached || typeof window === 'undefined' || typeof MutationObserver === 'undefined') return;
  _hostObserverAttached = true;
  _hostObserver = new MutationObserver(() => {
    if (_hostMutRaf) return;
    _hostMutRaf = requestAnimationFrame(() => {
      _hostMutRaf = 0;
      bumpAnchorGeneration();
      hostMutationTick.value++;
    });
  });
  // characterData omitted: text-only edits don't move element rects, and
  // observing them turns idle pages with live tickers into per-frame
  // mutation streams. childList + attributes covers the cases our
  // selector resolution actually cares about.
  _hostObserver.observe(document.body, { subtree: true, childList: true, attributes: true });
}
