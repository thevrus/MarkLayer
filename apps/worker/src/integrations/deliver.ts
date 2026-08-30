import { type Integration, parseFetchableUrl, roomIntegrationsSchema } from '@marklayer/types';
import { providerById } from './providers';
import { type OutboundRequest, type Provider, ROOM_EVENT_TYPES, type RoomEvent } from './types';

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
 * A config with its secrets taken out, which is all the server keeps.
 *
 * The room id is the share link, so anything stored against a room is readable
 * by everyone the room was shared with — which for this product is the client.
 * A webhook URL is an honest thing to store on those terms: it is write-only and
 * scoped to one channel. An API token for a tracker is not, so it is never
 * stored at all. See docs/adr/0004.
 */
export function publicConfig({
  provider,
  config,
}: {
  provider: Provider;
  config: Record<string, unknown>;
}): Record<string, unknown> {
  const secret = new Set(provider.fields.filter((f) => f.type === 'secret').map((f) => f.name));
  return Object.fromEntries(Object.entries(config).filter(([name]) => !secret.has(name)));
}

/**
 * The stored config plus the secrets whoever is filing just supplied, which is
 * the only moment a complete config exists anywhere.
 *
 * Only keys the provider itself declares secret are taken from the request, so a
 * caller cannot use this path to rewrite the repository a room files into.
 */
export function withSecrets({
  provider,
  config,
  secrets,
}: {
  provider: Provider;
  config: Record<string, unknown>;
  secrets: Record<string, string>;
}): Record<string, unknown> {
  const merged = { ...config };
  for (const field of provider.fields) {
    if (field.type !== 'secret') continue;
    const value = secrets[field.name];
    if (typeof value === 'string' && value) merged[field.name] = value;
  }
  return merged;
}

/** Whether every secret a provider needs is present and non-empty. */
export function hasAllSecrets({ provider, config }: { provider: Provider; config: Record<string, unknown> }): boolean {
  return provider.fields
    .filter((f) => f.type === 'secret')
    .every((f) => typeof config[f.name] === 'string' && config[f.name] !== '');
}

/**
 * Validate one destination without sending anything.
 *
 * Takes a loose shape on purpose: this is the boundary that decides whether an
 * unknown provider is a provider at all, so it has to be able to be handed one.
 *
 * The API uses this to refuse a bad configuration at the point somebody saves it, rather
 * than silently never delivering. Returns the reason so the UI can say which of
 * the two things went wrong, and the resolved provider so the caller does not
 * have to look it up again and handle a miss that cannot happen.
 */
export function validateIntegration(integration: {
  provider: string;
  config: unknown;
}): { ok: true; provider: Provider } | { ok: false; reason: string } {
  const provider = providerById(integration.provider);
  if (!provider) return { ok: false, reason: 'unknown provider' };
  // Every event the provider might see, because declining one is a legitimate
  // thing for a provider to do: an issue tracker refuses `annotations.created`
  // by design. Rendering any of them proves the config is the shape it wants,
  // which is the only question this function asks.
  // Stand-ins for the secrets, because they are deliberately not stored: this
  // is checking that the parts a room DOES keep are the right shape — that the
  // repository is `owner/name`, that the Jira site is a bare tenant — which is
  // exactly what is worth refusing at the point somebody types it.
  const stubbed = Object.fromEntries(
    provider.fields.filter((f) => f.type === 'secret').map((f) => [f.name, 'validation-placeholder']),
  );
  const config =
    typeof integration.config === 'object' && integration.config !== null
      ? { ...integration.config, ...stubbed }
      : integration.config;

  let rendered: OutboundRequest | null = null;
  for (const type of ROOM_EVENT_TYPES) {
    rendered = provider.render({
      event: { type, items: [{ kind: 'Comment', author: 'test', text: 'test' }] },
      config,
      roomUrl: 'https://marklayer.app/s/test',
      pageUrl: null,
    });
    if (rendered) break;
  }

  if (!rendered) return { ok: false, reason: 'missing or malformed configuration' };

  if (!isAllowedUrl({ url: rendered.url, allowedHosts: provider.allowedHosts })) {
    return { ok: false, reason: `not a URL ${provider.label} accepts` };
  }
  return { ok: true, provider };
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

/** A response body over this is not one we are going to find an issue URL in. */
const MAX_RESULT_BYTES = 64_000;

/** Why a destination refused, in the terms the person who configured it thinks in. */
function statusReason({ status, label }: { status: number; label: string }): string {
  // Status first, because it is the thing the room owner can act on. 401 and
  // 403 are a credential; 404 is an id that no longer resolves; the rest is
  // the destination having a bad day, and repeating its prose does not help.
  if (status === 401 || status === 403) return `${label} rejected the token`;
  if (status === 404) return `${label} could not find that project`;
  if (status === 429) return `${label} is rate limiting. Try again shortly`;
  // Deliberately not followed, so say so rather than reporting a bare 301.
  if (status >= 300 && status < 400) return `${label} redirected the request`;
  return `${label} returned ${status}`;
}

/**
 * The outbound transport, in one place: resolve the provider, render, guard the
 * URL it produced, POST it, and read the body back.
 *
 * `deliver` and `deliverOne` differ in what they do with a failure, not in how
 * they send. The redirect policy below is a security decision, so it gets one
 * home rather than two copies that can drift.
 *
 * Never throws: every failure comes back as a reason.
 */
async function send({
  integration,
  event,
  roomUrl,
  pageUrl,
  trigger,
}: {
  integration: Integration;
  event: RoomEvent;
  roomUrl: string;
  pageUrl: string | null;
  trigger: Provider['trigger'];
}): Promise<{ ok: true; provider: Provider; body: unknown } | { ok: false; reason: string }> {
  const provider = providerById(integration.provider);
  if (!provider) return { ok: false, reason: 'unknown provider' };

  // The manifest decides which destinations each path may reach, so a chat hook
  // cannot be filed at by hand and a tracker cannot be raised off a batch. The
  // API route checks this too; enforcing it here is what makes that a courtesy
  // rather than the only thing standing between the two.
  if (provider.trigger !== trigger) {
    const reason =
      trigger === 'manual'
        ? `${provider.label} posts automatically and cannot be filed to`
        : `${provider.label} only sends when someone files an annotation`;
    return { ok: false, reason };
  }

  const rendered = provider.render({ event, config: integration.config, roomUrl, pageUrl });
  if (!rendered) return { ok: false, reason: `${provider.label} cannot file this annotation` };

  // The guard runs on the URL the provider actually produced, not on the one
  // that was stored, so a template that builds a URL cannot slip past it.
  if (!isAllowedUrl({ url: rendered.url, allowedHosts: provider.allowedHosts })) {
    return { ok: false, reason: `not a URL ${provider.label} accepts` };
  }

  let res: Response;
  try {
    res = await fetch(rendered.url, {
      method: 'POST',
      headers: rendered.headers,
      body: rendered.body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      // `manual`, never `follow`: a destination that answers a POST with a
      // redirect must not carry the credential to a host `isAllowedUrl`
      // never approved — following would route around the guard entirely.
      // It is also the only option that works: workerd rejects `error`
      // outright ("won't be implemented since it does not make sense at the
      // edge"), which threw on every single send until this was found. A 3xx
      // is not `res.ok`, so it already counts as a failed delivery.
      redirect: 'manual',
    });
  } catch {
    return { ok: false, reason: `Could not reach ${provider.label}` };
  }

  // Read once, whatever the status: the failure bodies carry the useful part.
  const raw = (await res.text().catch(() => '')).slice(0, MAX_RESULT_BYTES);
  let body: unknown = null;
  try {
    body = JSON.parse(raw);
  } catch {
    body = null;
  }

  if (!res.ok) return { ok: false, reason: statusReason({ status: res.status, label: provider.label }) };
  return { ok: true, provider, body };
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
    integrations.map((integration) => send({ integration, event, roomUrl, pageUrl, trigger: 'auto' })),
  );

  const sent = results.filter((r) => r.ok).length;
  return { sent, failed: results.length - sent };
}

/**
 * Send one annotation to one destination, and say what happened.
 *
 * The opposite contract to `deliver`: somebody is watching this one. `deliver`
 * swallows every failure because a dead chat hook must never stop an annotation
 * saving, but a person who just pressed "file this" is owed the reason it did
 * not work — a rejected token and an unreachable host need different fixes, and
 * "nothing happened" tells them neither.
 *
 * Still never throws. The reason is returned, not raised.
 */
export async function deliverOne({
  integration,
  event,
  roomUrl,
  pageUrl,
}: {
  integration: Integration;
  event: RoomEvent;
  roomUrl: string;
  pageUrl: string | null;
}): Promise<{ ok: true; url: string | null } | { ok: false; reason: string }> {
  const result = await send({ integration, event, roomUrl, pageUrl, trigger: 'manual' });
  if (!result.ok) return result;

  // A GraphQL destination can answer 200 and still refuse the mutation, so a
  // provider that knows how to read its own body decides, not the status line.
  const { provider, body } = result;
  const url = provider.parseResult?.(body) ?? null;
  if (provider.parseResult && url === null) return { ok: false, reason: `${provider.label} declined to create it` };
  return { ok: true, url };
}
