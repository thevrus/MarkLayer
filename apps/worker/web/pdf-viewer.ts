// Standalone PDF viewer hosted at /pdf.html. Plain TS, no framework: the host
// app (Viewer.tsx) attaches a native `scroll` listener to this page's own
// window and reads `window.scrollY`, so pages must sit in normal document
// flow and scroll the real document — no virtual scroller, no inner
// overflow container.

import type { PageViewport, PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import { GlobalWorkerOptions, getDocument, TextLayer } from 'pdfjs-dist';
import { PDF_PAGE_ATTR } from './pdfAnchor';
import { bytesUrl } from './pdfSource';

// Vite only rewrites this exact `new URL(literal, import.meta.url)` shape.
GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).href;

interface PageEntry {
  page: PDFPageProxy;
  viewport: PageViewport;
  container: HTMLDivElement;
  painted: boolean;
}

/** The page's CSS box. Floored, so the container, the canvas and the text
 *  layer's own 1px rounding all land on the same integer. */
function cssBox(viewport: PageViewport) {
  return { widthPx: Math.floor(viewport.width), heightPx: Math.floor(viewport.height) };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function renderError(message: string): void {
  const pre = document.createElement('pre');
  pre.className = 'pdf-error';
  pre.textContent = message;
  document.body.replaceChildren(pre);
}

async function fetchPdfBytes(url: string): Promise<ArrayBuffer> {
  const response = await fetch(bytesUrl({ url, origin: location.origin }));
  if (!response.ok) throw new Error(`fetch failed: ${response.status} ${response.statusText}`);
  return response.arrayBuffer();
}

/** The container's border-box must equal the PDF page box exactly — the host
 * converts a click to a page-relative fraction via getBoundingClientRect(). */
function createPageContainer({ pageNumber, viewport }: { pageNumber: number; viewport: PageViewport }): HTMLDivElement {
  const { widthPx, heightPx } = cssBox(viewport);
  const container = document.createElement('div');
  container.className = 'pdf-page';
  container.setAttribute(PDF_PAGE_ATTR, String(pageNumber));
  container.style.width = `${widthPx}px`;
  container.style.height = `${heightPx}px`;
  // TextLayer sizes its own box as `round(down, var(--total-scale-factor) * Npx,
  // var(--scale-round-x))`. Those are the embedder's to define (pdf_viewer.css
  // does not); left undefined the declaration is invalid and the layer
  // collapses. Rounding to 1px reproduces the `Math.floor` used for the canvas.
  container.style.setProperty('--total-scale-factor', String(viewport.scale));
  container.style.setProperty('--scale-round-x', '1px');
  container.style.setProperty('--scale-round-y', '1px');
  return container;
}

async function paintPage(entry: PageEntry): Promise<void> {
  if (entry.painted) return;
  entry.painted = true;

  const { page, viewport, container } = entry;
  const { widthPx, heightPx } = cssBox(viewport);
  // Backing store scaled by DPR for crispness; layout (CSS) size stays at the
  // fit-to-width viewport size so the container/canvas/text-layer all agree.
  // Capped: pages are fit to the full window width and never repainted away, so
  // an uncapped ratio on a 3x display costs ~70MB of backing store per page.
  const outputScale = Math.min(window.devicePixelRatio || 1, 2);
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width * outputScale);
  canvas.height = Math.floor(viewport.height * outputScale);
  canvas.style.width = `${widthPx}px`;
  canvas.style.height = `${heightPx}px`;
  container.appendChild(canvas);

  await page.render({ canvas, transform: [outputScale, 0, 0, outputScale, 0, 0], viewport }).promise;

  // Selectable text on top of the canvas, for the host's text-selection tool.
  // Rendered while detached: the host runs a subtree MutationObserver on this
  // document, and a text page is thousands of spans — appending once costs it
  // one record instead of one per span.
  const textLayerRoot = document.createElement('div');
  textLayerRoot.className = 'textLayer';
  const textLayer = new TextLayer({
    textContentSource: page.streamTextContent(),
    container: textLayerRoot,
    viewport,
  });
  await textLayer.render();
  container.appendChild(textLayerRoot);
}

async function loadPages({ pdf, root }: { pdf: PDFDocumentProxy; root: HTMLElement }): Promise<PageEntry[]> {
  // Sized up front, all at once, so total scroll height is correct from the
  // first frame and never shifts as pages are lazily painted. The `getPage`
  // calls are worker round-trips, so they go out together rather than in
  // series — nothing paints until the last one lands.
  const layoutWidth = document.documentElement.clientWidth;
  const pages = await Promise.all(Array.from({ length: pdf.numPages }, (_, i) => pdf.getPage(i + 1)));
  return pages.map((page, i) => {
    const unscaledViewport = page.getViewport({ scale: 1 });
    const scale = layoutWidth / unscaledViewport.width;
    const viewport = page.getViewport({ scale });
    const container = createPageContainer({ pageNumber: i + 1, viewport });
    root.appendChild(container);
    return { page, viewport, container, painted: false };
  });
}

function observeForLazyPaint(entries: PageEntry[]): void {
  const byContainer = new Map<Element, PageEntry>(entries.map((entry) => [entry.container, entry]));
  const observer = new IntersectionObserver(
    (observedEntries) => {
      for (const observed of observedEntries) {
        if (!observed.isIntersecting) continue;
        const entry = byContainer.get(observed.target);
        if (!entry) continue;
        // Painted pages are left in place — they are never torn down again,
        // since annotation anchoring depends on the containers staying put. So
        // stop watching one: every later crossing would re-enter and return.
        observer.unobserve(observed.target);
        paintPage(entry).catch((error: unknown) => {
          console.error('failed to render PDF page', describeError(error));
        });
      }
    },
    { rootMargin: '200% 0px' },
  );
  for (const entry of entries) observer.observe(entry.container);
}

async function main(): Promise<void> {
  const url = new URLSearchParams(location.search).get('url');
  if (!url) throw new Error('Missing "url" query parameter.');

  const bytes = await fetchPdfBytes(url);
  const pdf = await getDocument({ data: bytes }).promise;

  const root = document.getElementById('pdf-root');
  if (!root) throw new Error('Missing #pdf-root mount point.');

  const entries = await loadPages({ pdf, root });
  const firstEntry = entries[0];
  if (!firstEntry) throw new Error('PDF has no pages.');

  // Resizing the window does not re-fit pages in this version — pages keep
  // the width computed at load time. Not required for v1.
  observeForLazyPaint(entries);
  await paintPage(firstEntry);
}

main().catch((error: unknown) => {
  renderError(`Could not load PDF: ${describeError(error)}`);
});
