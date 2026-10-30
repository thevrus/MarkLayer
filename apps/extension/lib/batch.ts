import { type AnnotationOp, applyOpPatch, type DrawOp, isAnnotationOp } from '@marklayer/types';
import { signal } from '@preact/signals';
import { persistedFlag } from './storage';

export const BATCH_KEY = 'marklayer:batch-edits';

/** Batch edits: notes are held on this page until Send, instead of reaching the room on save. */
export const [batchMode, toggleBatchMode] = persistedFlag({ key: BATCH_KEY, fallback: false });

/** Only the extension draws held pins and the Send control; the web viewer sends every note as before. */
export const batchAvailable = signal(false);

/**
 * Notes made under batch mode, in creation order. Memory only, so a reload drops
 * them: until Send they must not reach drafts, peers or agents.
 */
export const heldOps = signal<AnnotationOp[]>([]);

/** Root annotations are held; a reply answers a thread that is already live, so it goes out. */
export function shouldHold(op: DrawOp): op is AnnotationOp {
  return batchAvailable.value && batchMode.value && isAnnotationOp(op) && !('parentId' in op && op.parentId);
}

/** A shared clock for held and committed ops: strokes carry no `ts`, and ms ties are common. */
let clock = 0;
export const tick = () => ++clock;
const heldAt = new Map<string, number>();

export function holdOp(op: AnnotationOp) {
  heldAt.set(op.id, tick());
  heldOps.value = [...heldOps.value, op];
}

export function removeHeld(id: string) {
  heldAt.delete(id);
  heldOps.value = heldOps.value.filter((op) => op.id !== id);
}

/** The note's own words: a comment's text, or the `comment` the other kinds carry beside their target. */
export function heldNote(op: AnnotationOp): string {
  return (op.tool === 'comment' ? op.text : op.comment) ?? '';
}

export function editHeld({ id, note }: { id: string; note: string }) {
  heldOps.value = heldOps.value.map((op) => {
    if (op.id !== id) return op;
    return op.tool === 'comment' ? { ...op, text: note } : { ...op, comment: note };
  });
}

/** Apply a late patch (a screenshot, an upload) to a note still held; false when it is not held. */
export function patchHeld({ id, patch }: { id: string; patch: object }): boolean {
  if (!heldOps.value.some((op) => op.id === id)) return false;
  heldOps.value = heldOps.value.map((op) => {
    if (op.id !== id) return op;
    const merged = applyOpPatch({ op, patch });
    return merged && isAnnotationOp(merged) ? merged : op;
  });
  return true;
}

export const clearHeld = () => void takeHeld();

/** True for a few seconds after the first "Clear All" press; the second press within it discards. */
export const clearArmed = signal(false);
const CLEAR_CONFIRM_MS = 3000;
let clearTimer: ReturnType<typeof setTimeout> | undefined;

export function pressClear() {
  clearTimeout(clearTimer);
  if (clearArmed.value) {
    clearArmed.value = false;
    clearHeld();
    return;
  }
  clearArmed.value = true;
  clearTimer = setTimeout(() => {
    clearArmed.value = false;
  }, CLEAR_CONFIRM_MS);
}

/**
 * ⌘Z takes back the newest held note, but only if it is newer than `after` (the tick of
 * my latest committed op); otherwise that op is the one to undo. False when nothing was taken.
 */
export function undoHeld({ after }: { after: number }): boolean {
  const ops = heldOps.value;
  const newest = ops[ops.length - 1];
  if (!newest || (heldAt.get(newest.id) ?? 0) <= after) return false;
  heldAt.delete(newest.id);
  heldOps.value = ops.slice(0, -1);
  return true;
}

/** Empty the batch and hand it over, once: a second call gets nothing. */
export function takeHeld(): AnnotationOp[] {
  const ops = heldOps.value;
  heldOps.value = [];
  heldAt.clear();
  return ops;
}
