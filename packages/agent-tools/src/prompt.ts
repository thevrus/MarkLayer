import type { AnnotationOp, CommentOp, DrawOp } from '@marklayer/types';
import { isAnnotationOp, resolveOpStatus } from '@marklayer/types';

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

function noteOf(op: AnnotationOp): string {
  if (op.tool === 'comment') return op.text.trim();
  return op.comment?.trim() ?? '';
}

/** Open work only: settled and dismissed threads are not something to act on, and a pin with no words has nothing to say. */
function isActionable(op: AnnotationOp): boolean {
  const status = resolveOpStatus(op);
  if (status !== 'open' && status !== 'in_progress') return false;
  if (op.tool === 'selection' && op.suggestion) return true;
  if (op.tool === 'comment' && op.voice) return true;
  return noteOf(op).length > 0;
}

/** Replies belong to their parent thread, so they are not themselves watchable. */
export const isWatchableOp = (op: DrawOp): op is AnnotationOp =>
  isAnnotationOp(op) && !(op.tool === 'comment' && !!op.parentId);

const actionableRoots = (ops: DrawOp[]): AnnotationOp[] =>
  ops.filter((op): op is AnnotationOp => isWatchableOp(op) && isActionable(op));

function elementLine(op: AnnotationOp): string | null {
  const el = op.tool === 'inspect' ? op : op.target;
  if (!el) return null;
  const hint = 'text' in el && el.text ? ` "${oneLine(el.text)}"` : '';
  return `\`${el.selector}\` <${el.tag}>${hint}`;
}

/** Every open annotation on a page as one markdown prompt for a coding agent; null when nothing is open. */
export function buildAnnotationsPrompt({ url, ops }: { url?: string; ops: DrawOp[] }): string | null {
  const items = actionableRoots(ops);
  if (!items.length) return null;

  const replies = new Map<string, CommentOp[]>();
  for (const op of ops) {
    if (op.tool !== 'comment' || !op.parentId) continue;
    const list = replies.get(op.parentId);
    if (list) list.push(op);
    else replies.set(op.parentId, [op]);
  }

  const blocks = items.map((op, i) => {
    const lines = [`${i + 1}. ${noteOf(op) || (op.tool === 'comment' && op.voice ? '(voice note)' : '(no comment)')}`];
    if (op.priority) lines.push(`   - Priority: ${op.priority}`);
    const el = elementLine(op);
    if (el) lines.push(`   - Element: ${el}`);
    if (op.tool === 'selection') {
      lines.push(`   - Text: "${oneLine(op.text)}"`);
      if (op.suggestion) lines.push(`   - Change to: "${oneLine(op.suggestion)}"`);
    }
    for (const r of replies.get(op.id) ?? []) {
      lines.push(`   - Reply (${r.author || 'Anonymous'}): ${oneLine(r.text)}`);
    }
    return lines.join('\n');
  });

  const head = `# Fix ${items.length} annotation${items.length === 1 ? '' : 's'}${url ? ` on ${url}` : ''}`;
  return `${head}\n\n${blocks.join('\n\n')}\n`;
}

/** How many annotations the prompt would carry, for enabling the button without building the text. */
export function openAnnotationCount(ops: DrawOp[]): number {
  return actionableRoots(ops).length;
}
