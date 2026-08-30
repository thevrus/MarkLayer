import { effect, type ReadonlySignal } from '@preact/signals';

/**
 * Surface-agnostic telemetry seam for the components shared by the extension,
 * the web viewer and the landing page's live demo.
 *
 * Only the web app has a transport (posthog-js, wired in apps/worker/web/main.tsx).
 * Importing one here would ship a tracker into every page the extension's content
 * script runs on, so the host injects a sink instead and the extension leaves it
 * unset, making every `track()` from a shared component a no-op there.
 *
 * Props are scalars by construction: the privacy contract in
 * apps/worker/src/posthog.ts is a scrubber over flat values, and an object
 * slipped through here would sail past it.
 */
export type AnalyticsProps = Record<string, string | number | boolean | null | undefined>;
export type AnalyticsSink = (event: string, props?: AnalyticsProps) => void;

/** Which build is reporting. The landing demo is its own surface: its tool clicks are interest, not work. */
export type Surface = 'extension' | 'viewer' | 'landing';

// Plain values, not signals: they are written once at startup and nothing derives
// from them. As signals they made every effect that calls `track()` subscribe to
// the sink, so installing it re-ran those effects and reported a change nobody made.
let sink: AnalyticsSink | null = null;
let surface: Surface = 'extension';

export function setAnalytics(next: { sink: AnalyticsSink; surface: Surface }) {
  sink = next.sink;
  surface = next.surface;
}

export function track(event: string, props?: AnalyticsProps): void {
  sink?.(event, { surface, ...props });
}

/**
 * Report a signal's changes, never its initial value — the value a page loads
 * with is not a choice anyone made. Shared because every "count this signal"
 * effect otherwise carries its own module-level first-run flag.
 */
export function trackChanges<T>(signal: ReadonlySignal<T>, report: (value: T) => void): void {
  let seen = signal.peek();
  effect(() => {
    const value = signal.value;
    if (value === seen) return;
    seen = value;
    report(value);
  });
}
