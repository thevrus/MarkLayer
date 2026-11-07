import { taskNote } from '@marklayer/types/ops';
import { signal } from '@preact/signals';
import { nanoid } from 'nanoid';
import { getCommentMeta } from './comment-meta';
import { signedBy } from './identity';
import { commentCounter, commitOp } from './ops';
import { clearOnCopyEnabled, color, lineWidth } from './prefs';
import { toDoc } from './scroller';
import { ELEMENT_INSPECTOR_HEADING } from './selector';
import { copyText, toast } from './toasts';

/** A stacked element-inspect entry awaiting bulk copy to an LLM. */
export interface InspectorStackItem {
  id: string;
  selector: string;
  comment: string;
  /** Element snapshot markdown (from formatForAI), without any user task wrapper. */
  markdown: string;
}

export const inspectorStack = signal<InspectorStackItem[]>([]);
export const inspectorStackOpen = signal(false);

export function addToInspectorStack(item: Omit<InspectorStackItem, 'id'>) {
  inspectorStack.value = [...inspectorStack.value, { ...item, id: nanoid() }];
  inspectorStackOpen.value = true;
}

export function removeFromInspectorStack(id: string) {
  inspectorStack.value = inspectorStack.value.filter((i) => i.id !== id);
  if (!inspectorStack.value.length) inspectorStackOpen.value = false;
}

export function clearInspectorStack() {
  inspectorStack.value = [];
  inspectorStackOpen.value = false;
}

/**
 * Turn pending items into comments, so they sync to the room and reach the agent.
 * Each pin lands on the element its selector resolves to, or on a grid if the
 * selector no longer matches. Returns how many were added.
 */
export function flushInspectorStack(): number {
  const items = inspectorStack.value;
  if (!items.length) return 0;
  const baseNum = commentCounter.value;
  let fallbackIdx = 0;
  items.forEach((item, i) => {
    let at: { x: number; y: number };
    const el = item.selector ? document.querySelector(item.selector) : null;
    if (el) {
      const rect = el.getBoundingClientRect();
      at = toDoc({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    } else {
      at = toDoc({ x: 80 + (fallbackIdx % 4) * 56, y: 80 + Math.floor(fallbackIdx / 4) * 56 });
      fallbackIdx++;
    }
    commitOp({
      id: nanoid(),
      tool: 'comment',
      num: baseNum + i + 1,
      text: taskNote.build({ task: item.comment, body: item.markdown }),
      ...at,
      color: color.value,
      lineWidth: lineWidth.value,
      ts: Date.now() + i,
      ...signedBy(),
      meta: getCommentMeta(),
    });
  });
  clearInspectorStack();
  return items.length;
}

/** Build a single LLM-ready prompt that bundles every stacked element + task. */
export function buildInspectorStackPrompt(): string {
  const items = inspectorStack.value;
  const headingPrefix = `${ELEMENT_INSPECTOR_HEADING}\n\n`;
  const blocks = items.map((it, i) => {
    const body = it.markdown.startsWith(headingPrefix) ? it.markdown.slice(headingPrefix.length) : it.markdown;
    const heading = it.comment ? `## Task ${i + 1}: ${it.comment}` : `## Element ${i + 1}`;
    return `${heading}\n\n${body.trim()}`;
  });
  const header = `# Element changes (${items.length} task${items.length === 1 ? '' : 's'})`;
  return `${header}\n\n${blocks.join('\n\n---\n\n')}\n`;
}

export function copyInspectorStack() {
  const items = inspectorStack.value;
  if (!items.length) {
    toast('Stack is empty');
    return;
  }
  copyText(buildInspectorStackPrompt(), `Copied ${items.length} task${items.length === 1 ? '' : 's'} for AI!`);
  if (clearOnCopyEnabled.value) clearInspectorStack();
}
