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

/** The `capture-element` message payload — declared here, where the sender lives. */
export interface Crop {
  x: number;
  y: number;
  width: number;
  height: number;
  /** CSS px width of the sender's viewport, to scale the crop into device px. */
  viewportWidth: number;
}

/**
 * One element's viewport rect clamped to the visible area, or null when nothing of
 * it is on screen. The single authority on what "croppable" means — the background
 * crops to exactly this box, so the content script can also use it as a preflight
 * and skip the paint wait plus the message roundtrip for an off-screen element.
 */
function visibleCrop(rect: DOMRect): Omit<Crop, 'viewportWidth'> | null {
  const x = Math.max(0, rect.left);
  const y = Math.max(0, rect.top);
  const width = Math.min(rect.right, window.innerWidth) - x;
  const height = Math.min(rect.bottom, window.innerHeight) - y;
  return width >= 1 && height >= 1 ? { x, y, width, height } : null;
}

/**
 * Ask the background to screenshot the tab and crop it, returning only the cropped
 * PNG as a data URL. Cropping there rather than here is the point: a full viewport
 * at DPR 2 is a multi-megabyte PNG, and extension messaging is JSON, so shipping
 * the whole tab back would base64-inflate it another third, copy it into the host
 * page's heap, and decode every pixel to keep a fraction of them.
 */
async function requestElementCapture(crop: Crop): Promise<string> {
  const res: unknown = await browser.runtime.sendMessage({ type: 'capture-element', crop });
  if (res !== null && typeof res === 'object') {
    if ('dataUrl' in res && typeof res.dataUrl === 'string') return res.dataUrl;
    if ('error' in res && typeof res.error === 'string') throw new Error(res.error);
  }
  throw new Error('Tab capture failed');
}

/**
 * Copy an element as screenshot + markdown in one clipboard write, so a paste
 * target picks whichever it understands (agent chats take the image, editors the text).
 * Callers must hide their own overlays first. Falls back to text-only when capture
 * or write fails.
 */
export async function copyElementShot({ rect, markdown }: { rect: DOMRect; markdown: string }): Promise<void> {
  try {
    const crop = visibleCrop(rect);
    if (!crop) throw new Error('Element is outside the viewport');
    await nextPaint();
    const dataUrl = await requestElementCapture({ ...crop, viewportWidth: window.innerWidth });
    const png = await (await fetch(dataUrl)).blob();
    await navigator.clipboard.write([
      new ClipboardItem({ 'image/png': png, 'text/plain': new Blob([markdown], { type: 'text/plain' }) }),
    ]);
    toast('Screenshot + specs copied — paste into your AI', 'success');
  } catch {
    copyText(markdown, 'Element copied — paste into your AI');
  }
}
