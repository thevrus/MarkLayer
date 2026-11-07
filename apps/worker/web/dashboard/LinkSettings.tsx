import { Toggle } from '@base-ui/react/toggle';
import { ToggleGroup } from '@base-ui/react/toggle-group';
import { submitBtn } from '@ext/lib/buttons';
import { geist } from '@ext/lib/geist';
import { cn } from '@marklayer/ui/cn';
import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import {
  DAY_SECONDS,
  LINK_PASSWORD_MAX,
  LINK_PASSWORD_MIN,
  type LinkAccess,
  MAX_EXPIRES_IN_SECONDS,
  type OwnedLink,
} from '../../shared/accounts';
import { setLinkPassword, updateLinkSettings } from './session';

/** The owner-expiry presets the settings panel offers. `seconds: null` is "Never". */
const EXPIRY_OPTIONS: { key: string; label: string; seconds: number | null }[] = [
  { key: '1d', label: '1 day', seconds: DAY_SECONDS },
  { key: '7d', label: '7 days', seconds: DAY_SECONDS * 7 },
  // Tied to the schema's ceiling, not a restated 30: a lower bound would make
  // this preset the one option the server rejects.
  { key: '30d', label: '30 days', seconds: MAX_EXPIRES_IN_SECONDS },
  { key: 'never', label: 'Never', seconds: null },
];

/**
 * Which preset a link's `ownerExpiresAt` reads as. A link set to "7 days" and
 * opened 3 hours later carries a deadline 3 hours short of `now + 7d`, not an
 * exact hit — so this picks the closest preset by elapsed distance rather than
 * requiring one, or the control would fall off every option the moment time passes.
 */
function currentExpiryKey(ownerExpiresAt: number | null): string {
  if (ownerExpiresAt == null) return 'never';
  const now = Date.now() / 1000;
  let bestKey = EXPIRY_OPTIONS[0].key;
  let bestDiff = Number.POSITIVE_INFINITY;
  for (const opt of EXPIRY_OPTIONS) {
    if (opt.seconds == null) continue;
    const diff = Math.abs(now + opt.seconds - ownerExpiresAt);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestKey = opt.key;
    }
  }
  return bestKey;
}

function SettingsToggleRow({ label, children }: { label: string; children: ComponentChildren }) {
  return (
    <div class="flex flex-wrap items-center justify-between gap-2">
      <span class="text-meta text-(--ds-gray-900)">{label}</span>
      {children}
    </div>
  );
}

/**
 * Optional password. One field for set and change, so a protected link never
 * shows a masked stand-in for a password the server does not keep.
 */
function LinkPassword({ link }: { link: OwnedLink }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const save = async (password: string | null) => {
    if (busy) return;
    setBusy(true);
    const error = await setLinkPassword({ id: link.id, password });
    setBusy(false);
    if (error) {
      setNote(error);
      return;
    }
    setValue('');
    setNote(
      password === null ? 'Password removed. Open sessions were ended.' : 'Password saved. Open sessions were ended.',
    );
  };

  return (
    <div class="flex flex-col gap-1.5">
      <form
        class="flex items-center gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          if (value.length >= LINK_PASSWORD_MIN) void save(value);
        }}
      >
        <div class={cn(geist.field, 'flex flex-1 items-center px-2.5')}>
          <input
            type="password"
            autocomplete="new-password"
            aria-label={link.passwordProtected ? 'New password' : 'Password'}
            placeholder={link.passwordProtected ? 'New password' : 'Add a password'}
            minLength={LINK_PASSWORD_MIN}
            maxLength={LINK_PASSWORD_MAX}
            value={value}
            disabled={busy}
            class={cn(geist.input, 'h-full w-full')}
            onInput={(e) => {
              setValue(e.currentTarget.value);
              if (note) setNote(null);
            }}
          />
        </div>
        <button type="submit" class={cn(submitBtn, 'shrink-0')} disabled={busy || value.length < LINK_PASSWORD_MIN}>
          {link.passwordProtected ? 'Change' : 'Set'}
        </button>
        {link.passwordProtected && (
          <button
            type="button"
            class={cn(geist.ctlXs, geist.ctlLabel, geist.ctlIdle, 'h-8')}
            disabled={busy}
            onClick={() => void save(null)}
          >
            Remove
          </button>
        )}
      </form>
      {note && (
        <p class="text-meta leading-body m-0 text-(--ds-gray-900)" role="status">
          {note}
        </p>
      )}
    </div>
  );
}

/**
 * Who may edit, and when the link expires — the owner's two per-link settings.
 * Shared by the dashboard row and the viewer's share popover; the caller owns
 * the surrounding container.
 */
export function LinkSettings({ link }: { link: OwnedLink }) {
  return (
    <div class="flex flex-col gap-2.5">
      <SettingsToggleRow label="Anyone with the link">
        <ToggleGroup
          value={[link.access]}
          onValueChange={(next: LinkAccess[]) => {
            if (next[0] && next[0] !== link.access)
              void updateLinkSettings({ id: link.id, patch: { access: next[0] } });
          }}
          aria-label="Link access"
          className={geist.track}
        >
          <Toggle value="edit" className={geist.segmentText}>
            Can edit
          </Toggle>
          <Toggle value="view" className={geist.segmentText}>
            Can view
          </Toggle>
        </ToggleGroup>
      </SettingsToggleRow>
      <SettingsToggleRow label="Expires">
        <ToggleGroup
          value={[currentExpiryKey(link.ownerExpiresAt)]}
          onValueChange={(next: string[]) => {
            const opt = EXPIRY_OPTIONS.find((o) => o.key === next[0]);
            if (opt) void updateLinkSettings({ id: link.id, patch: { ownerExpiresIn: opt.seconds } });
          }}
          aria-label="Link expiry"
          className={geist.track}
        >
          {EXPIRY_OPTIONS.map((opt) => (
            <Toggle key={opt.key} value={opt.key} className={geist.segmentText}>
              {opt.label}
            </Toggle>
          ))}
        </ToggleGroup>
      </SettingsToggleRow>
      <SettingsToggleRow label="Password">
        <span class="text-meta text-(--ds-gray-1000)">{link.passwordProtected ? 'On' : 'Off'}</span>
      </SettingsToggleRow>
      <LinkPassword link={link} />
    </div>
  );
}
