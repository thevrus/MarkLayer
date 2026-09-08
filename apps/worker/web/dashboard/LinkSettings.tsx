import { Toggle } from '@base-ui/react/toggle';
import { ToggleGroup } from '@base-ui/react/toggle-group';
import { geist } from '@ext/lib/geist';
import { DAY_SECONDS, type LinkAccess, MAX_EXPIRES_IN_SECONDS, type OwnedLink } from '@marklayer/types';
import type { ComponentChildren } from 'preact';
import { updateLinkSettings } from './session';

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
    </div>
  );
}
