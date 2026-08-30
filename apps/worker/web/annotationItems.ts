import type { AreaOp, CommentOp, SelectionOp, TextOp } from '@ext/lib/types';
import { type AnnotationOp, opAnchor } from '@marklayer/types';

// `opAnchor` lives in packages/types — the MCP server needs the same answer, and
// two copies of it had already drifted on right-to-left area drags.
export { opAnchor };

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
  return item.kind === 'text' ? { x: item.op.x, y: item.op.y } : opAnchor(item.op);
}

/** What the detail header calls this annotation. Selections rename themselves once they carry an edit. */
export function itemLabel(item: AnnotationItem): string {
  return item.kind === 'text' ? 'Text' : opLabel(item.op);
}

/**
 * `opAnchor` above and the two projections below answer "where is it", "what is
 * it called" and "what does it say" for any annotation. The panel and the board
 * both render those answers, and each deriving them separately is how the two
 * views came to disagree about what a selection is called.
 */
export function opLabel(op: AnnotationOp): string {
  if (op.tool === 'comment') return `Comment ${op.num}`;
  // A selection carrying a replacement is a copy edit, and the surfaces should
  // say which it is: the two want different things from whoever picks it up.
  if (op.tool === 'selection') return op.suggestion ? 'Text edit' : 'Selection';
  if (op.tool === 'area') return 'Area';
  return 'Element';
}

/** One line of the annotation's own words, or empty when it has none yet. */
export function opBody(op: AnnotationOp): string {
  if (op.tool === 'comment') return op.text;
  if (op.tool === 'area') return op.comment ?? '';
  if (op.tool === 'selection') return op.comment || op.suggestion || op.text;
  return op.comment || op.selector;
}
