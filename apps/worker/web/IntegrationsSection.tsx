import { Menu } from '@base-ui/react/menu';
import { PanelSection } from '@ext/components/PanelSection';
import { geist } from '@ext/lib/geist';
import { toast } from '@ext/lib/toasts';
import { cn } from '@marklayer/ui/cn';
import { Check, Ellipsis, Send } from 'lucide-preact';
import { useEffect, useState } from 'preact/hooks';
import { MAX_INTEGRATIONS_PER_ROOM, slackAppStatusSchema } from '../shared/integrations';
import { capture } from './analytics';
import { Help, helpFor, Input, LabelledField } from './IntegrationFields';
import {
  type DestinationSummary,
  destinationListSchema,
  destinations,
  loadIntegrations,
  type ProviderInfo,
  providerCatalogue,
  SLACK_BASE,
  saveSecrets,
  slackApp,
  stringField,
} from './integrations';
import { API_BASE } from './projects';

/**
 * The provider catalogue is fetched as data rather than compiled in.
 *
 * This is what keeps the client flat: adding Teams or Linear server-side adds a
 * row to that list and zero bytes to the bundle everyone downloads.
 * The catalogue and this room's destinations live in ./integrations, because the
 * thread control reads them too;
 * the field primitives live in ./IntegrationFields for the same reason.
 */

/**
 * Split by when a destination fires, because that is the one thing a person
 * cannot guess from the name: Slack gets every batch, Linear only what is filed.
 */
const GROUPS = [
  { trigger: 'auto', label: 'Every new annotation' },
  { trigger: 'manual', label: 'Threads you file' },
] as const;

const menuItem =
  'flex w-full items-center px-2.5 py-2 rounded-md text-ui cursor-pointer outline-none data-highlighted:bg-(--ds-gray-alpha-100)';

/**
 * One destination per row, every one visible at once, set up in place.
 *
 * A row list rather than the select it replaced: a closed select hides which of
 * eleven destinations are already connected, and that is the question this
 * section opens on. No logos — Slack's and Microsoft's trademark policies bar
 * third-party use of their marks, and a row of initials in tiles is worse than
 * the names alone.
 *
 * The room id is the only credential involved, which is the bargain the rest of
 * the product makes too: whoever holds the share link is a participant. The copy
 * says so rather than implying a privacy the link cannot provide.
 */
export function IntegrationsSection({ id }: { id: string }) {
  const providers = providerCatalogue.value;
  const configured = destinations.value;
  const [open, setOpen] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void loadIntegrations({ id });
  }, [id]);

  const set = (name: string, v: string) => setValues((prev) => ({ ...prev, [name]: v }));
  // Nothing typed for Slack belongs in Linear's token box.
  const toggle = (providerId: string | null) => {
    setOpen((current) => (current === providerId ? null : providerId));
    setValues({});
  };

  /**
   * One request per change, and never a stored config in either direction: the
   * server is never sent a credential it already has, so adding a destination
   * cannot blank the ones already there.
   */
  const send = async (req: { url: string; method: string; body?: string }, event: string, provider?: string) => {
    setBusy(true);
    try {
      const res = await fetch(req.url, {
        method: req.method,
        headers: req.body ? { 'Content-Type': 'application/json' } : undefined,
        body: req.body,
      });
      const body = await res.json().catch(() => null);
      const parsed = destinationListSchema.safeParse(body);
      if (!res.ok || !parsed.success) {
        // The API names which destination it refused and why, and the reason is
        // almost always "that is not the kind of URL this one takes".
        toast(stringField(body, 'error') ?? 'Could not save destinations', { type: 'error', duration: 4500 });
        return false;
      }
      destinations.value = parsed.data.integrations;
      capture(event, { provider });
      return true;
    } finally {
      setBusy(false);
    }
  };

  const connect = async (provider: ProviderInfo) => {
    const ready = provider.fields.every((f) => (values[f.name] ?? '').trim());
    if (!ready || busy) return;
    // The token half never leaves this browser. What the room stores is where to
    // file — the repository, the project key — and nothing that authorises it.
    saveSecrets({ provider, values });
    const config = Object.fromEntries(
      provider.fields.filter((f) => f.type !== 'secret').map((f) => [f.name, (values[f.name] ?? '').trim()]),
    );
    const ok = await send(
      {
        url: `${API_BASE}${id}/integrations`,
        method: 'POST',
        body: JSON.stringify({ provider: provider.id, config }),
      },
      'integration_added',
      provider.id,
    );
    // Kept open on failure: a rejected token should not take the four fields the
    // person got right down with it.
    if (ok) {
      toggle(null);
      toast(`${provider.label} connected`, { type: 'success' });
    }
  };

  const disconnect = (providerId: string) =>
    void send(
      { url: `${API_BASE}${id}/integrations/${encodeURIComponent(providerId)}`, method: 'DELETE' },
      'integration_removed',
      providerId,
    );

  const full = configured.length >= MAX_INTEGRATIONS_PER_ROOM;

  return (
    <PanelSection icon={Send} label="Integrations" count={configured.length || undefined}>
      <div class="flex flex-col gap-3">
        {GROUPS.map((group) => {
          const rows = providers.filter((p) => p.trigger === group.trigger);
          if (rows.length === 0) return null;
          return (
            <section key={group.trigger} aria-label={group.label} class="flex flex-col">
              <h3 class={cn(geist.sectionLabel, 'm-0 mb-1')}>{group.label}</h3>
              <ul class="m-0 flex list-none flex-col p-0">
                {group.trigger === 'auto' && slackApp.value.enabled && <SlackAppRow id={id} />}
                {rows.map((provider) => (
                  <ProviderRow
                    key={provider.id}
                    provider={provider}
                    connection={configured.find((c) => c.provider === provider.id) ?? null}
                    open={open === provider.id}
                    busy={busy}
                    full={full}
                    values={values}
                    onToggle={() => toggle(provider.id)}
                    onInput={set}
                    onConnect={() => void connect(provider)}
                    onDisconnect={() => disconnect(provider.id)}
                  />
                ))}
              </ul>
            </section>
          );
        })}

        {/* Said once, at the bottom, where it is a caveat rather than the first
              thing between the reader and the control they came for. */}
        <p class="m-0 text-meta leading-snug text-(--ds-gray-900)">
          Up to {MAX_INTEGRATIONS_PER_ROOM} per room. Tracker tokens stay in your browser, never in the room. Anyone
          with the room link can change these.
        </p>
      </div>
    </PanelSection>
  );
}

function ProviderRow({
  provider,
  connection,
  open,
  busy,
  full,
  values,
  onToggle,
  onInput,
  onConnect,
  onDisconnect,
}: {
  provider: ProviderInfo;
  connection: DestinationSummary | null;
  open: boolean;
  busy: boolean;
  full: boolean;
  values: Record<string, string>;
  onToggle: () => void;
  onInput: (name: string, value: string) => void;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  const formId = `integration-${provider.id}`;
  return (
    <li class="flex flex-col border-b border-(--ds-gray-alpha-400) py-2 last:border-b-0">
      <div class="flex items-center gap-2">
        <div class="flex min-w-0 flex-1 flex-col">
          <span class="truncate text-ui font-medium text-(--ds-gray-1000)">{provider.label}</span>
          {connection ? (
            <span class="flex min-w-0 items-center gap-1 text-meta text-(--ds-green-900)">
              <Check size={12} strokeWidth={2} aria-hidden="true" class="shrink-0" />
              <span class="truncate">
                Connected
                {connection.hint && <span class="text-(--ds-gray-900)"> · {connection.hint}</span>}
              </span>
            </span>
          ) : (
            <span class="text-meta leading-snug text-(--ds-gray-900)">{provider.blurb}</span>
          )}
        </div>

        {connection && !open ? (
          <Menu.Root>
            <Menu.Trigger
              aria-label={`${provider.label} options`}
              disabled={busy}
              className={cn(
                geist.actionBtn,
                'mx-0 shrink-0 px-1 text-(--ds-gray-900) hover:bg-(--ds-gray-alpha-100) hover:text-(--ds-gray-1000) data-popup-open:bg-(--ds-gray-alpha-100)',
              )}
            >
              <Ellipsis size={16} strokeWidth={1.5} aria-hidden="true" />
            </Menu.Trigger>
            <Menu.Portal>
              <Menu.Positioner side="bottom" align="end" sideOffset={4} className="z-2147483647">
                <Menu.Popup className={cn(geist.surface, 'min-w-40 p-1 text-(--ds-gray-1000)')}>
                  <Menu.Item className={menuItem} onClick={onToggle}>
                    Change settings
                  </Menu.Item>
                  <Menu.Item className={cn(menuItem, 'data-highlighted:text-(--ds-red-700)')} onClick={onDisconnect}>
                    Disconnect
                  </Menu.Item>
                </Menu.Popup>
              </Menu.Positioner>
            </Menu.Portal>
          </Menu.Root>
        ) : (
          <button
            type="button"
            onClick={onToggle}
            disabled={busy || (full && !open)}
            aria-expanded={open}
            aria-controls={formId}
            title={full && !open ? `A room holds at most ${MAX_INTEGRATIONS_PER_ROOM} destinations` : undefined}
            class={cn(
              geist.actionBtn,
              'mx-0 shrink-0 px-2 hover:bg-(--ds-gray-alpha-200)',
              open ? 'text-(--ds-gray-900)' : 'bg-(--ds-gray-alpha-100) text-(--ds-gray-1000)',
            )}
          >
            {open ? 'Cancel' : 'Set up'}
          </button>
        )}
      </div>

      {open && <SetupForm id={formId} provider={provider} values={values} busy={busy} {...{ onInput, onConnect }} />}
    </li>
  );
}

/**
 * A chat hook is one URL and reads best with Connect inside the field. An issue
 * tracker needs a token, a project and where to file it, and four unlabelled
 * boxes in a column are unusable — so the shape of the form follows the
 * destination rather than one compromise that suits neither.
 */
function SetupForm({
  id,
  provider,
  values,
  busy,
  onInput,
  onConnect,
}: {
  id: string;
  provider: ProviderInfo;
  values: Record<string, string>;
  busy: boolean;
  onInput: (name: string, value: string) => void;
  onConnect: () => void;
}) {
  const fields = provider.fields;
  const single = fields.length === 1 ? fields[0] : null;
  const ready = fields.length > 0 && fields.every((f) => (values[f.name] ?? '').trim());
  const button = (extra: string) => (
    <button
      type="button"
      onClick={onConnect}
      disabled={busy || !ready}
      class={cn(geist.actionBtn, 'mx-0 px-2 text-(--ds-gray-1000) hover:bg-(--ds-gray-alpha-200)', extra)}
    >
      {busy ? 'Saving…' : 'Connect'}
    </button>
  );

  if (single) {
    return (
      <div id={id} class="mt-2 flex flex-col gap-1">
        <div class={cn(geist.field, 'flex items-center gap-1 py-0 pr-1 pl-2.5')}>
          <Input field={single} value={values[single.name] ?? ''} onInput={onInput} onEnter={onConnect} />
          {button('shrink-0')}
        </div>
        <Help field={single} text={helpFor(single)} />
      </div>
    );
  }

  return (
    <div id={id} class="mt-2 flex flex-col gap-2">
      {fields.map((f) => (
        <LabelledField
          key={f.name}
          id={`${id}-${f.name}`}
          field={f}
          label={f.label}
          value={values[f.name] ?? ''}
          onInput={onInput}
          onEnter={onConnect}
        />
      ))}
      <div class="flex justify-end">{button('bg-(--ds-gray-alpha-100)')}</div>
    </div>
  );
}

/**
 * The two-way Slack app. Not a catalogue row: it installs through Slack's OAuth
 * screen, which also picks the channel, so "Set up" is a navigation, not a form.
 */
function SlackAppRow({ id }: { id: string }) {
  const connection = slackApp.value.connection;
  const [busy, setBusy] = useState(false);
  const installUrl = `${SLACK_BASE}/install?room=${encodeURIComponent(id)}`;

  const disconnect = async () => {
    setBusy(true);
    try {
      const res = await fetch(`${SLACK_BASE}?room=${encodeURIComponent(id)}`, { method: 'DELETE' });
      const parsed = slackAppStatusSchema.safeParse(await res.json().catch(() => null));
      if (!res.ok || !parsed.success) {
        toast('Could not disconnect Slack', { type: 'error', duration: 4500 });
        return;
      }
      slackApp.value = parsed.data;
      capture('integration_removed', { provider: 'slack_app' });
    } finally {
      setBusy(false);
    }
  };

  const where = connection?.channel ? `#${connection.channel.replace(/^#/, '')}` : connection?.team;
  return (
    <li class="flex flex-col border-b border-(--ds-gray-alpha-400) py-2 last:border-b-0">
      <div class="flex items-center gap-2">
        <div class="flex min-w-0 flex-1 flex-col">
          <span class="truncate text-ui font-medium text-(--ds-gray-1000)">Slack, two-way</span>
          {connection ? (
            <span class="flex min-w-0 items-center gap-1 text-meta text-(--ds-green-900)">
              <Check size={12} strokeWidth={2} aria-hidden="true" class="shrink-0" />
              <span class="truncate">
                Connected
                {where && <span class="text-(--ds-gray-900)"> · {where}</span>}
              </span>
            </span>
          ) : (
            <span class="text-meta leading-snug text-(--ds-gray-900)">
              A thread per comment. Replies sync both ways.
            </span>
          )}
        </div>

        {connection ? (
          <Menu.Root>
            <Menu.Trigger
              aria-label="Slack options"
              disabled={busy}
              className={cn(
                geist.actionBtn,
                'mx-0 shrink-0 px-1 text-(--ds-gray-900) hover:bg-(--ds-gray-alpha-100) hover:text-(--ds-gray-1000) data-popup-open:bg-(--ds-gray-alpha-100)',
              )}
            >
              <Ellipsis size={16} strokeWidth={1.5} aria-hidden="true" />
            </Menu.Trigger>
            <Menu.Portal>
              <Menu.Positioner side="bottom" align="end" sideOffset={4} className="z-2147483647">
                <Menu.Popup className={cn(geist.surface, 'min-w-40 p-1 text-(--ds-gray-1000)')}>
                  <Menu.Item className={menuItem} onClick={() => window.location.assign(installUrl)}>
                    Change channel
                  </Menu.Item>
                  <Menu.Item
                    className={cn(menuItem, 'data-highlighted:text-(--ds-red-700)')}
                    onClick={() => void disconnect()}
                  >
                    Disconnect
                  </Menu.Item>
                </Menu.Popup>
              </Menu.Positioner>
            </Menu.Portal>
          </Menu.Root>
        ) : (
          <a
            href={installUrl}
            onClick={() => capture('integration_added', { provider: 'slack_app' })}
            class={cn(
              geist.actionBtn,
              'mx-0 shrink-0 bg-(--ds-gray-alpha-100) px-2 text-(--ds-gray-1000) no-underline hover:bg-(--ds-gray-alpha-200)',
            )}
          >
            Set up
          </a>
        )}
      </div>
    </li>
  );
}
