import type { AreaOp, CommentOp, SelectionOp, TextOp } from '@ext/lib/types';

/** One row of the annotation panel, and one step of its detail view. */
export type AnnotationItem =
  | { kind: 'comment'; op: CommentOp; replyCount: number }
  | { kind: 'text'; op: TextOp }
  | { kind: 'selection'; op: SelectionOp }
  | { kind: 'area'; op: AreaOp };

/**
 * Where the viewport scrolls to reveal this annotation. The list also sorts on
 * `y`, so a row and the "Go to" that row offers can't drift apart.
 */
export function itemAnchor(item: AnnotationItem): { x: number; y: number } {
  if (item.kind === 'selection') {
    const rect = item.op.rects[0];
    return { x: rect?.x ?? 0, y: rect?.y ?? 0 };
  }
  if (item.kind === 'area') {
    return { x: Math.min(item.op.startX, item.op.endX), y: Math.min(item.op.startY, item.op.endY) };
  }
  return { x: item.op.x, y: item.op.y };
}

/** What the detail header calls this annotation. Selections rename themselves once they carry an edit. */
export function itemLabel(item: AnnotationItem): string {
  if (item.kind === 'comment') return `Comment ${item.op.num}`;
  if (item.kind === 'selection') return item.op.suggestion ? 'Text edit' : 'Selection';
  if (item.kind === 'area') return 'Area';
  return 'Text';
}
