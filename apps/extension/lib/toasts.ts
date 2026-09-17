import { signal } from '@preact/signals';
import { track } from './analytics';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface Toast {
  id: number;
  message: string;
  type?: 'info' | 'success' | 'error';
  action?: ToastAction;
}
let _toastId = 0;
export const toasts = signal<Toast[]>([]);

/** Per-toast dismiss timer, kept outside the signal so pausing it never touches render state. */
const timers = new Map<number, { timer: ReturnType<typeof setTimeout>; remaining: number; startedAt: number }>();

function dismiss(id: number) {
  timers.delete(id);
  toasts.value = toasts.value.filter((t) => t.id !== id);
}

/** Hold a toast open — for a pointer or keyboard focus resting on it. */
export function pauseToast(id: number) {
  const t = timers.get(id);
  if (!t) return;
  clearTimeout(t.timer);
  t.remaining -= Date.now() - t.startedAt;
}

/** Resume the dismiss countdown from wherever `pauseToast` left it. */
export function resumeToast(id: number) {
  const t = timers.get(id);
  if (!t) return;
  t.startedAt = Date.now();
  t.timer = setTimeout(() => dismiss(id), Math.max(t.remaining, 0));
}

export function toast(
  message: string,
  { type = 'info', duration = 3000, action }: { type?: Toast['type']; duration?: number; action?: ToastAction } = {},
) {
  const id = ++_toastId;
  toasts.value = [...toasts.value, { id, message, type, action }];
  timers.set(id, { timer: setTimeout(() => dismiss(id), duration), remaining: duration, startedAt: Date.now() });
}

/** Copy text to clipboard with success/error toast feedback. */
export function copyText(text: string, label = 'Copied') {
  navigator.clipboard.writeText(text).then(
    () => {
      // The clipboard is how work leaves this product — an element handed to an
      // AI agent, a markdown export, a share link — so the one path they share
      // is where it gets counted. `label` names the flow and is a fixed string.
      track('copied', { label, chars: text.length });
      toast(label, { type: 'success' });
    },
    () => {
      track('copy_failed', { label });
      toast('Failed to copy', { type: 'error' });
    },
  );
}
