// Standalone viewer hosted at /doc.html for the documents MarkLayer paginates
// itself: a PDF, or an image. Plain TS, no framework — the host app
// (Viewer.tsx) attaches a native `scroll` listener to this page's own window
// and reads `window.scrollY`, so everything must sit in normal document flow.
//
// Which kind it is comes from the response's own content type, never from the
// url: an upload is served from `/f/{id}`, a path that says nothing about what
// is in it, and the proxy has already settled the question for a remote one.

import { DOC_PAGE_ATTR } from './docAnchor';
import { bytesUrl } from './docSource';

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function renderError(message: string): void {
  const pre = document.createElement('pre');
  pre.className = 'doc-error';
  pre.textContent = message;
  document.body.replaceChildren(pre);
}

/**
 * An image is a document of one page, so it gets the same page box a PDF page
 * does — sized in CSS pixels and tagged, which is the whole anchoring contract.
 *
 * Never upscaled. Fitting a 200px logo to a 1400px frame would hand someone a
 * blurred wall to annotate; the pixels are shown as they are, centred, and only
 * a picture too wide for the frame is scaled down to fit it.
 */
async function renderImage({ blob, root }: { blob: Blob; root: HTMLElement }): Promise<void> {
  const objectUrl = URL.createObjectURL(blob);
  const img = new Image();
  img.src = objectUrl;
  img.alt = '';
  try {
    await img.decode();
  } catch (error) {
    throw new Error(`could not decode the image: ${describeError(error)}`);
  } finally {
    // The decoded bitmap outlives the URL, so releasing it here frees the blob
    // on the success path too rather than keeping both for the page's lifetime.
    URL.revokeObjectURL(objectUrl);
  }

  const scale = Math.min(1, document.documentElement.clientWidth / img.naturalWidth);
  const container = document.createElement('div');
  container.className = 'doc-page';
  container.setAttribute(DOC_PAGE_ATTR, '1');
  // Floored to whole pixels for the same reason a PDF page is: the host turns a
  // click into a fraction of this box via getBoundingClientRect(), so the box has
  // to be the one the image actually paints into.
  container.style.width = `${Math.floor(img.naturalWidth * scale)}px`;
  container.style.height = `${Math.floor(img.naturalHeight * scale)}px`;
  img.style.width = '100%';
  img.style.height = '100%';
  container.appendChild(img);
  root.appendChild(container);
}

async function main(): Promise<void> {
  const url = new URLSearchParams(location.search).get('url');
  if (!url) throw new Error('Missing "url" query parameter.');

  const root = document.getElementById('doc-root');
  if (!root) throw new Error('Missing #doc-root mount point.');

  const response = await fetch(bytesUrl({ url, origin: location.origin }));
  if (!response.ok) throw new Error(`fetch failed: ${response.status} ${response.statusText}`);
  const contentType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? '';

  if (contentType.startsWith('image/')) {
    await renderImage({ blob: await response.blob(), root });
    return;
  }

  // pdf.js and its worker are ~1MB, and an image never needs a byte of it.
  const { renderPdf } = await import('./pdf-render');
  await renderPdf({ bytes: await response.arrayBuffer(), root });
}

main().catch((error: unknown) => {
  renderError(`Could not load this file: ${describeError(error)}`);
});
