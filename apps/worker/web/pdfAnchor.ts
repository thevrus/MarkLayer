import type { PdfAnchor } from '@marklayer/types';

/**
 * A PDF is framed by our own viewer page, which lays every page out in normal
 * flow as an element boxed exactly to the page and tagged with its 1-based
 * number. That tag is the whole contract: it is what lets a point become a
 * page-relative fraction, and a fraction become a point again at any zoom.
 *
 * Namespaced because it doubles as "this document is a PDF": a bare `data-page`
 * is common enough on the open web (pagination, carousels) that an ordinary
 * proxied page would flip every capture onto the PDF anchor model.
 */
export const PDF_PAGE_ATTR = 'data-ml-pdf-page';
const PAGE_SELECTOR = `[${PDF_PAGE_ATTR}]`;

export function isPdfDocument(doc: Document | null | undefined): boolean {
  return Boolean(doc?.querySelector(PAGE_SELECTOR));
}

/** Only ever called on elements the selector already matched, so the attribute
 *  is present; a non-positive number is the one thing left to reject. */
function pageNumber(el: Element): number | undefined {
  const n = Number.parseInt(el.getAttribute(PDF_PAGE_ATTR) ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * The page under a client point, falling back to the vertically nearest one so
 * a mark dropped in the gutter between two pages still anchors somewhere sane
 * rather than not at all.
 */
function pageAt({ doc, clientX, clientY }: { doc: Document; clientX: number; clientY: number }): Element | undefined {
  const hit = doc.elementFromPoint(clientX, clientY)?.closest(PAGE_SELECTOR);
  if (hit) return hit;

  let best: { el: Element; gap: number } | undefined;
  for (const el of doc.querySelectorAll(PAGE_SELECTOR)) {
    const r = el.getBoundingClientRect();
    const gap = clientY < r.top ? r.top - clientY : clientY > r.bottom ? clientY - r.bottom : 0;
    if (!best || gap < best.gap) best = { el, gap };
  }
  return best?.el;
}

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Both directions of the anchor, kept clear of the DOM so the arithmetic that
 * silently misplaces every mark when it is wrong — the scroll offset's sign, the
 * normalisation — is testable on plain numbers.
 */
export function toPageFraction({ box, clientX, clientY }: { box: Box; clientX: number; clientY: number }) {
  return { x: (clientX - box.left) / box.width, y: (clientY - box.top) / box.height };
}

export function fromPageFraction({ box, anchor }: { box: Box; anchor: PdfAnchor }) {
  return { x: box.left + anchor.x * box.width, y: box.top + anchor.y * box.height };
}

/** Bind a point in the framed document's space to the PDF page under it. */
export function capturePdfAnchor({
  frame,
  x,
  y,
}: {
  frame: HTMLIFrameElement | null;
  x: number;
  y: number;
}): PdfAnchor | undefined {
  const win = frame?.contentWindow;
  const doc = frame?.contentDocument;
  if (!win || !doc) return undefined;

  const clientX = x - win.scrollX;
  const clientY = y - win.scrollY;
  const el = pageAt({ doc, clientX, clientY });
  if (!el) return undefined;
  const page = pageNumber(el);
  if (page === undefined) return undefined;

  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return undefined;
  return { page, ...toPageFraction({ box: r, clientX, clientY }) };
}

/** Project a stored anchor back into the framed document's current space. */
export function resolvePdfAnchor({
  doc,
  anchor,
}: {
  doc: Document;
  anchor: PdfAnchor;
}): { x: number; y: number } | undefined {
  const win = doc.defaultView;
  if (!win) return undefined;

  const el = doc.querySelector(`[${PDF_PAGE_ATTR}="${anchor.page}"]`);
  if (!el) return undefined;
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return undefined;
  const p = fromPageFraction({ box: r, anchor });
  return { x: p.x + win.scrollX, y: p.y + win.scrollY };
}
