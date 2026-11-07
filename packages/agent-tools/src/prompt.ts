import type { AnnotationOp, DrawOp, StyleEdit } from '@marklayer/types/ops';
import { indexOps, isRootAnnotation, resolveOpStatus } from '@marklayer/types/ops';

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

/** `color: #111 -> #222`; an empty side is the property having no value there, spelled out so it is not read as a typo. */
export const formatStyleEdit = ({ property, from, to }: StyleEdit): string =>
  `${property}: ${oneLine(from) || '(unset)'} -> ${oneLine(to) || '(unset)'}`;

function noteOf(op: AnnotationOp): string {
  if (op.tool === 'comment') return op.text.trim();
  return op.comment?.trim() ?? '';
}

/** Open work only: settled and dismissed threads are not something to act on, and a pin with no words has nothing to say. */
function isActionable(op: AnnotationOp): boolean {
  const status = resolveOpStatus(op);
  if (status !== 'open' && status !== 'in_progress') return false;
  if (op.tool === 'selection' && op.suggestion) return true;
  if (op.tool === 'comment' && (op.voice || op.video)) return true;
  if (op.tool === 'inspect' && op.styleEdits?.length) return true;
  return noteOf(op).length > 0;
}

const actionableRoots = (ops: DrawOp[]): AnnotationOp[] =>
  ops.filter((op): op is AnnotationOp => isRootAnnotation(op) && isActionable(op));

/** What stands in for the text of a thread that was spoken or recorded rather than typed. */
function recordingLabel(op: AnnotationOp): string {
  if (op.tool === 'comment' && op.voice) return '(voice note)';
  if (op.tool === 'comment' && op.video) return '(video note)';
  if (op.tool === 'inspect' && op.styleEdits?.length) return '(CSS edits)';
  return '(no comment)';
}

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

  const { replies } = indexOps(ops);

  const blocks = items.map((op, i) => {
    const lines = [`${i + 1}. ${noteOf(op) || recordingLabel(op)}`];
    if (op.priority) lines.push(`   - Priority: ${op.priority}`);
    const el = elementLine(op);
    if (el) lines.push(`   - Element: ${el}`);
    if (op.tool === 'selection') {
      lines.push(`   - Text: "${oneLine(op.text)}"`);
      if (op.suggestion) lines.push(`   - Change to: "${oneLine(op.suggestion)}"`);
    }
    if (op.tool === 'inspect' && op.styleEdits?.length) {
      lines.push('   - CSS tried live:');
      for (const edit of op.styleEdits) lines.push(`     - \`${formatStyleEdit(edit)}\``);
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
