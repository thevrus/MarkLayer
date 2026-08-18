// Lazy facade around posthog-js. Eagerly importing posthog adds ~50 KB gz to
// the client entry; here we defer the import to idle and buffer captures so
// call sites stay synchronous (`capture('x', { ... })`).
//
// Privacy posture (see also apps/worker/src/posthog.ts, the server twin):
// MarkLayer is open source and the viewer URL embeds both the page being
// annotated (`?url=`) and the room ID (`#id=`), which is an unlisted share
// credential. A stock pageview would ship both to PostHog on every load, so
// `sanitize_properties` strips every query string and fragment before anything
// leaves the browser. We also skip person profiles entirely — these are
// aggregate counters, not visitors — and honour Do Not Track.

type Props = Record<string, unknown>;
type Posthog = {
  init: (key: string, opts: Record<string, unknown>) => void;
  capture: (event: string, props?: Props) => void;
};

const queue: Array<[string, Props | undefined]> = [];
let posthog: Posthog | null = null;

/** Opt-out escape hatch for self-hosters and anyone who wants it off locally. */
const OPT_OUT_KEY = 'marklayer:no-analytics';

function hasOptedOut(): boolean {
  try {
    return localStorage.getItem(OPT_OUT_KEY) !== null;
  } catch {
    // Storage can throw in a partitioned/blocked context. Fail closed.
    return true;
  }
}

/**
 * Reduce any absolute URL to origin + path. Drops `?url=<annotated page>` and
 * `#id=<room secret>` on the viewer, and search terms off inbound referrers.
 */
function stripUrl(value: string): string {
  // posthog-js hands us ~20 string props per autocaptured event ($browser, $os,
  // $screen_*, …) and almost none are URLs. Without this guard every one of
  // them constructs and unwinds a TypeError.
  if (!value.includes('://')) return value;
  try {
    const u = new URL(value);
    return `${u.origin}${u.pathname}`;
  } catch {
    return value;
  }
}

function sanitize(props: Props): Props {
  const out: Props = {};
  for (const [key, value] of Object.entries(props)) {
    out[key] = typeof value === 'string' ? stripUrl(value) : value;
  }
  return out;
}

export function capture(event: string, props?: Props): void {
  if (posthog) {
    posthog.capture(event, props);
    return;
  }
  queue.push([event, props]);
}

export function initAnalytics(key: string, host: string | undefined): void {
  if (hasOptedOut()) return;

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
      // No person records: events are counted, nobody is profiled. Also stops
      // posthog-js writing the identity cookie, so the viewer stays cookieless.
      person_profiles: 'never',
      respect_dnt: true,
      // Replay records the MarkLayer chrome only: the proxied page renders in a
      // same-origin iframe, so rrweb would capture other people's pages — the
      // iframe carries `ph-no-capture` (see Viewer.tsx) and replays as a blank box.
      // maskAllInputs is the default, but pinned here so a project-settings
      // change can never start capturing typed text.
      session_recording: { maskAllInputs: true },
      disable_surveys: true,
      sanitize_properties: sanitize,
    });
    for (const [event, props] of queue) posthog.capture(event, props);
    queue.length = 0;
  };

  const idle = (globalThis as { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback;
  if (typeof idle === 'function') idle(load);
  else setTimeout(load, 0);
}
