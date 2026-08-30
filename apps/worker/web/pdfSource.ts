import { isUploadPath } from '@marklayer/types';

export { isUploadPath };

/**
 * What the viewer's iframe points at. An upload is already a PDF on this origin,
 * so it goes straight to the PDF page — `/proxy` would reject it, since a bare
 * path is not a fetchable url.
 */
export function frameSrc({ url }: { url: string }): string {
  const route = isUploadPath(url) ? '/pdf' : '/proxy';
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
