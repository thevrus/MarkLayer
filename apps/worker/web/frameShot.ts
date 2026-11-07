import type { Box } from '@ext/lib/pin-shot';

/**
 * Part of the framed page, drawn from its DOM. The proxy serves the page same-origin,
 * so the document is readable, and shooting it rather than the viewer leaves MarkLayer's
 * overlay out by construction. `modern-screenshot` loads on demand, so this costs the
 * viewer's entry bundle nothing.
 *
 * The root keeps its own width (a narrower one would reflow the page) and is cut to the
 * crop's height, shifted up to the crop; the horizontal cut happens on the bitmap.
 */
export async function shootFrame({
  frame,
  crop,
}: {
  frame: HTMLIFrameElement | null;
  crop: Box;
}): Promise<ImageBitmap> {
  const root = frame?.contentDocument?.documentElement;
  if (!root) throw new Error('Page not readable');
  const { domToCanvas } = await import('modern-screenshot');
  const scale = Math.min(window.devicePixelRatio || 1, 2);
  const canvas = await domToCanvas(root, {
    width: root.clientWidth,
    height: crop.height,
    scale,
    backgroundColor: '#ffffff',
    style: { transform: `translateY(${-crop.y}px)` },
    timeout: 5000,
  });
  return createImageBitmap(canvas, crop.x * scale, 0, crop.width * scale, crop.height * scale);
}
