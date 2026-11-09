import type { DrawOp } from '@ext/lib/types';
import { type PageBox, paintPageMarks } from './doc-export-layout';
import { DOC_PAGE_ATTR } from './docAnchor';
import { bytesUrl } from './docSource';
import type { ImagePage } from './pdf-writer';

/** pdf.js renders at 2x the page's point size (144dpi), unless that passes this many pixels. */
const PDF_SCALE = 2;
const MAX_PAGE_PIXELS = 6_000_000;
const JPEG_QUALITY = 0.92;

/**
 * Every page box in the live viewer, in document space. Measured rather than
 * recomputed from the viewer's fit-to-width rule, so the marks land wherever
 * the reader saw them, gutters and floored page sizes included.
 */
function measurePages(doc: Document): Map<number, PageBox> {
  const win = doc.defaultView;
  const pages = new Map<number, PageBox>();
  for (const el of doc.querySelectorAll(`[${DOC_PAGE_ATTR}]`)) {
    const page = Number.parseInt(el.getAttribute(DOC_PAGE_ATTR) ?? '', 10);
    const r = el.getBoundingClientRect();
    if (!(page > 0) || r.width === 0 || r.height === 0) continue;
    pages.set(page, {
      left: r.left + (win?.scrollX ?? 0),
      top: r.top + (win?.scrollY ?? 0),
      width: r.width,
      height: r.height,
    });
  }
  return pages;
}

function canvasBlob({ canvas, type, quality }: { canvas: HTMLCanvasElement; type: string; quality?: number }) {
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Canvas encode failed'))), type, quality),
  );
}

async function exportImage({ blob, ops, pages }: { blob: Blob; ops: DrawOp[]; pages: Map<number, PageBox> }) {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
  bitmap.close();
  paintPageMarks({ target: canvas, page: 1, ops, pages });
  return canvasBlob({ canvas, type: 'image/png' });
}

async function exportPdf({ bytes, ops, pages }: { bytes: ArrayBuffer; ops: DrawOp[]; pages: Map<number, PageBox> }) {
  const [{ loadPdf }, { writeImagePdf }] = await Promise.all([import('./pdf-render'), import('./pdf-writer')]);
  const pdf = await loadPdf(bytes);
  const out: ImagePage[] = [];
  try {
    // One page at a time, its canvas released before the next: a long document
    // holds only its encoded JPEGs, never every page's pixels at once.
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(PDF_SCALE, Math.sqrt(MAX_PAGE_PIXELS / (base.width * base.height)));
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      await page.render({ canvas, viewport }).promise;
      paintPageMarks({ target: canvas, page: n, ops, pages });
      const jpeg = new Uint8Array(
        await (await canvasBlob({ canvas, type: 'image/jpeg', quality: JPEG_QUALITY })).arrayBuffer(),
      );
      out.push({
        jpeg,
        pixelWidth: canvas.width,
        pixelHeight: canvas.height,
        widthPt: base.width,
        heightPt: base.height,
      });
      canvas.width = 0;
      page.cleanup();
    }
  } finally {
    // Ends the worker too; the proxy itself only has `cleanup`.
    void pdf.loadingTask.destroy();
  }
  return new Blob([writeImagePdf(out)], { type: 'application/pdf' });
}

function download({ blob, filename }: { blob: Blob; filename: string }) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  // Revoked on a delay: a multi-megabyte file can still be streaming to disk when click() returns.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * The file this share link annotates, with its marks flattened on: an image as a
 * PNG at its own resolution, a PDF as a PDF of the same pages. Reads the page
 * layout from the open viewer, since that layout is what the marks were placed on.
 */
export async function exportAnnotatedFile({
  frame,
  url,
  ops,
}: {
  frame: HTMLIFrameElement | null;
  url: string;
  ops: DrawOp[];
}): Promise<{ format: 'png' | 'pdf' }> {
  const doc = frame?.contentDocument;
  const pages = doc ? measurePages(doc) : new Map<number, PageBox>();
  if (!pages.size) throw new Error('The file has not finished loading');

  const response = await fetch(bytesUrl({ url, origin: location.origin }));
  if (!response.ok) throw new Error(`Could not fetch the file (${response.status})`);
  const contentType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? '';
  const stamp = new Date().toISOString().slice(0, 10);

  if (contentType.startsWith('image/')) {
    download({
      blob: await exportImage({ blob: await response.blob(), ops, pages }),
      filename: `marklayer-annotated-${stamp}.png`,
    });
    return { format: 'png' };
  }
  download({
    blob: await exportPdf({ bytes: await response.arrayBuffer(), ops, pages }),
    filename: `marklayer-annotated-${stamp}.pdf`,
  });
  return { format: 'pdf' };
}
