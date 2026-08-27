import type { Crop } from '../lib/capture';
import { bridgePayload } from '../lib/fiber-bridge';

/** Cut one element's box out of a full-tab screenshot, in the background's own heap. */
async function cropCapture({ dataUrl, crop }: { dataUrl: string; crop: Crop }): Promise<string> {
  const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
  try {
    // captureVisibleTab returns device pixels; derive the scale from the bitmap
    // itself rather than trusting devicePixelRatio (zoom changes both, differently).
    const scale = bitmap.width / crop.viewportWidth;
    const width = Math.round(crop.width * scale);
    const height = Math.round(crop.height * scale);
    if (width < 1 || height < 1) throw new Error('Element is outside the viewport');

    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('No 2d context');
    ctx.drawImage(bitmap, crop.x * scale, crop.y * scale, width, height, 0, 0, width, height);
    const png = await canvas.convertToBlob({ type: 'image/png' });
    // Back as a data URL because extension messaging is JSON — a Blob would not
    // survive the hop. It is now element-sized, which is the whole point.
    return await blobToDataUrl(png);
  } finally {
    bitmap.close();
  }
}

/**
 * `FileReader` is not exposed in an MV3 service worker, so base64 is built by hand.
 * Chunked because `String.fromCharCode(...bytes)` blows the argument limit on a
 * large array — the cropped PNG is small, but the bound is on the input, not us.
 */
async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return `data:image/png;base64,${btoa(binary)}`;
}

export default defineBackground(() => {
  const injected = new Set<number>();

  browser.action.onClicked.addListener(async (tab) => {
    if (tab.id == null) return;

    if (injected.has(tab.id)) {
      // Already injected — toggle visibility
      browser.tabs.sendMessage(tab.id, { type: 'toggle-annotate' });
    } else {
      // First click — inject content script (activeTab grants permission). The
      // main-world bridge lets the isolated-world inspector read __reactFiber$<id>
      // and __vueParentComponent, which aren't visible to isolated content scripts.
      // Injecting via the scripting API bypasses page CSP restrictions on inline scripts.
      await Promise.all([
        browser.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['/content-scripts/content.js'],
        }),
        browser.scripting.executeScript({
          target: { tabId: tab.id },
          world: 'MAIN',
          func: bridgePayload,
        }),
      ]);
      injected.add(tab.id);
    }
  });

  // QuickGrab screenshot: capture the sender's window (activeTab grants this after
  // the icon click) and crop here, so only the element-sized PNG crosses back rather
  // than a base64 copy of the whole viewport.
  browser.runtime.onMessage.addListener((msg, sender) => {
    if (msg?.type !== 'capture-element') return;
    const windowId = sender.tab?.windowId ?? browser.windows.WINDOW_ID_CURRENT;
    return browser.tabs
      .captureVisibleTab(windowId, { format: 'png' })
      .then((dataUrl) => cropCapture({ dataUrl, crop: msg.crop }))
      .then(
        (dataUrl) => ({ dataUrl }),
        (err) => ({ error: String(err) }),
      );
  });

  // Clean up when tabs close or navigate
  browser.tabs.onRemoved.addListener((tabId) => injected.delete(tabId));
  browser.tabs.onUpdated.addListener((tabId, info) => {
    if (info.status === 'loading') injected.delete(tabId);
  });
});
