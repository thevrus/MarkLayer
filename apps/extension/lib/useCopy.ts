import { useSignal } from '@preact/signals';
import { useEffect, useRef } from 'preact/hooks';
import { toast } from './state';

/**
 * Click-to-copy state shared by every copy control. The controls look nothing
 * alike (a pill button, a wrapping command field) but the behavior is one
 * thing: write, flash `copied` briefly, toast on failure. The timer is cleared
 * on unmount so a copy made just before the panel closes can't wake a dead
 * component.
 */
export function useCopyToClipboard({ resetMs = 1400 }: { resetMs?: number } = {}) {
  const copied = useSignal(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const copy = (value: string) => {
    navigator.clipboard.writeText(value).then(
      () => {
        copied.value = true;
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          copied.value = false;
        }, resetMs);
      },
      () => toast('Failed to copy', 'error'),
    );
  };

  return { copied, copy };
}
