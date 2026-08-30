import { type Integration, parseFetchableUrl, roomIntegrationsSchema } from '@marklayer/types';
import { providerById } from './providers';
import type { RoomEvent } from './types';

/** Outbound sends give up here. A destination is not worth stalling a flush for. */
const TIMEOUT_MS = 5000;

/**
 * Whether a rendered URL is one this provider is allowed to reach.
 *
 * The single security decision of the integrations layer, in one function, with
 * one caller. Providers never see it — they return a URL and this decides.
 *
 * A host in `allowedHosts` starting with a dot is a suffix match, for the
 * tenant-specific subdomains Teams issues. Anything else is an exact host match,
 * so `hooks.slack.com.evil.test` cannot pass as `hooks.slack.com`.
 */
export function isAllowedUrl({ url, allowedHosts }: { url: string; allowedHosts: readonly string[] }): boolean {
  // The same gate the iframe proxy and the fetch relay pass through, so there is
  // one definition of "address we refuse to fetch" — it parses, rejects a
  // non-HTTP scheme, and runs the private-address guard. That guard is the
  // security line, and it runs for every provider rather than only the ones with
  // no allowlist: an allowlist is a list of names someone maintains, this is what
  // keeps the Worker off the internal network whether or not that list is current.
  const gate = parseFetchableUrl(url);
  // No plaintext on top of that: these carry a credential in the path.
  if (!gate.ok || gate.url.protocol !== 'https:') return false;
  const parsed = gate.url;

  // Advisory on top of that: did you paste the right kind of URL for this
  // destination. An empty list means the provider accepts any public host.
  if (allowedHosts.length === 0) return true;
  return allowedHosts.some((h) => (h.startsWith('.') ? parsed.hostname.endsWith(h) : parsed.hostname === h));
}

/**
 * Validate one destination without sending anything.
 *
 * Takes a loose shape on purpose: this is the boundary that decides whether an
 * unknown provider is a provider at all, so it has to be able to be handed one.
 *
 * The API uses this to refuse a bad configuration at the point somebody saves it, rather
 * than silently never delivering. Returns the reason so the UI can say which of
 * the two things went wrong.
 */
export function validateIntegration(integration: {
  provider: string;
  config: unknown;
}): { ok: true } | { ok: false; reason: string } {
  const provider = providerById(integration.provider);
  if (!provider) return { ok: false, reason: 'unknown provider' };
  const rendered = provider.render({
    event: { type: 'annotations.created', items: [{ kind: 'Comment', author: 'test', text: 'test' }] },
    config: integration.config,
    roomUrl: 'https://marklayer.app/s/test',
    pageUrl: null,
  });
  if (!rendered) return { ok: false, reason: 'missing or malformed configuration' };
  if (!isAllowedUrl({ url: rendered.url, allowedHosts: provider.allowedHosts })) {
    return { ok: false, reason: `not a URL ${provider.label} accepts` };
  }
  return { ok: true };
}

/** Parse the stored JSON column into destinations, dropping anything malformed. */
export function parseIntegrations(raw: string | null): Integration[] {
  if (!raw) return [];
  try {
    const parsed = roomIntegrationsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

/**
 * Send one event to every destination a room has.
 *
 * Never throws and never rejects: a broken destination is the room owner's
 * problem to fix, not a reason for an annotation to fail to save. Returns how
 * many sends succeeded so the caller can stop calling a hook that is gone.
 */
export async function deliver({
  integrations,
  event,
  roomUrl,
  pageUrl,
}: {
  integrations: Integration[];
  event: RoomEvent;
  roomUrl: string;
  pageUrl: string | null;
}): Promise<{ sent: number; failed: number }> {
  const results = await Promise.all(
    integrations.map(async (integration) => {
      const provider = providerById(integration.provider);
      if (!provider) return false;

      const rendered = provider.render({ event, config: integration.config, roomUrl, pageUrl });
      if (!rendered) return false;

      // The guard runs on the URL the provider actually produced, not on the one
      // that was stored, so a template that builds a URL cannot slip past it.
      if (!isAllowedUrl({ url: rendered.url, allowedHosts: provider.allowedHosts })) return false;

      try {
        const res = await fetch(rendered.url, {
          method: 'POST',
          headers: rendered.headers,
          body: rendered.body,
          signal: AbortSignal.timeout(TIMEOUT_MS),
          redirect: 'error',
        });
        return res.ok;
      } catch {
        return false;
      }
    }),
  );

  const sent = results.filter(Boolean).length;
  return { sent, failed: results.length - sent };
}
