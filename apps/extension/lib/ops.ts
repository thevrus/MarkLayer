import { buildAnnotationsPrompt, openAnnotationCount } from '@marklayer/agent-tools/prompt';
import {
  applyOpPatch,
  isAnnotationOp,
  isReviewOp,
  isSettled,
  resolveOpStatus,
  toggleReaction,
  translateOp,
} from '@marklayer/types/ops';
import type { ClientMsg } from '@marklayer/types/wire';
import { batch, computed, signal } from '@preact/signals';
import { nanoid } from 'nanoid';
import { track } from './analytics';
import { holdOp, patchHeld, shouldHold, takeHeld, tick, undoHeld } from './batch';
import { getCommentMeta } from './comment-meta';
import type { DraftStore } from './drafts';
import { type HostCapabilities, host } from './host-config';
import { localUser, signedBy } from './identity';
import { activeLayer, inVisibleLayer } from './layers';
import { pageUrl } from './page-url';
import { color, lineWidth } from './prefs';
import { copyText, toast } from './toasts';
import { activeTool } from './tool-state';
import type {
  AreaOp,
  CommentOp,
  CommentPriority,
  CommentStatus,
  DrawOp,
  InspectOp,
  Mention,
  SelectionOp,
} from './types';

let drafts: DraftStore | null = null;

/** Only a host that later restores opens a store: writing a draft nothing reads is IndexedDB churn on someone's page. */
export function openDrafts(create: HostCapabilities['drafts']) {
  drafts =
    create?.({
      key: () => `ml-draft-${pageUrl()}`,
      getOps: () => operations.value,
      setOps: (ops) => {
        operations.value = ops;
      },
      notify: (msg) => toast(msg, { duration: 2500 }),
    }) ?? null;
}

export const restoreDraft = () => drafts?.restore();

export const operations = signal<DrawOp[]>([]);
export const visibleOperations = computed(() => operations.value.filter(inVisibleLayer));
export const undoStack = signal<(DrawOp | { type: 'clear'; ops: DrawOp[] })[]>([]);
export const commentCounter = computed(() => operations.value.filter((op) => op.tool === 'comment').length);

/** What can happen to the op list: the socket's own vocabulary, so a local edit and a peer's are one thing. */
export type OpChange = Extract<ClientMsg, { type: 'op' | 'update_op' | 'undo' | 'clear' }>;

/** A local change on its way out, already wire-shaped. Set by `connectRoom` while a socket is open. */
export const onChange = signal<((change: OpChange, rollback?: () => void) => void) | null>(null);

/** Peers' strokes reach us unsigned (the schema has no author on a mark), which `isUndoable` would read as mine. */
const peerMarks = new Set<string>();

function isSigned(op: DrawOp): boolean {
  return 'authorId' in op && Boolean(op.authorId);
}

/** To peers and the draft together: forgetting the save loses the edit on reload. */
function emit(change: OpChange, rollback: () => void = () => {}) {
  onChange.value?.(change, () => {
    rollback();
    drafts?.scheduleSave();
  });
  if (change.type === 'clear') drafts?.clear();
  else drafts?.scheduleSave();
}

/**
 * The one writer of `operations` once it is live. A patch is re-validated first, so
 * one that would break the op never lands or leaves this tab, whoever sent it. Local
 * changes go on to the wire and the draft. False when nothing changed.
 */
export function applyChange(change: OpChange, { origin }: { origin: 'local' | 'remote' }): boolean {
  const ops = operations.value;
  let rollback: () => void = () => {};
  switch (change.type) {
    case 'op':
      if (ops.some((o) => o.id === change.op.id)) return false;
      if (origin === 'remote' && !isSigned(change.op)) peerMarks.add(change.op.id);
      operations.value = [...ops, change.op];
      rollback = () => {
        const current = operations.value;
        if (current.some((op) => op.id === change.op.id))
          operations.value = current.filter((op) => op.id !== change.op.id);
      };
      break;
    case 'update_op': {
      const index = ops.findIndex((o) => o.id === change.opId);
      const merged = index < 0 ? null : applyOpPatch({ op: ops[index], patch: change.patch });
      if (!merged) return false;
      const next = ops.slice();
      next[index] = merged;
      operations.value = next;
      const previous = ops[index];
      // What this patch wrote, field by field. A rollback may only undo a field that still holds
      // it: a peer's accepted update that landed in the meantime is newer than our optimistic
      // edit, and restoring the old snapshot over it would leave the board diverged for good.
      const optimistic = Object.fromEntries(
        Object.keys(change.patch).map((key) => [key, (merged as unknown as Record<string, unknown>)[key]]),
      );
      rollback = () => {
        const current = operations.value;
        const currentIndex = current.findIndex((op) => op.id === change.opId);
        if (currentIndex < 0 || !previous) return;
        const target = current[currentIndex] as unknown as Record<string, unknown>;
        const restored = current.slice();
        restored[currentIndex] = {
          ...restored[currentIndex],
          ...Object.fromEntries(
            Object.keys(change.patch)
              .filter((key) => target[key] === optimistic[key])
              .map((key) => [key, (previous as unknown as Record<string, unknown>)[key]]),
          ),
        } as DrawOp;
        operations.value = restored;
      };
      break;
    }
    case 'undo':
      if (!ops.some((o) => o.id === change.opId)) return false;
      operations.value = ops.filter((o) => o.id !== change.opId);
      {
        const previous = ops.find((o) => o.id === change.opId)!;
        const index = ops.indexOf(previous);
        rollback = () => {
          if (operations.value.some((op) => op.id === previous.id)) return;
          const restored = operations.value.slice();
          restored.splice(Math.min(index, restored.length), 0, previous);
          operations.value = restored;
        };
      }
      break;
    case 'clear':
      operations.value = [];
      rollback = () => {
        const current = operations.value;
        const currentIds = new Set(current.map((op) => op.id));
        operations.value = [...ops.filter((op) => !currentIds.has(op.id)), ...current];
      };
      break;
  }
  if (origin === 'local') emit(change, rollback);
  return true;
}

/** Open annotations a copy-for-AI would carry; the toolbar and panel disable their button at zero. */
export const openAnnotationTotal = computed(() => openAnnotationCount(operations.value));

export function copyOpenAnnotations({ ops, url }: { ops: DrawOp[]; url?: string }) {
  const prompt = buildAnnotationsPrompt({ url, ops });
  if (!prompt) {
    toast('No open annotations to copy');
    return;
  }
  const n = openAnnotationCount(ops);
  copyText(prompt, `Copied ${n} annotation${n === 1 ? '' : 's'} for AI!`);
}

// Single-pass partition of operations into comments, selections, areas, inspects, root comments, and reply map
const _opIndex = computed(() => {
  const allComments: CommentOp[] = [];
  const allSelections: SelectionOp[] = [];
  const allAreas: AreaOp[] = [];
  const allInspects: InspectOp[] = [];
  const roots: CommentOp[] = [];
  const replies = new Map<string, CommentOp[]>();
  for (const op of visibleOperations.value) {
    if (op.tool === 'comment') {
      allComments.push(op);
      if (op.parentId) {
        let arr = replies.get(op.parentId);
        if (!arr) {
          arr = [];
          replies.set(op.parentId, arr);
        }
        arr.push(op);
      } else {
        roots.push(op);
      }
    } else if (op.tool === 'selection') {
      allSelections.push(op);
    } else if (op.tool === 'area') {
      allAreas.push(op);
    } else if (op.tool === 'inspect') {
      allInspects.push(op);
    }
  }
  return { allComments, allSelections, allAreas, allInspects, roots, replies };
});

export const comments = computed(() => _opIndex.value.allComments);
export const selections = computed(() => _opIndex.value.allSelections);
export const areas = computed(() => _opIndex.value.allAreas);
export const inspects = computed(() => _opIndex.value.allInspects);
export const rootComments = computed(() => _opIndex.value.roots);

export function getReplies(parentId: string): CommentOp[] {
  return _opIndex.value.replies.get(parentId) ?? [];
}

/** Commit an op. Returns 'held' when batch mode kept the note back until Send, else 'sent'. */
export function pushOp(op: DrawOp): 'held' | 'sent' {
  const signed = signedOp(op);
  if (shouldHold(signed)) {
    holdOp(signed);
    return 'held';
  }
  commitOp(signed);
  return 'sent';
}

/** Every op this person authors carries who: ⌘Z and a rename both find their work by `authorId`. */
const signedOp = (op: DrawOp): DrawOp => {
  const parent =
    op.tool === 'comment' && op.parentId ? operations.peek().find((item) => item.id === op.parentId) : undefined;
  const layerId = parent ? (parent.layerId ?? 'default') : (op.layerId ?? activeLayer.peek());
  return { ...op, ...(isSigned(op) ? {} : signedBy()), ...(layerId === 'default' && !op.layerId ? {} : { layerId }) };
};

/** When each op landed on the shared batch clock, so ⌘Z can tell a held note from a newer stroke. */
const committedAt = new Map<string, number>();

/** An op the app places itself (the landing's demo marks): in the document, but never counted as somebody annotating. */
export function placeOp(op: DrawOp) {
  committedAt.set(op.id, tick());
  if (undoStack.value.length) undoStack.value = [];
  applyChange({ type: 'op', op }, { origin: 'local' });
}

/** `pushOp` without batch holding, for ops the user already chose to send. */
export function commitOp(op: DrawOp) {
  const signed = signedOp(op);
  placeOp(signed);
  track('annotation_created', { tool: signed.tool, reply: 'parentId' in signed && Boolean(signed.parentId) });
  host.actions.onOpMade?.(signed);
}

/**
 * Release the held batch to the room in creation order, then leave the tool.
 * Comment numbers are assigned here: while held they all read the same count.
 */
export function sendHeld() {
  const held = takeHeld();
  if (!held.length) return;
  let num = commentCounter.value;
  batch(() => {
    for (const op of held) commitOp(op.tool === 'comment' ? { ...op, num: ++num } : op);
  });
  activeTool.value = 'navigate';
}

export function pushReply({
  parent,
  text,
  mentions,
  attachments,
}: {
  /** What the reply hangs off: its id, plus the document point it inherits. */
  parent: { id: string; x: number; y: number };
  text: string;
  mentions?: Mention[];
  /** Upload ids of screenshots attached to this reply. */
  attachments?: string[];
}) {
  const op: CommentOp = {
    id: nanoid(),
    tool: 'comment',
    num: commentCounter.value + 1,
    text,
    x: parent.x,
    y: parent.y,
    color: color.value,
    lineWidth: lineWidth.value,
    ts: Date.now(),
    parentId: parent.id,
    ...signedBy(),
    mentions: mentions?.length ? mentions : undefined,
    attachments: attachments?.length ? attachments : undefined,
    meta: getCommentMeta(),
  };
  pushOp(op);
}

export function setOpStatus(opId: string, status: CommentStatus) {
  const op = operations.value.find((o) => o.id === opId);
  if (!op || !isAnnotationOp(op) || resolveOpStatus(op) === status) return;
  // `resolved` is the pre-`status` boolean. Kept in step so a peer or an export
  // still reading it doesn't disagree with the status beside it. Approved counts
  // as resolved here: to a reader that only knows the boolean, a signed-off thread
  // is a finished one.
  const patch = op.tool === 'comment' ? { status, resolved: isSettled(status) } : { status };
  if (!applyChange({ type: 'update_op', opId, patch }, { origin: 'local' })) return;
  // The triage half of the product: whether shared annotations get worked, or just left.
  track('annotation_status_changed', { status });
}

/** Patch any op here and on the wire. Re-validated first, so a patch that breaks the op never leaves this tab. */
export function patchOp({ opId, patch }: { opId: string; patch: Record<string, unknown> }) {
  if (patchHeld({ id: opId, patch })) return;
  applyChange({ type: 'update_op', opId, patch }, { origin: 'local' });
}

/** Toggle the local user's emoji on a comment or reply; the whole list ships as the patch. */
export function toggleOpReaction({ opId, emoji }: { opId: string; emoji: string }) {
  const op = operations.value.find((o) => o.id === opId);
  if (!op || !isAnnotationOp(op)) return;
  const reactions = toggleReaction({ reactions: op.reactions, emoji, by: { id: localUser.id, name: localUser.name } });
  patchOp({ opId, patch: { reactions } });
  track('annotation_reacted', { emoji, on: reactions.length > (op.reactions?.length ?? 0) });
}

/** Set the annotation's triage priority; undefined clears it. */
export function setOpPriority({ opId, priority }: { opId: string; priority: CommentPriority | null }) {
  const op = operations.value.find((o) => o.id === opId);
  if (!op || !isAnnotationOp(op) || (op.priority ?? null) === priority) return;
  if (!applyChange({ type: 'update_op', opId, patch: { priority } }, { origin: 'local' })) return;
  track('annotation_prioritized', { priority: priority ?? 'none' });
}

/** Assign the annotation's thread to a person by display name; null clears it. */
export function setOpAssignee({ opId, assignee }: { opId: string; assignee: string | null }) {
  const op = operations.value.find((o) => o.id === opId);
  if (!op || !isAnnotationOp(op) || (op.assignee ?? null) === assignee) return;
  if (!applyChange({ type: 'update_op', opId, patch: { assignee } }, { origin: 'local' })) return;
  track('annotation_assigned', { cleared: assignee === null });
}

/** Bumped on undo/redo to trigger a canvas flash */
export const undoRedoFlash = signal(0);

const isUndoable = (op: DrawOp | undefined) =>
  op !== undefined &&
  !isReviewOp(op) &&
  !peerMarks.has(op.id) &&
  (!('authorId' in op) || !op.authorId || op.authorId === localUser.id);

export function undo() {
  // Counted as an intent: a press with nothing to undo is still someone reaching for it.
  track('history_action', { action: 'undo' });
  const mine = visibleOperations.value.filter(isUndoable).pop();
  if (undoHeld({ after: (mine && committedAt.get(mine.id)) ?? 0 })) return;
  const ops = operations.value;
  const stack = undoStack.value;
  // While the guide tool is active, ⌘Z pops the most recent guide op specifically —
  // even if a non-guide op was added later — so guide scratch work feels independent.
  const guide =
    activeTool.value === 'guide' ? visibleOperations.value.filter((op) => op.tool === 'guide').pop() : undefined;
  const last = stack[stack.length - 1];
  if (!guide && !ops.length && last && 'type' in last) {
    operations.value = last.ops;
    undoStack.value = stack.slice(0, -1);
    // The clear already emptied the room and deleted the draft; the wire has no bulk restore.
    for (const op of last.ops) emit({ type: 'op', op });
    return;
  }
  // ⌘Z takes back my own marks: a peer's comment, ballot or the agent's checklist can land after my last one.
  const removed = guide ?? mine;
  if (!removed) return;
  undoStack.value = [...stack, removed];
  applyChange({ type: 'undo', opId: removed.id }, { origin: 'local' });
  undoRedoFlash.value++;
}

export function redo() {
  track('history_action', { action: 'redo' });
  const stack = undoStack.value;
  const last = stack[stack.length - 1];
  if (!last || 'type' in last) return;
  undoStack.value = stack.slice(0, -1);
  // Undo deleted it from the room, so redo has to push it back like a new op.
  applyChange({ type: 'op', op: last }, { origin: 'local' });
  undoRedoFlash.value++;
}

export function clearAll() {
  const ops = operations.value;
  if (!ops.length) return;
  if (visibleOperations.value.length !== ops.length) {
    toast('请先显示所有图层，再清除全部批注');
    return;
  }
  if (!confirm('Clear all annotations on this page? Undo brings them back.')) return;
  track('history_action', { action: 'clear', ops: ops.length });
  undoStack.value = [...undoStack.value, { type: 'clear' as const, ops: structuredClone(ops) }];
  applyChange({ type: 'clear' }, { origin: 'local' });
}

/** Take an op off the page and out of the room, reporting nothing: guides count through their own events. */
export function removeOp(id: string) {
  applyChange({ type: 'undo', opId: id }, { origin: 'local' });
}

/** Remove a single op by id. Mirrors `undo` on the wire so peers see it. */
export function deleteOp(id: string) {
  const op = operations.value.find((o) => o.id === id);
  if (!op) return;
  removeOp(id);
  track('annotation_deleted', { tool: op.tool });
}

/** Down-right nudge on a duplicate, so the copy reads as a new object, not a redraw. */
const DUPLICATE_OFFSET = 12;

/**
 * Figma's ⌘D. Annotations have no selection model yet, so this duplicates the most
 * recent duplicable op — the one Figma would have left selected right after you drew
 * it. Repeat presses cascade, because each copy becomes the new most-recent op.
 */
export function duplicateLastOp() {
  // Walked backwards in place: the hit is almost always the last element, and
  // `operations` runs to hundreds of ops that a copy-then-reverse would touch twice.
  const ops = visibleOperations.value;
  for (let i = ops.length - 1; i >= 0; i--) {
    const op = ops[i];
    const moved = op && translateOp({ op, dx: DUPLICATE_OFFSET, dy: DUPLICATE_OFFSET });
    if (!moved) continue;
    // The element anchor is dropped: re-resolving it would snap the copy back onto
    // the original and eat the offset.
    // So is the signature: the copy is mine even when the original was a peer's.
    const copy = { ...moved, id: nanoid(), target: undefined, authorId: undefined };
    // An area op carries a `ts`, and the copy was made now, not when the original was.
    pushOp(copy.tool === 'area' ? { ...copy, ts: Date.now() } : copy);
    return;
  }
  toast('Nothing to duplicate', { duration: 1800 });
}
