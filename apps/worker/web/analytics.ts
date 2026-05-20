// Lazy facade around posthog-js. Eagerly importing posthog adds ~50 KB gz to
// the client entry; here we defer the import to idle and buffer captures so
// call sites stay synchronous (`capture('x', { ... })`).

type Props = Record<string, unknown>;
type Posthog = {
  init: (key: string, opts: Record<string, unknown>) => void;
  capture: (event: string, props?: Props) => void;
};

const queue: Array<[string, Props | undefined]> = [];
let posthog: Posthog | null = null;

export function capture(event: string, props?: Props): void {
  if (posthog) {
    posthog.capture(event, props);
    return;
  }
  queue.push([event, props]);
}

export function initAnalytics(key: string, host: string | undefined): void {
  const load = async () => {
    const mod = await import('posthog-js');
    posthog = mod.default as Posthog;
    posthog.init(key, {
      api_host: host,
      defaults: '2026-01-30',
      ip: false,
      autocapture: false,
      capture_pageview: true,
      capture_pageleave: true,
      capture_exceptions: true,
    });
    for (const [event, props] of queue) posthog.capture(event, props);
    queue.length = 0;
  };

  const idle = (globalThis as { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback;
  if (typeof idle === 'function') idle(load);
  else setTimeout(load, 0);
}
