/**
 * Downscale + re-encode a screenshot before it hits `/f`. A retina screenshot
 * pasted from the clipboard routinely runs 4-10MB as a PNG, and the anonymous
 * upload endpoint has no auth to gate volume by. Shrinking client-side is what
 * keeps R2 usage bounded — the server's per-file cap and 90-day sweep bound
 * the worst case, but this bounds the common one.
 */
const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.82;

export async function compressImage(file: File | Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return file instanceof Blob ? file : new Blob([file]);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
  // A blob smaller than the re-encode (rare, but a tiny screenshot re-saved as
  // JPEG can lose to its own PNG) is not worth chasing — either way is well
  // under the server's cap, so just take what canvas gave us.
  return blob ?? file;
}
