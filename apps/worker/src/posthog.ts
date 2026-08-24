/**
 * Server-side telemetry, deliberately blunt.
 *
 * MarkLayer is open source and people point it at pages we have no business
 * knowing about: localhost, internal staging, unlisted docs, URLs carrying a
 * session token in the query string. Room IDs are the same class of secret —
 * a share link is unlisted and unauthenticated, so the ID *is* the credential.
 *
 * Two rules hold for every event sent from here:
 *
 *  1. No person profiles. `$process_person_profile: false` records the event
 *     without creating or updating a person, so there is no per-user record to
 *     join, export, or hand over. Nothing here is a user; it is a counter.
 *  2. No URLs, hosts, or room IDs — ever. `scrub()` enforces this at the edge
 *     rather than trusting call sites, because the call sites already got it
 *     wrong once: `proxy_render_failed` shipped the full annotated URL.
 *
 * What is fair game: enum-ish reasons, HTTP status codes, durations, counts.
 * Aggregate product signal, nothing that points at a person or a page.
 */

type CaptureProps = Record<string, string | number | boolean | null | undefined>;

/** Absolute URLs, protocol-relative URLs, and bare `host.tld/…` references. */
const URL_IN_TEXT = /\b(?:[a-z][a-z0-9+.-]*:\/\/|\/\/|www\.)\S+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)+(?::\d+)?(?:\/\S*)?/gi;

/** Free-text (error messages) is the usual way a URL sneaks in. Cap it too. */
const MAX_TEXT_LEN = 200;

function scrubValue(value: string): string {
  return value.replace(URL_IN_TEXT, '<redacted>').slice(0, MAX_TEXT_LEN);
}

function scrub(props: CaptureProps): CaptureProps {
  const out: CaptureProps = {};
  for (const [key, value] of Object.entries(props)) {
    out[key] = typeof value === 'string' ? scrubValue(value) : value;
  }
  return out;
}

/**
 * Telemetry is optional — a self-hosted deployment is meant to run without a
 * key. But returning silently meant every server-side event was discarded in
 * production for months while client-side events flowed normally, and nothing
 * anywhere said so. Warn once per isolate instead; `observability.logs` in
 * wrangler.jsonc is what makes it visible.
 */
let warnedMissingKey = false;

export function captureServer(
  env: { POSTHOG_KEY?: string; POSTHOG_HOST?: string },
  // Only waitUntil is used — narrowing to it keeps this off the workers-types
  // ExecutionContext shape (v5 added a required `tracing` field Hono's
  // c.executionCtx doesn't carry), and lets a Durable Object pass its own ctx.
  ctx: { waitUntil(promise: Promise<unknown>): void },
  event: string,
  props: CaptureProps,
) {
  const key = env.POSTHOG_KEY;
  if (!key) {
    if (!warnedMissingKey) {
      warnedMissingKey = true;
      console.warn('captureServer: POSTHOG_KEY is unset, so no server-side telemetry is being sent.');
    }
    return;
  }
  const host = env.POSTHOG_HOST || 'https://us.i.posthog.com';
  const body = JSON.stringify({
    api_key: key,
    event,
    // PostHog requires a distinct_id. A constant one plus the flag below means
    // every event lands on the project without ever building a person record,
    // which is the point: these are counters, not visitors.
    distinct_id: 'marklayer-server',
    properties: { source: 'worker', $process_person_profile: false, ...scrub(props) },
    timestamp: new Date().toISOString(),
  });
  ctx.waitUntil(
    fetch(`${host}/capture/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    }).catch(() => {}),
  );
}
