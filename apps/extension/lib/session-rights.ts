import { computed, signal } from '@preact/signals';
import { host } from './host-config';
import { toast, toasts } from './toasts';

/** What the room says about our write access. Undefined until it says, and outside a room. */
export const canEditFromRoom = signal<boolean | undefined>(undefined);

/** The host holds this session view-only whatever the room says: the web's `?readonly=1`. */
export const forcedReadonly = signal(false);

/** Whether this session may change the room at all. Unanswered counts as yes, as it does on the server. */
export const canWrite = computed(() => !forcedReadonly.value && canEditFromRoom.value !== false);

/** Status changes, verdicts and deletes: anyone who may write, unless the host withholds triage (the widget). */
export function canTriage(): boolean {
  return canWrite.value && host.capabilities.triage;
}

const VIEW_ONLY = 'This link is view-only';

/** True when a local write may go ahead; otherwise says why and the caller drops it. */
export function admitWrite(): boolean {
  if (canWrite.peek()) return true;
  // A rename patches every op this person wrote in one batch: one toast, not one each.
  if (!toasts.peek().some((t) => t.message === VIEW_ONLY)) toast(VIEW_ONLY, { type: 'info' });
  return false;
}
