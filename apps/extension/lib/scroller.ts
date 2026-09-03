/**
 * The element that scrolls a page when its document does not.
 *
 * Annotations live in "document" coordinates: viewport position plus scroll
 * offset. That assumed the document is what scrolls. A page built as an app
 * shell — `html, body { height: 100% }` and one `overflow: auto` container
 * holding everything — never moves `window.scrollY`, so every mark was stored
 * at its viewport position and drawn there forever: the content scrolled out
 * from under the drawings while they stayed put. Resolving the page's real
 * scroller once and folding its offset into every read fixes both the stored
 * coordinate and the render in one place.
 *
 * Detection is by shape, not by name: the scroller is the scrollable element
 * that covers most of the viewport. Seeded from a scan at attach time (the
 * layout may still be settling, so it is cheap and may find nothing) and then
 * corrected from live `scroll` events — a capture-phase listener sees the
 * target of an element scroll, which never bubbles to `window`.
 */
const SCROLLERS = new WeakMap<Document, Element>();

/** Covers most of the viewport and actually has somewhere to scroll to. */
function isPageScroller(el: Element, win: Window): boolean {
  if (el.scrollHeight <= el.clientHeight + 1) return false;
  if (el.clientHeight < win.innerHeight * 0.6) return false;
  const { overflowY } = win.getComputedStyle(el);
  return overflowY === 'auto' || overflowY === 'scroll';
}

function documentScrolls(doc: Document, win: Window): boolean {
  const root = doc.scrollingElement ?? doc.documentElement;
  return root.scrollHeight > win.innerHeight + 1;
}

/**
 * Find the page's scroller by scanning, when the document itself does not
 * scroll. O(n) over the DOM, so this runs once per attach, not per frame.
 */
export function findPageScroller(doc: Document): Element | null {
  const win = doc.defaultView;
  if (!win) return null;
  SCROLLERS.delete(doc);
  if (documentScrolls(doc, win)) return null;
  let best: Element | null = null;
  for (const el of doc.querySelectorAll('div, main, section, article')) {
    if (!isPageScroller(el, win)) continue;
    if (!best || el.clientHeight > best.clientHeight) best = el;
  }
  if (best) SCROLLERS.set(doc, best);
  return best;
}

/**
 * Adopt the target of a capture-phase `scroll` event if it is the page's
 * scroller. Called from the listener that already fires on every scroll, so
 * the page that renders after our scan still gets found the moment it moves.
 */
export function notePageScroller(doc: Document, target: EventTarget | null): void {
  const win = doc.defaultView;
  // Cross-realm: an iframe's nodes are not the host's `Element`, so test against
  // the frame's own constructor.
  if (!win || !(target instanceof win.Element)) return;
  if (SCROLLERS.get(doc) === target) return;
  if (documentScrolls(doc, win) || !isPageScroller(target, win)) return;
  SCROLLERS.set(doc, target);
}

export function pageScroller(doc: Document): Element | null {
  return SCROLLERS.get(doc) ?? null;
}

/** The page's scroll offset: the document's own plus its scroller's, if any. */
export function scrollOffset(win: Window): { x: number; y: number } {
  const el = SCROLLERS.get(win.document);
  return {
    x: (win.scrollX || 0) + (el?.scrollLeft ?? 0),
    y: (win.scrollY || 0) + (el?.scrollTop ?? 0),
  };
}

export function scrollPageBy(win: Window, dx: number, dy: number): void {
  const el = SCROLLERS.get(win.document);
  if (el) el.scrollBy(dx, dy);
  else win.scrollBy(dx, dy);
}

export function scrollPageTo(win: Window, options: ScrollToOptions): void {
  const el = SCROLLERS.get(win.document);
  if (el) el.scrollTo(options);
  else win.scrollTo(options);
}
