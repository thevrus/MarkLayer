import { type CommentPriority, cn } from '@marklayer/types';
import { CircleAlert, type LucideIcon, SignalHigh, SignalLow, SignalMedium } from 'lucide-preact';

interface PriorityMeta {
  label: string;
  /** oklch accent used for the icon, text, and tinted badge background. */
  color: string;
  Icon: LucideIcon;
}

/** Ordered low → urgent so the click cycle and any future sorting share one source of truth. */
export const PRIORITY_LEVELS: CommentPriority[] = ['low', 'medium', 'high', 'urgent'];

/** Next step in the click cycle: unset → low → medium → high → urgent → unset. */
function nextPriority(current: CommentPriority | undefined): CommentPriority | undefined {
  if (!current) return PRIORITY_LEVELS[0];
  const idx = PRIORITY_LEVELS.indexOf(current);
  return idx === PRIORITY_LEVELS.length - 1 ? undefined : PRIORITY_LEVELS[idx + 1];
}

export const PRIORITY_META: Record<CommentPriority, PriorityMeta> = {
  low: { label: 'Low', color: 'oklch(0.72 0.19 150)', Icon: SignalLow },
  medium: { label: 'Medium', color: 'oklch(0.80 0.15 85)', Icon: SignalMedium },
  high: { label: 'High', color: 'oklch(0.70 0.18 55)', Icon: SignalHigh },
  urgent: { label: 'Urgent', color: 'oklch(0.63 0.23 25)', Icon: CircleAlert },
};

/**
 * Compact priority control for annotation composers — a single trigger that
 * reads "Set priority" until a level is chosen. Clicking cycles through the
 * levels (low → medium → high → urgent) and then back to unset, so the whole
 * control is one button with no popover. Controlled: the value lives on the
 * parent's draft op, the picker just renders + reports.
 */
export function PriorityPicker({
  value,
  onChange,
  class: cls,
}: {
  value: CommentPriority | undefined;
  onChange: (next: CommentPriority | undefined) => void;
  class?: string;
}) {
  const meta = value ? PRIORITY_META[value] : null;
  const next = nextPriority(value);
  const nextLabel = next ? PRIORITY_META[next].label : 'none';

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onChange(next);
      }}
      class={cn(
        `inline-flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-[12px] font-medium cursor-pointer
         bg-transparent border-none transition-colors hover:bg-ml-glass-fg/8`,
        cls,
      )}
      style={meta ? { color: meta.color } : undefined}
      title={`Priority: ${meta ? meta.label : 'none'} — click to set ${nextLabel}`}
    >
      {meta ? (
        <meta.Icon size={14} strokeWidth={2.25} />
      ) : (
        <SignalHigh size={14} strokeWidth={2.25} class="text-ml-glass-fg/60" />
      )}
      <span class={meta ? '' : 'text-ml-glass-fg/60'}>{meta ? meta.label : 'Set priority'}</span>
    </button>
  );
}

/**
 * Read-only priority chip for pins, hover cards, and the annotation list — the
 * level's icon + label tinted with its accent on a faint matching background.
 */
export function PriorityBadge({ priority, class: cls }: { priority: CommentPriority; class?: string }) {
  const m = PRIORITY_META[priority];
  return (
    <span
      class={cn(
        'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none whitespace-nowrap',
        cls,
      )}
      style={{ color: m.color, background: `color-mix(in oklch, ${m.color} 16%, transparent)` }}
    >
      <m.Icon size={11} strokeWidth={2.5} />
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
      class="absolute -top-1 -left-1 w-4 h-4 rounded-full text-white grid place-items-center shadow-sm border border-ml-glass-fg/80"
      style={{ background: m.color }}
    >
      <m.Icon size={9} strokeWidth={2.75} aria-hidden="true" />
    </div>
  );
}
