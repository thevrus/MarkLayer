import { hexToRgba, inView, opBounds, renderOp } from '@ext/lib/renderer';
import type { AreaOp, CommentOp, DrawOp, SelectionOp } from '@ext/lib/types';
import { canReply, type PageAnchor } from '@marklayer/types/ops';
import { fromPageFraction } from './docAnchor';

/** A page's box in the framed document's coordinates, the space every mark is stored in. */
export interface PageBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The affine map from document space onto one page's output pixels, as `setTransform(a, 0, 0, d, e, f)` takes it. */
export function pageTransform({ box, out }: { box: PageBox; out: { width: number; height: number } }) {
  const a = out.width / box.width;
  const d = out.height / box.height;
  return { a, d, e: -box.left * a, f: -box.top * d };
}

/**
 * Where a pin sits in document space. A page anchor wins, as it does on screen
 * (`resolvePageAnchor`): it names the page, so the pin cannot slide onto a
 * neighbour when the stored point and the current layout disagree.
 */
export function pinPoint({
  op,
  pages,
}: {
  op: { x: number; y: number; pdf?: PageAnchor };
  pages: Map<number, PageBox>;
}) {
  const box = op.pdf && pages.get(op.pdf.page);
  return op.pdf && box ? fromPageFraction({ box, anchor: op.pdf }) : { x: op.x, y: op.y };
}

const touches = ({ box, bounds }: { box: PageBox; bounds: ReturnType<typeof opBounds> }) =>
  inView(bounds, box.left, box.top, box.width, box.height);

const PIN_RADIUS = 14;

function paintPin({ c, op, at }: { c: CanvasRenderingContext2D; op: CommentOp; at: { x: number; y: number } }) {
  c.beginPath();
  c.arc(at.x, at.y, PIN_RADIUS, 0, Math.PI * 2);
  c.fillStyle = op.color;
  c.fill();
  c.lineWidth = 2;
  c.strokeStyle = '#ffffff';
  c.stroke();
  c.fillStyle = '#ffffff';
  c.font = '600 12px Geist, system-ui, sans-serif';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(String(op.num), at.x, at.y);
}

function paintArea({ c, op }: { c: CanvasRenderingContext2D; op: AreaOp }) {
  const x = Math.min(op.startX, op.endX);
  const y = Math.min(op.startY, op.endY);
  const w = Math.abs(op.endX - op.startX);
  const h = Math.abs(op.endY - op.startY);
  c.fillStyle = hexToRgba(op.color, 0.12);
  c.fillRect(x, y, w, h);
  c.lineWidth = 1.5;
  c.strokeStyle = op.color;
  c.strokeRect(x + 0.75, y + 0.75, w - 1.5, h - 1.5);
}

function paintSelection({ c, op }: { c: CanvasRenderingContext2D; op: SelectionOp }) {
  c.fillStyle = hexToRgba(op.color, 0.25);
  for (const r of op.rects) c.fillRect(r.x, r.y, r.width, r.height);
}

/**
 * Draw page `page`'s marks onto `target`, already holding the page's pixels. Marks
 * are composited in the order the viewer stacks them: highlights and areas, the
 * drawing canvas, then pins. The drawings go through a layer of their own because
 * an eraser stroke is `destination-out` — on the page canvas it would cut holes
 * in the PDF instead of in the ink.
 */
export function paintPageMarks({
  target,
  page,
  ops,
  pages,
}: {
  target: HTMLCanvasElement;
  page: number;
  ops: DrawOp[];
  pages: Map<number, PageBox>;
}) {
  const box = pages.get(page);
  const c = target.getContext('2d');
  if (!box || !c) return;
  const out = { width: target.width, height: target.height };
  const { a, d, e, f } = pageTransform({ box, out });

  c.save();
  c.setTransform(a, 0, 0, d, e, f);
  for (const op of ops) {
    if (op.tool === 'selection') paintSelection({ c, op });
    else if (op.tool === 'area') paintArea({ c, op });
  }
  c.restore();

  const ink = document.createElement('canvas');
  ink.width = out.width;
  ink.height = out.height;
  const ic = ink.getContext('2d');
  if (ic) {
    ic.setTransform(a, 0, 0, d, e, f);
    for (const op of ops) if (touches({ box, bounds: opBounds(op) })) renderOp(ic, op, 0, 0);
    c.drawImage(ink, 0, 0);
  }
  ink.width = 0;

  c.save();
  c.setTransform(a, 0, 0, d, e, f);
  for (const op of ops) {
    // A reply is drawn inside its parent's card, never as a pin of its own.
    if (op.tool !== 'comment' || !canReply(op) || (op.pdf && op.pdf.page !== page)) continue;
    paintPin({ c, op, at: pinPoint({ op, pages }) });
  }
  c.restore();
}
