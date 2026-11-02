/**
 * Sleeps that one call can cancel together, for scripted landing animations that
 * run as an async loop inside an effect: `clear()` in the cleanup, and every
 * pending `wait` simply never resolves, so the loop stops where it stood.
 */
export function timerScope() {
  const timers = new Set<number>();
  return {
    wait: (ms: number) =>
      new Promise<void>((resolve) => {
        const t = window.setTimeout(() => {
          timers.delete(t);
          resolve();
        }, ms);
        timers.add(t);
      }),
    clear: () => {
      for (const t of timers) clearTimeout(t);
      timers.clear();
    },
  };
}
