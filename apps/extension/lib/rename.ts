import { isAnnotationOp } from '@marklayer/types/ops';
import { batch } from '@preact/signals';
import { announceProfile, localUser, PROFILE_SETTLE_MS, saveIdentity, userName } from './identity';
import { applyChange, operations } from './ops';
import { toast } from './toasts';

/**
 * The name your existing annotations were written under. A rename has to reach
 * them too — `author` is a stored string, so leaving it alone makes one person
 * show up in a room as two — but not on every keystroke, hence the settle.
 */
let authoredName: string | null = null;
let relabelTimer: ReturnType<typeof setTimeout> | undefined;
const RELABEL_SETTLE_MS = 1200;

/**
 * Ignores an empty name instead of rolling a random one: the field applies as
 * you type, and clearing it to retype must not silently rename you mid-word.
 */
export function setUserName(name: string) {
  const trimmed = name.trim();
  if (!trimmed || trimmed === userName.value) return;
  // Read here, not at import: the name settles at `initHost`.
  authoredName ??= userName.value;
  userName.value = trimmed;
  saveIdentity({ name: trimmed });
  // The field applies as you type, but each broadcast is a Durable Object
  // attachment write plus a fan-out to every peer, so a 15-character name would
  // be 15 of each. Settling briefly still reads as live and costs one.
  announceProfile({ settleMs: PROFILE_SETTLE_MS });
  // The paper trail follows once the typing stops.
  clearTimeout(relabelTimer);
  relabelTimer = setTimeout(relabelOwnWork, RELABEL_SETTLE_MS);
}

/**
 * Carry a rename onto the work already signed with the old name: your own
 * annotations and their replies, plus any thread assigned to you.
 *
 * Ownership is matched on `authorId` where the op has one. Ops written before
 * that field existed can only be matched by the old name, which is also the
 * only handle `assignee` ever offers — so a peer who happens to share your old
 * name is the one ambiguity here, and the card warns before you take one.
 *
 * Safe to call at any time: it returns 0 when there is nothing to carry.
 */
export function relabelOwnWork(): number {
  clearTimeout(relabelTimer);
  const previous = authoredName;
  const next = userName.value;
  authoredName = next;
  if (!previous || previous === next) return 0;

  const patches: { opId: string; patch: { author?: string; assignee?: string } }[] = [];
  for (const op of operations.value) {
    if (!isAnnotationOp(op)) continue;
    const mine = op.authorId ? op.authorId === localUser.id : op.author === previous;
    const patch: { author?: string; assignee?: string } = {};
    if (mine && op.author === previous) patch.author = next;
    if (op.assignee === previous) patch.assignee = next;
    if (patch.author || patch.assignee) patches.push({ opId: op.id, patch });
  }

  // Nothing written when nothing moved: signals compare by identity, so a fresh
  // array would re-partition `_opIndex` and re-render every layer for a rename
  // that touched nothing — the common case.
  if (!patches.length) return 0;
  batch(() => {
    for (const { opId, patch } of patches) applyChange({ type: 'update_op', opId, patch }, { origin: 'local' });
  });
  // Said out loud because it is a bulk edit of work already on the page, and
  // because it fires from a settle timer as well as from closing the card.
  toast(`Updated your name on ${patches.length} annotation${patches.length === 1 ? '' : 's'}`);
  return patches.length;
}
