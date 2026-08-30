import { PanelSection } from '@ext/components/PanelSection';
import { ScrollTrack } from '@ext/components/ScrollTrack';
import { geist } from '@ext/lib/geist';
import { toast } from '@ext/lib/state';
import { cn } from '@marklayer/types';
import { Send } from 'lucide-preact';
import { useEffect, useState } from 'preact/hooks';
import { capture } from './analytics';
import { Help, helpFor, Input, LabelledField } from './IntegrationFields';
import {
  destinationListSchema,
  destinations,
  loadIntegrations,
  providerCatalogue,
  saveSecrets,
  stringField,
} from './integrations';
import { API_BASE } from './signals';

/**
 * The provider catalogue is fetched as data rather than compiled in.
 *
 * This is what keeps the client flat: adding Teams or Linear server-side adds a
 * row to that list and zero bytes to the bundle everyone downloads. See
 * docs/adr/0003-outbound-integrations.md. The catalogue and this room's
 * destinations live in ./integrations, because the thread control reads them too;
 * the field primitives live in ./IntegrationFields for the same reason.
 */

/**
 * Send this room's new annotations somewhere: a Slack or Teams channel, Discord,
 * or any URL that wants JSON.
 *
 * The room id is the only credential involved, which is the bargain the rest of
 * the product makes too: whoever holds the share link is a participant. The copy
 * says so rather than implying a privacy the link cannot provide.
 */
export function IntegrationsSection({ id }: { id: string }) {
  const providers = providerCatalogue.value;
  const configured = destinations.value;
  const [picked, setPicked] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void loadIntegrations({ id });
  }, [id]);

  // Defaulted here rather than at load, so the catalogue arriving after this
  // panel mounts still lands on a selected tab instead of an empty form.
  const active = picked || (providers[0]?.id ?? '');

  const provider = providers.find((p) => p.id === active);
  const fields = provider?.fields ?? [];
  // A chat hook is one URL and reads best with Add inside the field. An issue
  // tracker needs a token, a project and where to file it, and four unlabelled
  // boxes in a column are unusable — so the shape of the form follows the
  // destination rather than one compromise that suits neither.
  const single = fields.length === 1 ? fields[0] : null;
  const ready = fields.length > 0 && fields.every((f) => (values[f.name] ?? '').trim());
  const labelFor = (providerId: string) => providers.find((p) => p.id === providerId)?.label ?? providerId;
  const set = (name: string, v: string) => setValues((prev) => ({ ...prev, [name]: v }));

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
        toast(stringField(body, 'error') ?? 'Could not save destinations', 'error', 4500);
        return false;
      }
      destinations.value = parsed.data.integrations;
      capture(event, { provider });
      return true;
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    if (!provider || !ready || busy) return;
    // The token half never leaves this browser. What the room stores is where to
    // file — the repository, the project key — and nothing that authorises it.
    saveSecrets({ provider, values });
    const config = Object.fromEntries(
      fields.filter((f) => f.type !== 'secret').map((f) => [f.name, (values[f.name] ?? '').trim()]),
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
    if (ok) {
      // Cleared on success only: a rejected token should not take the four
      // fields the person got right down with it.
      setValues({});
      toast(`${provider.label} connected`, 'success');
    }
  };

  const remove = (providerId: string) =>
    void send(
      { url: `${API_BASE}${id}/integrations/${encodeURIComponent(providerId)}`, method: 'DELETE' },
      'integration_removed',
      providerId,
    );

  const submit = () => void add();

  /**
   * The one Add control. The two form shapes place it differently, not style it
   * differently. A plain call rather than a nested component: a component
   * declared in a render body is a new type every render, which is an unmount
   * and remount of the button on every keystroke.
   */
  const addButton = ({ label, ariaLabel, class: extra }: { label: string; ariaLabel?: string; class?: string }) => (
    <button
      type="button"
      onClick={submit}
      disabled={busy || !ready}
      aria-label={ariaLabel}
      class={cn(geist.actionBtn, 'mx-0 px-2 text-(--ds-gray-1000) hover:bg-(--ds-gray-alpha-200)', extra)}
    >
      {busy ? 'Saving…' : label}
    </button>
  );

  return (
    <>
      <div class={cn(geist.divider, 'my-2 -mx-4')} />
      <PanelSection icon={Send} label="Send annotations out">
        <div class="flex flex-col gap-2">
          {/* What is already wired up comes first: it is the answer to the question
              that opens this section, and on a room with a destination the picker
              below is a secondary task. */}
          {configured.length > 0 && (
            <ul class="m-0 mb-1 flex list-none flex-col gap-0.5 p-0">
              {configured.map((c) => (
                <li key={`${c.provider}-${c.hint}`} class="flex items-center justify-between gap-2">
                  <span class="min-w-0 truncate text-meta text-(--ds-gray-1000)">
                    {labelFor(c.provider)}
                    {c.hint && <span class="text-(--ds-gray-900)"> · {c.hint}</span>}
                  </span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => remove(c.provider)}
                    aria-label={`Remove ${labelFor(c.provider)}`}
                    class={cn(geist.actionBtn, geist.actionBtnDanger, 'shrink-0')}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* Four labels of very different widths wrapped raggedly, orphaning the
              last one on its own line. One track that scrolls holds the row on a
              single line at any panel width. */}
          {providers.length > 1 && (
            <ScrollTrack activeKey={active} class="-mx-1 px-1">
              <div class={geist.track} role="tablist">
                {providers.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    role="tab"
                    aria-selected={p.id === active}
                    data-pressed={p.id === active ? '' : undefined}
                    onClick={() => {
                      setPicked(p.id);
                      // Nothing typed for Slack belongs in Linear's token box.
                      setValues({});
                    }}
                    class={geist.segmentText}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </ScrollTrack>
          )}

          {/* The catalogue already describes each destination in one line; the
              client was overriding all four with the same four-line paragraph. */}
          {provider && <p class="m-0 text-meta leading-snug text-(--ds-gray-900)">{provider.blurb}</p>}

          {single && (
            <div class="flex flex-col gap-1">
              {/* Add lives inside the field, not under it. Beside a help line that
                  wraps to two, a `justify-between` button floats to whatever height
                  the wrap leaves it at — which is how it came to sit level with the
                  second line of a link it has nothing to do with. */}
              <div class={cn(geist.field, 'flex items-center gap-1 py-0 pr-1 pl-2.5')}>
                <Input field={single} value={values[single.name] ?? ''} onInput={set} onEnter={submit} />
                {/* A word, not a glyph. A bare `+` at the end of a URL field does
                    not say what it does to anyone who has not met the pattern, and
                    Enter is not an affordance you can see. */}
                {addButton({ label: 'Add', ariaLabel: `Add ${provider?.label ?? 'destination'}`, class: 'shrink-0' })}
              </div>
              <Help field={single} text={helpFor(single)} />
            </div>
          )}

          {!single && fields.length > 0 && (
            <div class="flex flex-col gap-2">
              {fields.map((f) => (
                <LabelledField
                  key={f.name}
                  id={`${active}-${f.name}`}
                  field={f}
                  label={f.label}
                  value={values[f.name] ?? ''}
                  onInput={set}
                  onEnter={submit}
                />
              ))}
              <div class="flex justify-end">{addButton({ label: `Connect ${provider?.label ?? ''}`.trim() })}</div>
            </div>
          )}

          {/* Said once, at the bottom, where it is a caveat rather than the first
              thing between the reader and the control they came for. */}
          <p class="m-0 mt-1 text-meta leading-snug text-(--ds-gray-900)">
            Chat destinations get every annotation, batched. Issue trackers file only what you send them, with a token
            kept in your browser and never in the room. Anyone with the room link can change these.
          </p>
        </div>
      </PanelSection>
    </>
  );
}
