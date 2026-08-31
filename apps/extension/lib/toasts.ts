import { signal } from '@preact/signals';
import { track } from './analytics';

export interface Toast {
  id: number;
  message: string;
  type?: 'info' | 'success' | 'error';
}
let _toastId = 0;
export const toasts = signal<Toast[]>([]);
export function toast(message: string, type: Toast['type'] = 'info', duration = 3000) {
  const id = ++_toastId;
  toasts.value = [...toasts.value, { id, message, type }];
  setTimeout(() => {
    toasts.value = toasts.value.filter((t) => t.id !== id);
  }, duration);
}

/** Copy text to clipboard with success/error toast feedback. */
export function copyText(text: string, label = 'Copied') {
  navigator.clipboard.writeText(text).then(
    () => {
      // The clipboard is how work leaves this product — an element handed to an
      // AI agent, a markdown export, a share link — so the one path they share
      // is where it gets counted. `label` names the flow and is a fixed string.
      track('copied', { label, chars: text.length });
      toast(label, 'success');
    },
    () => {
      track('copy_failed', { label });
      toast('Failed to copy', 'error');
    },
  );
}
