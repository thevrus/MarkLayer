import type { AreaRect } from './area-rect';
import { type Box, encodeShot, settleWithin } from './pin-shot';
import { renderOp } from './renderer';
import type { DrawOp } from './types';

/** The part of an area (document coords) inside the viewport, as a viewport box; null when none is on screen. */
export function areaCrop({
  rect,
  scroll,
  viewport,
}: {
  rect: AreaRect;
  scroll: { x: number; y: number };
  viewport: { width: number; height: number };
}): Box | null {
  const x = Math.max(0, rect.x - scroll.x);
  const y = Math.max(0, rect.y - scroll.y);
  const width = Math.min(rect.x - scroll.x + rect.w, viewport.width) - x;
  const height = Math.min(rect.y - scroll.y + rect.h, viewport.height) - y;
  return width >= 1 && height >= 1 ? { x, y, width, height } : null;
}

/**
 * Shoot the area with MarkLayer's UI out of it, draw the markup on, upload; resolves to an upload id.
 * Never rejects and gives up after `timeoutMs`, so a stalled capture only costs the note its image.
 */
export function snapshotArea({
  shoot,
  rect,
  scroll,
  viewport,
  ops,
  upload,
  timeoutMs,
}: {
  shoot: (crop: Box) => Promise<ImageBitmap>;
  rect: AreaRect;
  scroll: { x: number; y: number };
  viewport: { width: number; height: number };
  ops: DrawOp[];
  upload: (file: Blob) => Promise<string | null>;
  timeoutMs?: number;
}): Promise<string | null> {
  const crop = areaCrop({ rect, scroll, viewport });
  const run = async (): Promise<string | null> => {
    if (!crop) return null;
    const image = await shoot(crop);
    // `renderOp` takes the crop's document origin as its scroll offset.
    const ox = crop.x + scroll.x;
    const oy = crop.y + scroll.y;
    const jpeg = await encodeShot({
      image,
      crop,
      draw: (ctx, perCssPx) => {
        for (const op of ops) renderOp(ctx, op, ox * perCssPx, oy * perCssPx, perCssPx);
      },
    });
    return jpeg ? upload(jpeg) : null;
  };
  return settleWithin({ run, timeoutMs });
}
