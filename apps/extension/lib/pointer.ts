/** Keep a captured pointer's events flowing to us even over foreign content. */
export function capturePointer({ target, pointerId }: { target: EventTarget | null; pointerId: number }) {
  if (!(target instanceof Element)) return;
  try {
    target.setPointerCapture(pointerId);
  } catch {
    // The pointer can already be gone (fast tap, cancelled gesture) — the
    // shield and the document listeners still carry the drag on their own.
  }
}

/**
 * Sample the pointer on every move but run `onFrame` at most once per frame:
 * pointermove fires faster than the display refreshes (and in bursts after a
 * busy frame), so acting on each event just piles up work the compositor
 * throws away. `flush` lands the last sample instead of dropping the frame.
 */
export function pointerSampler({ event, onFrame }: { event: PointerEvent; onFrame: (x: number, y: number) => void }) {
  let frame = 0;
  let px = event.clientX;
  let py = event.clientY;
  const run = () => {
    frame = 0;
    onFrame(px, py);
  };
  return {
    sample(ev: PointerEvent) {
      px = ev.clientX;
      py = ev.clientY;
      if (!frame) frame = requestAnimationFrame(run);
    },
    flush() {
      if (!frame) return;
      cancelAnimationFrame(frame);
      run();
    },
    cancel() {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    },
  };
}
