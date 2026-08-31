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

import { type AnalyticsProps, type Surface, setAnalytics } from '@ext/lib/analytics';

type Props = AnalyticsProps;
type Role = 'editor' | 'viewer';
type Posthog = {
  init: (key: string, opts: Record<string, unknown>) => void;
  capture: (event: string, props?: Props) => void;
};

const queue: Array<[string, Props | undefined]> = [];
let posthog: Posthog | null = null;
/** Set once analytics can never load — opted out, no key, or the import failed. */
let dropping = false;
let surface: Surface = 'viewer';

/**
 * Editor or read-only viewer, as a per-event label — not an identity. DAU/WAU and
 * retention counted a share link opened once the same as a session someone drew
 * in; this separates the two without a person profile or anything that survives
 * the page load.
 */
let role: Role = 'editor';

/** Called from signals.ts, which cannot be imported here — it imports `capture`. */
export function setRole(next: Role): void {
  role = next;
}

/**
 * One page load reports an event at most this many times, and buffers at most
 * this many before posthog-js arrives. Both are runaway guards, not budgets: a
 * viewer left open on a dead network retries its websocket forever, and without
 * a ceiling that is one event every ten seconds until the tab closes.
 */
const MAX_PER_EVENT = 500;
const MAX_QUEUED = 200;
const counts = new Map<string, number>();

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
  // Both ambient labels land here rather than in `capture` so they also reach the
  // $pageview/$pageleave posthog-js sends itself — the events the DAU/WAU counts
  // are built from, which `capture` never sees. `role` is viewer-only: the
  // marketing page has no readonly state, and naming the surfaces that do label
  // themselves keeps a surface added later opted out until someone decides.
  out.surface ??= surface;
  if (surface === 'viewer') out.role = role;
  return out;
}

export function capture(event: string, props?: Props): void {
  if (dropping) return;
  const seen = counts.get(event) ?? 0;
  if (seen >= MAX_PER_EVENT) return;
  counts.set(event, seen + 1);
  // `surface` is not stamped here: sanitize_properties does it for every event,
  // including the queued ones, which drain through posthog.capture below.
  if (posthog) {
    posthog.capture(event, props);
    return;
  }
  if (queue.length >= MAX_QUEUED) queue.shift();
  queue.push([event, props]);
}

const firedOnce = new Set<string>();

/**
 * Capture an event at most once per page load. Used for the events that gate
 * session replay recording: the trigger only needs to fire once, and a repeat
 * per brush stroke would be pure noise.
 */
export function captureOnce(event: string, props?: Props): void {
  if (firedOnce.has(event)) return;
  firedOnce.add(event);
  capture(event, props);
}

export function initAnalytics({ key, host, surface: from }: { key?: string; host?: string; surface: Surface }): void {
  surface = from;
  // Nothing will ever drain the buffer without a key (dev, and any self-host
  // that leaves telemetry off), so say so rather than queueing for the page's life.
  if (!key || hasOptedOut()) {
    dropping = true;
    queue.length = 0;
    return;
  }
  // The shared extension components ship with no transport of their own; this is
  // what makes their events countable on the web. See @ext/lib/analytics.
  setAnalytics({ sink: capture, surface: from });

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

  // An ad blocker or an offline load rejects the import; without this the buffer
  // fills for the life of the page and the rejection goes unhandled.
  const start = () => {
    load().catch(() => {
      dropping = true;
      queue.length = 0;
    });
  };
  const idle = (globalThis as { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback;
  if (typeof idle === 'function') idle(start);
  else setTimeout(start, 0);
}
