import { PanelSection } from '@ext/components/PanelSection';
import { geist } from '@ext/lib/geist';
import { toast } from '@ext/lib/state';
import { cn } from '@marklayer/types';
import { Send } from 'lucide-preact';
import { useEffect, useState } from 'preact/hooks';
import { capture } from './analytics';
import { API_BASE } from './signals';

/**
 * The provider catalogue, fetched as data rather than compiled in.
 *
 * This is what keeps the client flat: adding Teams or Discord server-side adds a
 * row to this list and zero bytes to the bundle everyone downloads. See
 * docs/adr/0003-outbound-integrations.md.
 */
interface Field {
  name: string;
  label: string;
  type: string;
  placeholder?: string;
  help?: string;
  helpUrl?: string;
}
interface Provider {
  id: string;
  label: string;
  blurb: string;
  fields: Field[];
}
/** A configured destination as the server describes it — never its credentials. */
interface Summary {
  provider: string;
  hint: string | null;
}

const isProviders = (v: unknown): v is { providers: Provider[] } =>
  typeof v === 'object' && v !== null && Array.isArray((v as { providers?: unknown }).providers);
const isSummaries = (v: unknown): v is { integrations: Summary[] } =>
  typeof v === 'object' && v !== null && Array.isArray((v as { integrations?: unknown }).integrations);

/**
 * Send this room's new annotations somewhere: a Slack or Teams channel, Discord,
 * or any URL that wants JSON.
 *
 * The room id is the only credential involved, which is the bargain the rest of
 * the product makes too: whoever holds the share link is a participant. The copy
 * says so rather than implying a privacy the link cannot provide.
 */
export function IntegrationsSection({ id }: { id: string }) {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [configured, setConfigured] = useState<Summary[]>([]);
  const [picked, setPicked] = useState('');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch(`${API_BASE}providers`).then((r) => (r.ok ? r.json() : null)),
      fetch(`${API_BASE}${id}/integrations`).then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([catalogue, mine]) => {
        if (cancelled) return;
        if (isProviders(catalogue)) {
          setProviders(catalogue.providers);
          setPicked((p) => p || (catalogue.providers[0]?.id ?? ''));
        }
        if (isSummaries(mine)) setConfigured(mine.integrations);
      })
      .catch(() => {
        /* offline — the section stays quiet rather than claiming a state */
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const provider = providers.find((p) => p.id === picked);
  const field = provider?.fields[0];
  const labelFor = (providerId: string) => providers.find((p) => p.id === providerId)?.label ?? providerId;

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
      if (!res.ok || !isSummaries(body)) {
        // The API names which destination it refused and why, and the reason is
        // almost always "that is not the kind of URL this one takes".
        const error = (body as { error?: unknown } | null)?.error;
        toast(typeof error === 'string' ? error : 'Could not save destinations', 'error', 4500);
        return false;
      }
      setConfigured(body.integrations);
      capture(event, { provider });
      return true;
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    const url = value.trim();
    if (!url || !provider || !field || busy) return;
    const ok = await send(
      {
        url: `${API_BASE}${id}/integrations`,
        method: 'POST',
        body: JSON.stringify({ provider: provider.id, config: { [field.name]: url } }),
      },
      'integration_added',
      provider.id,
    );
    if (ok) {
      setValue('');
      toast(`${provider.label} connected`, 'success');
    }
  };

  const remove = (providerId: string) =>
    void send(
      { url: `${API_BASE}${id}/integrations/${encodeURIComponent(providerId)}`, method: 'DELETE' },
      'integration_removed',
      providerId,
    );

  return (
    <>
      <div class={cn(geist.divider, 'my-2 -mx-4')} />
      <PanelSection icon={Send} label="Send annotations out">
        <div class="flex flex-col gap-2">
          <p class="m-0 text-meta leading-snug text-(--ds-gray-900)">
            New comments here post to the channels you add, batched so a burst arrives as one message. Anyone with this
            room's link can change them, the same as everything else in the room.
          </p>

          {configured.length > 0 && (
            <ul class="m-0 flex list-none flex-col gap-1 p-0">
              {configured.map((c) => (
                <li key={`${c.provider}-${c.hint}`} class="flex items-center justify-between gap-3">
                  <span class="truncate text-meta text-(--ds-gray-1000)">
                    {labelFor(c.provider)}
                    {c.hint ? ` · ${c.hint}` : ''}
                  </span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => remove(c.provider)}
                    class={cn(geist.bareBtn, geist.bareBtnDanger, 'shrink-0 font-medium')}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}

          {providers.length > 1 && (
            <div class="flex flex-wrap gap-1">
              {providers.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPicked(p.id)}
                  aria-pressed={p.id === picked}
                  class={cn(
                    'h-7 rounded-md border px-2 text-meta font-medium transition-colors duration-100',
                    p.id === picked
                      ? 'border-(--ds-gray-600) bg-(--ds-gray-alpha-100) text-(--ds-gray-1000)'
                      : 'border-(--ds-gray-alpha-400) bg-transparent text-(--ds-gray-900) hover:text-(--ds-gray-1000)',
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
          )}

          {field && (
            <>
              <div class={cn(geist.field, 'flex items-center px-2.5')}>
                <input
                  name={field.name}
                  type={field.type === 'url' ? 'url' : 'text'}
                  value={value}
                  placeholder={field.placeholder}
                  aria-label={field.label}
                  spellcheck={false}
                  autocomplete="off"
                  class={cn(geist.input, 'flex-1')}
                  onInput={(e) => setValue(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void add();
                  }}
                />
              </div>
              <div class="flex items-center justify-between gap-3">
                {field.helpUrl ? (
                  <a
                    href={field.helpUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    class="text-meta text-(--ds-gray-900) underline underline-offset-2 hover:text-(--ds-gray-1000)"
                  >
                    {field.help ?? 'How to get one'}
                  </a>
                ) : (
                  <span class="truncate text-meta text-(--ds-gray-900)">{field.help}</span>
                )}
                <button
                  type="button"
                  onClick={() => void add()}
                  disabled={busy || !value.trim()}
                  class={cn(
                    geist.bareBtn,
                    geist.bareBtnQuiet,
                    'shrink-0 font-medium',
                    (busy || !value.trim()) && 'pointer-events-none opacity-50',
                  )}
                >
                  {busy ? 'Saving…' : 'Add'}
                </button>
              </div>
            </>
          )}
        </div>
      </PanelSection>
    </>
  );
}
