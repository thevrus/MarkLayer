import { antHash, isUploadPath } from '@marklayer/brand/links';

/**
 * What the viewer's iframe points at. An upload is already a file on this
 * origin, so it goes straight to the document viewer — `/proxy` would reject
 * it, since a bare path is not a fetchable url. A remote url goes to the proxy,
 * which redirects to the same viewer if what comes back is a PDF or an image.
 */
export function frameSrc({ url }: { url: string }): string {
  const route = isUploadPath(url) ? '/doc' : '/proxy';
  return `${route}?url=${encodeURIComponent(url)}`;
}

/**
 * The live page with the room in its `#ant=` hash — the format the extension's
 * `parseUrlHash` joins on activation, so the annotations follow the reader there.
 */
export function liveRoomUrl({ url, width, id }: { url: string; width: number; id: string }): string {
  if (!id || !URL.canParse(url)) return url;
  const live = new URL(url);
  live.hash = antHash.build({ width, id });
  return live.href;
}

/** Where the viewer should read a document's bytes from. */
export function bytesUrl({ url, origin }: { url: string; origin: string }): string {
  if (isUploadPath(url)) return url;
  const proxyUrl = new URL('/proxy', origin);
  proxyUrl.searchParams.set('url', url);
  proxyUrl.searchParams.set('raw', '1');
  return proxyUrl.toString();
}

function injectStyle({ doc, css }: { doc: Document; css: string }): void {
  const style = doc.createElement('style');
  style.textContent = css;
  doc.head?.appendChild(style);
}

/** Stops a same-origin frame's page from scrolling, so the wheel chains to the host instead. */
export function stillFrame(doc: Document): void {
  injectStyle({ doc, css: 'html,body{overflow:hidden !important}' });
}

/** Hides a same-origin frame's scrollbars but leaves it scrollable, for a page we scroll ourselves. */
export function hideScrollbars(doc: Document): void {
  injectStyle({ doc, css: '*{scrollbar-width:none !important}*::-webkit-scrollbar{display:none !important}' });
}
