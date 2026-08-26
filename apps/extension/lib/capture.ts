import { copyText, toast } from './state';

// The worker type-checks this directory through its `@ext/*` alias but has no WXT
// types, so the extension-only global is declared narrowly here rather than pulled
// in from `wxt/browser`, which the worker cannot resolve.
declare const browser: { runtime: { sendMessage(message: unknown): Promise<unknown> } };

/** Resolves after two frames so overlay unmounts are painted before the tab capture. */
function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

async function requestTabCapture(): Promise<string> {
  const res: unknown = await browser.runtime.sendMessage({ type: 'capture-tab' });
  if (res !== null && typeof res === 'object') {
    if ('dataUrl' in res && typeof res.dataUrl === 'string') return res.dataUrl;
    if ('error' in res && typeof res.error === 'string') throw new Error(res.error);
  }
  throw new Error('Tab capture failed');
}

/** Crop a full-tab screenshot down to one element's viewport rect, clamped to the visible area. */
async function cropToRect({ dataUrl, rect }: { dataUrl: string; rect: DOMRect }): Promise<Blob> {
  const source = await fetch(dataUrl);
  const bitmap = await createImageBitmap(await source.blob());
  try {
    // captureVisibleTab returns device pixels; derive the scale from the bitmap itself
    // rather than trusting devicePixelRatio (zoom changes both, differently).
    const scale = bitmap.width / window.innerWidth;
    const left = Math.max(0, rect.left) * scale;
    const top = Math.max(0, rect.top) * scale;
    const width = Math.round(Math.min(rect.right, window.innerWidth) * scale - left);
    const height = Math.round(Math.min(rect.bottom, window.innerHeight) * scale - top);
    if (width < 1 || height < 1) throw new Error('Element is outside the viewport');

    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('No 2d context');
    ctx.drawImage(bitmap, left, top, width, height, 0, 0, width, height);
    return canvas.convertToBlob({ type: 'image/png' });
  } finally {
    bitmap.close();
  }
}

/**
 * Copy an element as screenshot + markdown in one clipboard write, so a paste
 * target picks whichever it understands (agent chats take the image, editors the text).
 * Callers must hide their own overlays first. Falls back to text-only when capture
 * or write fails.
 */
export async function copyElementShot({ rect, markdown }: { rect: DOMRect; markdown: string }): Promise<void> {
  try {
    // Cheap enough to check before the paint wait and the message roundtrip.
    if (rect.right <= 0 || rect.bottom <= 0 || rect.left >= window.innerWidth || rect.top >= window.innerHeight) {
      throw new Error('Element is outside the viewport');
    }
    await nextPaint();
    const dataUrl = await requestTabCapture();
    const png = await cropToRect({ dataUrl, rect });
    await navigator.clipboard.write([
      new ClipboardItem({ 'image/png': png, 'text/plain': new Blob([markdown], { type: 'text/plain' }) }),
    ]);
    toast('Screenshot + specs copied — paste into your AI', 'success');
  } catch {
    copyText(markdown, 'Element copied — paste into your AI');
  }
}
