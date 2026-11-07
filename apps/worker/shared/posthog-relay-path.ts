/**
 * First-party path for posthog-js. Ad blockers match on PostHog's hostnames, so
 * a direct `us.i.posthog.com` drops a share of pageviews and every replay chunk.
 * Deliberately not `/ingest` or `/analytics`: filter lists name those too.
 */
export const RELAY_PREFIX = '/_r';
