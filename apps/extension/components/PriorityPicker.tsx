import type { CommentPriority } from '@marklayer/types/ops';
import { cn } from '@marklayer/ui/cn';
import { ChevronDown, SignalHigh } from 'lucide-preact';
import { geist } from '../lib/geist';
import { PRIORITY_META } from '../lib/priority';
import { PriorityMenu } from './PriorityMenu';

/**
 * Priority control for annotation composers. Controlled: the value lives on the
 * parent's draft op, the picker just renders + reports. The accent rides the
 * icon and the word stays in ink, as in `PriorityBadge`.
 *
 * `bare` is the toolbar form, a 24px control sized like the buttons beside it.
 */
export function PriorityPicker({
  value,
  onChange,
  bare,
  class: cls,
}: {
  value: CommentPriority | undefined;
  onChange: (next: CommentPriority | undefined) => void;
  bare?: boolean;
  class?: string;
}) {
  const meta = value ? PRIORITY_META[value] : null;
  const Icon = meta ? meta.Icon : SignalHigh;
  return (
    <PriorityMenu
      value={value}
      onChange={onChange}
      class={cn(
        bare
          ? cn(geist.ctlXs, geist.ctlIdle, geist.ctlLabel)
          : `inline-flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-meta font-medium cursor-pointer
             bg-transparent border-none text-(--ds-gray-900) transition-colors hover:bg-(--ds-gray-alpha-100)`,
        'data-popup-open:bg-(--ds-gray-alpha-100)',
        cls,
      )}
    >
      <Icon size={14} strokeWidth={1.75} style={meta ? { color: meta.color } : undefined} aria-hidden="true" />
      {meta ? <span class="text-(--ds-gray-1000)">{meta.label}</span> : bare ? 'Priority' : 'Set priority'}
      <ChevronDown size={12} class="-ml-0.5 text-(--ds-gray-900)" aria-hidden="true" />
    </PriorityMenu>
  );
}

/**
 * Read-only priority for pins, hover cards, and the annotation list. The signal
 * icon carries the level's accent; the word is set in the same muted ink as the
 * status and timestamp it sits beside. The tinted capsule this replaces made
 * priority the loudest object in a comment row, and set the label in the accent
 * itself — 2.5:1 for `medium` on a light panel, which the 16% wash behind it did
 * nothing to fix. Colour is now reinforcement, never the only carrier.
 */
export function PriorityBadge({ priority, class: cls }: { priority: CommentPriority; class?: string }) {
  const m = PRIORITY_META[priority];
  return (
    <span
      class={cn(
        'inline-flex items-center gap-1 text-meta font-medium leading-none whitespace-nowrap text-(--ds-gray-900)',
        cls,
      )}
    >
      <m.Icon size={11} strokeWidth={2.5} style={{ color: m.color }} aria-hidden="true" />
      {m.label}
    </span>
  );
}

/**
 * Priority indicator pinned to a comment pin's corner — a small filled disc with
 * the level's signal icon, mirroring the status badge that sits opposite it.
 */
export function PriorityPin({ priority }: { priority: CommentPriority }) {
  const m = PRIORITY_META[priority];
  return (
    <div
      role="img"
      aria-label={`${m.label} priority`}
      class="absolute -top-1 -left-1 w-4 h-4 rounded-full text-white grid place-items-center [box-shadow:0_0_0_1.5px_var(--ds-background-100)]"
      style={{ background: m.color }}
    >
      <m.Icon size={9} strokeWidth={2.75} aria-hidden="true" />
    </div>
  );
}
