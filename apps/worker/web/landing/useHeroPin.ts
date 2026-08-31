import { lineWidth, operations } from '@ext/lib/state';
import { useEffect } from 'preact/hooks';
import { seedDeviceOp } from '../signals';
import { HERO_PIN_ID } from './content';

/**
 * Put one real annotation on the board.
 *
 * Measured off the URL field rather than hard-coded, so the pin sits on it at
 * every width instead of drifting into the copy on a narrow screen. It waits
 * for `document.fonts.ready` and then a frame: the hero's height depends on
 * Geist's metrics and on ChannelCycle measuring its word slot, and both land
 * after first paint — measuring in a plain mount effect put the pin ~300px
 * high, above the headline instead of on the field.
 */
export function useHeroPin(heroFormRef: { current: HTMLFormElement | null }): void {
  useEffect(() => {
    let cancelled = false;

    const place = () => {
      const form = heroFormRef.current;
      if (cancelled || !form) return;
      const r = form.getBoundingClientRect();
      // A zero-width rect means layout still has not settled; placing the pin
      // off that would park it against the left edge of the page.
      if (r.width === 0) return;
      // Just off the field's right edge, level with its centre.
      //
      // It sat on the field's top-right corner until a click test showed it
      // covering a 16x12px bite out of the submit button — the pin layer
      // re-enables pointer events for the pin itself, so `elementFromPoint` on
      // the button's own corner returned the pin and that corner was dead. It
      // still reads as attached to the field at this distance, and it no longer
      // sits on top of the page's primary action.
      const x = r.right + window.scrollX + 30;
      const y = r.top + r.height / 2 + window.scrollY;
      const seeded = operations.peek().find((op) => op.id === HERO_PIN_ID);
      if (seeded) {
        if (seeded.tool !== 'comment' || (seeded.x === x && seeded.y === y)) return;
        operations.value = operations.peek().map((op) => (op.id === HERO_PIN_ID ? { ...op, x, y } : op));
        return;
      }
      seedDeviceOp({
        id: HERO_PIN_ID,
        tool: 'comment',
        num: 1,
        text: 'This pin is real. Open it, reply to it, resolve it, then drop your own anywhere on the page.',
        x,
        y,
        // From the peer-cursor palette, so the mark belongs to the same
        // vocabulary as the people already on the board.
        color: '#8b5cf6',
        lineWidth: lineWidth.peek(),
        ts: Date.now(),
        author: 'Yuki',
      });
    };

    let timer: ReturnType<typeof setTimeout>;
    // Only the viewport changing moves the field. Watching the document instead
    // would re-place the pin every time a FAQ row opened.
    const onResize = () => {
      clearTimeout(timer);
      timer = setTimeout(place, 120);
    };
    document.fonts.ready.then(() => {
      requestAnimationFrame(place);
    });
    window.addEventListener('resize', onResize);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      window.removeEventListener('resize', onResize);
    };
  }, [heroFormRef]);
}
