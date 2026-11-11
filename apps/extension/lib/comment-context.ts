import { DEFAULT_LAYER_ID, isRootAnnotation, type CommentOp, type DeviceMode, type DrawOp } from '@marklayer/types/ops';
import { pinCrop, pinShotSize, type Box } from './pin-shot';
import { applyAnchorDelta, reprojectBox, reprojectRects } from './anchor';

type Region = NonNullable<CommentOp['visualContext']>['region'];
const intersects = (a: Region, b: Region) => a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y;

/** Freeze the current layer's nearby annotations at the moment the pin is placed. */
export function commentContext({ pin, viewport, layerId, ops, device, doc = document }: {
  pin: { x: number; y: number }; viewport: Box; layerId: string; ops: readonly DrawOp[]; device?: DeviceMode; doc?: Document | null;
}): NonNullable<CommentOp['visualContext']> {
  const region = pinCrop({ pin, viewport, size: pinShotSize.peek() });
  const ctx = doc ? { doc, win: doc.defaultView ?? undefined } : undefined;
  const matches: NonNullable<CommentOp['visualContext']>['annotations'] = [];
  let incomplete = !doc;
  let truncatedText = false;
  for (const op of ops) {
    if (!isRootAnnotation(op) || (op.layerId ?? DEFAULT_LAYER_ID) !== layerId) continue;
    if (device && (op.device ?? 'desktop') !== device) continue;
    if ('pdf' in op && op.pdf) { incomplete = true; continue; }
    let rects: Region[];
    let text: string;
    switch (op.tool) {
      case 'comment': {
        const point = doc ? applyAnchorDelta(op.target, { docX: op.x, docY: op.y }, ctx) : op;
        if (op.target && (!('strategy' in point) || !point.strategy)) incomplete = true;
        rects = [{ x: point.x, y: point.y, width: 0, height: 0 }]; text = op.text; break;
      }
      case 'area': {
        const box = reprojectBox({ ...op, target: doc ? op.target : undefined, ctx });
        if (op.target && !box.strategy) incomplete = true;
        rects = [box]; text = op.comment ?? ''; break;
      }
      case 'selection': {
        const resolved = reprojectRects({ target: doc ? op.target : undefined, rects: op.rects, ctx });
        if (op.target && !resolved?.strategy) incomplete = true;
        rects = resolved?.rects ?? []; text = [op.text, op.comment].filter(Boolean).join('\n'); break;
      }
      case 'inspect': rects = [op.rect]; text = op.comment ?? op.markdown; break;
    }
    if (rects.some((rect) => intersects(region, rect))) {
      if (text.length > 500) truncatedText = true;
      matches.push({ id: op.id, kind: op.tool, text: text.slice(0, 500) });
    }
  }
  return { region, layerId, annotations: matches.slice(0, 25), truncated: matches.length > 25 || truncatedText, ...(incomplete ? { incomplete: true } : {}) };
}
