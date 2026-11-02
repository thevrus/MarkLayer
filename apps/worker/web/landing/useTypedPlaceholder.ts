import { prefersReducedMotion } from '@ext/lib/media';
import { type ReadonlySignal, useSignal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { timerScope } from './timerScope';

const PLACEHOLDER = 'Paste any URL to annotate…';
// Pages people actually send for review, so the field shows what belongs in it.
const EXAMPLES = ['yourclient.com/pricing', 'staging.yourapp.com/checkout', 'en.wikipedia.org/wiki/Typography'];
const ROUND = [PLACEHOLDER, ...EXAMPLES];

/**
 * The URL field's placeholder, typed: the instruction, then each example backspaced
 * in and out, then the instruction again. Stops for good on `stop`, the first time
 * the visitor engages the field. Static under reduced motion.
 */
export function useTypedPlaceholder(): { text: ReadonlySignal<string>; stop: () => void } {
  const text = useSignal(PLACEHOLDER);
  const stopped = useSignal(false);

  useEffect(() => {
    if (stopped.value || prefersReducedMotion()) return;
    const { wait, clear } = timerScope();
    const run = async () => {
      for (let i = 0; ; i++) {
        const line = ROUND[i % ROUND.length] ?? PLACEHOLDER;
        await wait(line === PLACEHOLDER ? 3200 : 1800);
        for (let n = line.length - 1; n >= 0; n--) {
          await wait(18);
          text.value = line.slice(0, n);
        }
        const next = ROUND[(i + 1) % ROUND.length] ?? PLACEHOLDER;
        await wait(300);
        for (let n = 1; n <= next.length; n++) {
          await wait(40 + Math.random() * 50);
          text.value = next.slice(0, n);
        }
      }
    };
    run();
    return () => {
      clear();
      text.value = PLACEHOLDER;
    };
  }, [stopped.value, text]);

  return {
    text,
    stop: () => {
      stopped.value = true;
    },
  };
}
