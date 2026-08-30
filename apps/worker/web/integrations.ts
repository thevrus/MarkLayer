import { lsGet, lsSet } from '@ext/lib/state';
import {
  type ConfigFieldInfo,
  type DestinationSummary,
  destinationListSchema,
  type ProviderInfo,
  providerCatalogueSchema,
} from '@marklayer/types';
import { computed, signal } from '@preact/signals';
import { API_BASE } from './signals';

/**
 * The room's destinations, in one place.
 *
 * Two surfaces need this: the settings panel that configures a destination, and
 * the thread control that files an annotation at one. Fetched once and held
 * here rather than in either of them, because a panel that has just connected
 * Linear and a menu that still says nothing is connected is the kind of
 * disagreement nobody reports and everybody notices.
 *
 * The shapes are parsed, not guessed at: both responses are wire data, and
 * `ConfigFieldInfo.type` in particular decides whether a token may be stored.
 */
export type { ConfigFieldInfo, DestinationSummary, ProviderInfo } from '@marklayer/types';
export { destinationListSchema };

export const providerCatalogue = signal<ProviderInfo[]>([]);
export const destinations = signal<DestinationSummary[]>([]);

/**
 * Where a single annotation can actually be filed: connected to this room, and
 * asked rather than automatic. A Slack hook is connected too, and posting one
 * comment to it on demand is not what the control means.
 */
export const fileTargets = computed(() =>
  destinations.value
    .map((d) => providerCatalogue.value.find((p) => p.id === d.provider))
    .filter((p): p is ProviderInfo => p !== undefined && p.trigger === 'manual'),
);

/** One string off an unknown body, without asserting a shape onto it. */
export function stringField(body: unknown, key: string): string | null {
  const value = typeof body === 'object' && body !== null ? Reflect.get(body, key) : null;
  return typeof value === 'string' ? value : null;
}

/** The room the signals above describe, so a second caller does not refetch. */
let loadedFor: string | null = null;

/**
 * Fill the signals for a room, at most once unless asked again.
 *
 * Stays quiet on failure: a room whose catalogue did not load should render
 * without the file control, not with an error about a feature nobody asked for.
 */
export async function loadIntegrations({ id, force = false }: { id: string; force?: boolean }): Promise<void> {
  if (loadedFor === id && !force) return;
  loadedFor = id;
  try {
    const [catalogue, mine] = await Promise.all([
      fetch(`${API_BASE}providers`).then((r) => (r.ok ? r.json() : null)),
      fetch(`${API_BASE}${id}/integrations`).then((r) => (r.ok ? r.json() : null)),
    ]);
    const parsedCatalogue = providerCatalogueSchema.safeParse(catalogue);
    const parsedMine = destinationListSchema.safeParse(mine);
    if (parsedCatalogue.success) providerCatalogue.value = parsedCatalogue.data.providers;
    if (parsedMine.success) destinations.value = parsedMine.data.integrations;
  } catch {
    // Offline. Leave the signals as they are and let both surfaces stay quiet.
    loadedFor = null;
  }
}

/**
 * Credentials stay in the browser that owns them.
 *
 * A room stores where to file; it never stores what authorises it, because the
 * share link is the room's only access control and that link goes to clients by
 * design. So the token lives here, in the filer's own browser, and is sent with
 * the one request that uses it. Keyed by provider rather than by room: it is the
 * person's token, and re-typing it for every room they open would guarantee
 * nobody uses this twice.
 *
 * localStorage is readable by script on this origin, so this is a real trade and
 * not a perfect one — but it is the person's own browser holding their own
 * token, rather than our database holding it on behalf of everyone with a link.
 * Scope the token to issue-creation and it stays a small blast radius either way.
 */
const secretKey = ({ provider, field }: { provider: string; field: string }) => `ml.secret.${provider}.${field}`;

/** Whatever this browser holds for a provider. Missing keys are simply absent. */
export function readSecrets(provider: ProviderInfo): Record<string, string> {
  const found: Record<string, string> = {};
  for (const field of provider.fields) {
    if (field.type !== 'secret') continue;
    const value = lsGet(secretKey({ provider: provider.id, field: field.name }));
    if (value) found[field.name] = value;
  }
  return found;
}

/** Remember this browser's credentials for a provider, best effort. */
export function saveSecrets({ provider, values }: { provider: ProviderInfo; values: Record<string, string> }): void {
  for (const field of provider.fields) {
    if (field.type !== 'secret') continue;
    const value = values[field.name]?.trim();
    if (!value) continue;
    lsSet(secretKey({ provider: provider.id, field: field.name }), value);
  }
}

/** The credential fields this browser cannot supply yet. */
export function missingSecrets(provider: ProviderInfo): ConfigFieldInfo[] {
  const held = readSecrets(provider);
  return provider.fields.filter((f) => f.type === 'secret' && !held[f.name]);
}
