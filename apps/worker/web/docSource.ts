import { isUploadPath } from '@marklayer/types';

export { isUploadPath };

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

/** Where the viewer should read a document's bytes from. */
export function bytesUrl({ url, origin }: { url: string; origin: string }): string {
  if (isUploadPath(url)) return url;
  const proxyUrl = new URL('/proxy', origin);
  proxyUrl.searchParams.set('url', url);
  proxyUrl.searchParams.set('raw', '1');
  return proxyUrl.toString();
}
