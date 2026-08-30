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
 *
 * One deliberate exception exists, and it is `blockedDomain` below: the
 * registrable domain of a page that *refused* us. See the note there for why
 * that one is worth its own carve-out.
 */

import { parseFetchableUrl } from '@marklayer/types';

/**
 * PostHog's Error Tracking payload: a list of exception objects, each with a
 * type, a human-readable value, and how it was raised. `synthetic` marks one
 * that was reported rather than thrown, which is all of ours.
 * https://posthog.com/docs/error-tracking/installation/manual
 */
interface ExceptionEntry {
  type: string;
  value: string;
  mechanism: { handled: boolean; synthetic: boolean };
}

type CaptureProps = Record<string, string | number | boolean | null | undefined | readonly ExceptionEntry[]>;

/** Absolute URLs, protocol-relative URLs, and bare `host.tld/…` references. */
const URL_IN_TEXT = /\b(?:[a-z][a-z0-9+.-]*:\/\/|\/\/|www\.)\S+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)+(?::\d+)?(?:\/\S*)?/gi;

/** Free-text (error messages) is the usual way a URL sneaks in. Cap it too. */
const MAX_TEXT_LEN = 200;

function scrubValue(value: string): string {
  return value.replace(URL_IN_TEXT, '<redacted>').slice(0, MAX_TEXT_LEN);
}

/**
 * A bare hostname: labels and dots, nothing that could carry a path or a query.
 * The last label must start with a letter, which is what separates a name from
 * an IPv4 literal — `93.184.216.34` is otherwise all legal domain characters.
 */
const BARE_DOMAIN = /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z][a-z0-9-]*$/;

/**
 * The one property name exempt from URL redaction. Only `blockedDomain()` produces a
 * value for these, and `scrub` re-checks the shape rather than trusting that:
 * the exemption is a key, and a key is easy to reuse by hand at a new call site
 * with a full URL behind it.
 */
const DOMAIN_KEY = 'blocked_domain';

function scrub(props: CaptureProps): CaptureProps {
  const out: CaptureProps = {};
  for (const [key, value] of Object.entries(props)) {
    if (typeof value !== 'string') {
      out[key] = value;
      continue;
    }
    out[key] = key === DOMAIN_KEY && BARE_DOMAIN.test(value) ? value : scrubValue(value);
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

/**
 * Second-level labels that are a registry suffix rather than a name someone
 * owns, so `bbc.co.uk` reduces to `bbc.co.uk` and not `co.uk`. Not the public
 * suffix list — that is a 15k-entry file to answer a question this covers for
 * practically every site anyone annotates, and erring costs one label either
 * way on an obscure ccTLD.
 */
const REGISTRY_SLDS = new Set(['ac', 'co', 'com', 'edu', 'go', 'gob', 'gov', 'mil', 'ne', 'net', 'or', 'org']);

/**
 * The registrable domain of a page that refused us, or `null` if there is not
 * one worth reporting.
 *
 * This is the single exception to "no hosts, ever" at the top of this file, and
 * it is narrow on purpose:
 *
 *  - Only on failure. Which sites refuse us is the thing we have to know to fix
 *    the proxy and to ask a host to let us through. Which sites *worked* is a
 *    log of what people annotate, which is the thing we promised not to keep.
 *  - Only the registrable domain. `staging-x9f2.acme.com` is somebody's unlisted
 *    environment; `acme.com` is a company with a support address. Reducing to
 *    eTLD+1 keeps the part we act on and drops the part that was the secret.
 *  - Never a private or otherwise blocked target: internal by definition, and
 *    already refused before any fetch is attempted.
 */
export function blockedDomain(raw: string | URL): string | null {
  const gate = parseFetchableUrl(raw);
  if (!gate.ok) return null;

  const host = gate.url.hostname.toLowerCase();
  // Excludes address literals: a public IP still names one machine, not a site
  // anyone runs, so there is nobody to reach out to.
  if (!BARE_DOMAIN.test(host)) return null;

  const labels = host.split('.');
  const tld = labels[labels.length - 1];
  const sld = labels[labels.length - 2];
  const take = labels.length > 2 && tld.length === 2 && REGISTRY_SLDS.has(sld) ? 3 : 2;
  return labels.slice(-take).join('.');
}

/** What refused us, and how. One value per way a site can turn the proxy away. */
export type BlockKind = 'firewall-challenge' | 'http-error' | 'fetch-threw';

interface BlockReport {
  kind: BlockKind;
  /** The URL that failed. Reduced to its registrable domain before it leaves. */
  url: string;
  /** Upstream status, when there was a response at all. */
  status?: number;
  /** Whether the fixed-IP relay or Cloudflare's shared egress was refused. */
  via?: string;
  /** The thrown error, for `fetch-threw`. Scrubbed like any other free text. */
  message?: string;
}

/**
 * Report a site that would not let the proxy in, as a PostHog Error Tracking
 * issue rather than a plain counter.
 *
 * The fingerprint is the domain, so every blocked site is one issue with a live
 * count and a triage state: work around a firewall and resolve it, mail a host
 * and leave it open. That is the list — "which sites reject us, and what have we
 * done about each" — which a breakdown on a counter event cannot hold.
 *
 * Call sites hand over a URL, never a built exception: the payload is nested,
 * `scrub` only walks the top level, and an `$exception_list` assembled out there
 * would be a hole straight through every rule this file exists to enforce.
 */
export function captureBlockedSite(
  env: { POSTHOG_KEY?: string; POSTHOG_HOST?: string },
  ctx: { waitUntil(promise: Promise<unknown>): void },
  report: BlockReport,
) {
  const domain = blockedDomain(report.url);
  if (!domain) return;

  const detail = [report.status ? `status ${report.status}` : null, report.via ? `via ${report.via}` : null]
    .filter(Boolean)
    .join(', ');

  captureServer(env, ctx, '$exception', {
    $exception_list: [
      {
        type: BLOCK_TYPES[report.kind],
        value: scrubValue(
          `${domain} refused the proxy${detail ? ` (${detail})` : ''}${report.message ? `: ${report.message}` : ''}`,
        ),
        mechanism: { handled: true, synthetic: true },
      },
    ],
    // One issue per site, not per failure mode: a host that answers a challenge
    // today and a 403 tomorrow is still the same site to fix and the same people
    // to write to.
    $exception_fingerprint: `proxy-blocked:${domain}`,
    $issue_name: `Proxy blocked by ${domain}`,
    blocked_domain: domain,
    reason: report.kind,
    status: report.status,
    via: report.via,
  });
}

const BLOCK_TYPES: Record<BlockKind, string> = {
  'firewall-challenge': 'ProxyFirewallChallenge',
  'http-error': 'ProxyHttpError',
  'fetch-threw': 'ProxyFetchFailed',
};
