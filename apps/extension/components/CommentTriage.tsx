import { Menu } from '@base-ui/react/menu';
import { type CommentStatus, cn, commentStatusSchema } from '@marklayer/types';
import { computed } from '@preact/signals';
import { Check, ChevronDown, CircleUserRound } from 'lucide-preact';
import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { geist } from '../lib/geist';
import { glass } from '../lib/glass';
import { portalContainer } from '../lib/portal';
import { localUser, peers, STATUS_LABELS, STATUS_STYLES, setOpAssignee, setOpStatus } from '../lib/state';

const STATUS_ORDER = commentStatusSchema.options;

/** STATUS_STYLES leaves `open` transparent (pins show no badge); menus need a visible dot. */
const statusDot = (s: CommentStatus) => (s === 'open' ? 'var(--ds-blue-800)' : STATUS_STYLES[s].color);

/** Sentinel RadioGroup value standing in for "no assignee" (`null` on the op). */
const UNASSIGNED = '\u0000unassigned';
const OFFLINE_COLOR = 'oklch(0.55 0.02 260)';

/* `peers` swaps its Map on every remote cursor move, but the menu only cares
   about who is present. Returning the same reference while name→color pairs
   are unchanged keeps every comment pin from re-rendering per cursor frame. */
let rosterCache = new Map<string, string>();

const matchesCache = (next: Map<string, string>) => {
  if (next.size !== rosterCache.size) return false;
  for (const [name, c] of next) if (rosterCache.get(name) !== c) return false;
  return true;
};

const peerRoster = computed(() => {
  const next = new Map<string, string>();
  for (const p of peers.value.values()) if (p.name) next.set(p.name, p.color);
  if (!matchesCache(next)) rosterCache = next;
  return rosterCache;
});

const triggerCls = cn(
  'w-full flex items-center gap-1.5 px-2 py-1.5 rounded-lg cursor-pointer select-none',
  'border border-(--ds-gray-alpha-400) bg-(--ds-gray-alpha-100)',
  'text-meta font-medium text-(--ds-gray-1000)',
  'hover:bg-(--ds-gray-alpha-100) hover:text-(--ds-gray-1000)',
  'data-popup-open:bg-(--ds-gray-alpha-100) data-popup-open:text-(--ds-gray-1000)',
  'transition-[background-color,color] duration-150',
);

const itemCls = cn(
  'flex items-center gap-2 px-2.5 py-1.5',
  'text-meta font-medium leading-none',
  glass.menuItem,
  glass.menuItemHighlight,
  'data-checked:text-(--ds-gray-1000)',
);

function TriageMenu({
  trigger,
  children,
  onOpenChange,
}: {
  trigger: ComponentChildren;
  children: ComponentChildren;
  /** Only a pin needs this — it holds its hover card open while the menu is out.
   *  The annotation panel has nothing to latch, so it passes nothing. */
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <Menu.Root onOpenChange={onOpenChange}>
      <Menu.Trigger className={triggerCls} onClick={(e: MouseEvent) => e.stopPropagation()}>
        {trigger}
        <ChevronDown size={12} class="text-(--ds-gray-900) shrink-0 ml-auto" aria-hidden="true" />
      </Menu.Trigger>
      <Menu.Portal container={portalContainer.value ?? undefined}>
        <Menu.Positioner
          side="bottom"
          align="start"
          sideOffset={4}
          collisionPadding={6}
          className="z-2147483647 outline-none"
        >
          <Menu.Popup className={cn('min-w-40', glass.menuPopup, geist.surfaceSmall, glass.font)}>
            {children}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

function CheckMark() {
  return (
    <Menu.RadioItemIndicator className="shrink-0 inline-flex text-(--ds-gray-900) ml-auto">
      <Check size={12} strokeWidth={2.5} aria-hidden="true" />
    </Menu.RadioItemIndicator>
  );
}

/** Status dropdown for a comment card — colored dot + label, one radio item per status. */
function StatusPicker({
  opId,
  status,
  onOpenChange,
}: {
  opId: string;
  status: CommentStatus;
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <TriageMenu
      onOpenChange={onOpenChange}
      trigger={
        <>
          <span class="w-2 h-2 rounded-full shrink-0" style={{ background: statusDot(status) }} />
          <span class="truncate">{STATUS_LABELS[status]}</span>
        </>
      }
    >
      <Menu.RadioGroup
        value={status}
        onValueChange={(value: string) => {
          const parsed = commentStatusSchema.safeParse(value);
          if (parsed.success) setOpStatus(opId, parsed.data);
        }}
      >
        {STATUS_ORDER.map((s) => (
          <Menu.RadioItem key={s} value={s} closeOnClick className={itemCls}>
            <span class="w-2 h-2 rounded-full shrink-0" style={{ background: statusDot(s) }} />
            {STATUS_LABELS[s]}
            <CheckMark />
          </Menu.RadioItem>
        ))}
      </Menu.RadioGroup>
    </TriageMenu>
  );
}

function InitialAvatar({ name, color }: { name: string; color: string }) {
  return (
    <span
      class="w-4 h-4 rounded-full text-white text-micro font-medium grid place-items-center shrink-0
             shadow-[inset_0_1px_0_oklch(1_0_0/0.15)]"
      style={{ background: color }}
    >
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

/** Assignee dropdown — you, everyone in the room, plus the current assignee if they left. */
function AssigneePicker({
  opId,
  assignee,
  onOpenChange,
}: {
  opId: string;
  assignee: string | null;
  onOpenChange?: (open: boolean) => void;
}) {
  const options = new Map<string, string>([[localUser.name, localUser.color]]);
  for (const [name, c] of peerRoster.value) if (!options.has(name)) options.set(name, c);
  if (assignee && !options.has(assignee)) options.set(assignee, OFFLINE_COLOR);

  return (
    <TriageMenu
      onOpenChange={onOpenChange}
      trigger={
        assignee ? (
          <>
            <InitialAvatar name={assignee} color={options.get(assignee) ?? OFFLINE_COLOR} />
            <span class="truncate">{assignee === localUser.name ? 'You' : assignee}</span>
          </>
        ) : (
          <>
            <CircleUserRound size={13} class="text-(--ds-gray-900) shrink-0" aria-hidden="true" />
            <span class="truncate text-(--ds-gray-900)">Assign</span>
          </>
        )
      }
    >
      <Menu.RadioGroup
        value={assignee ?? UNASSIGNED}
        onValueChange={(value: string) => setOpAssignee({ opId, assignee: value === UNASSIGNED ? null : value })}
      >
        <Menu.RadioItem value={UNASSIGNED} closeOnClick className={itemCls}>
          <CircleUserRound size={13} class="text-(--ds-gray-900) shrink-0" aria-hidden="true" />
          Unassigned
          <CheckMark />
        </Menu.RadioItem>
        {[...options.entries()].map(([name, optionColor]) => (
          <Menu.RadioItem key={name} value={name} closeOnClick className={itemCls}>
            <InitialAvatar name={name} color={optionColor} />
            {name === localUser.name ? `${name} (you)` : name}
            <CheckMark />
          </Menu.RadioItem>
        ))}
      </Menu.RadioGroup>
    </TriageMenu>
  );
}

const triageLabelCls = 'text-meta text-(--ds-gray-900) font-medium';

/**
 * A triage dropdown portals outside the pin, so the pointer leaving for the menu
 * would drop `:hover` and dismiss the card. Both comment pins hold the card open
 * while a menu is — the latch and its three class fragments live here, next to
 * the section that causes the problem, rather than being pasted into each pin.
 */
export function useTriageHold() {
  const [open, setOpen] = useState(false);
  return {
    onOpenChange: setOpen,
    /** Keep the pin above its neighbours while a menu is out. */
    rootCls: open && 'z-50',
    /** The card is pointer-transparent until hovered; a live menu counts as hovered. */
    wrapCls: open && 'pointer-events-auto',
    /** Hold the card at its hovered transform instead of letting it animate away. */
    cardCls: open && 'opacity-100 scale-100 translate-x-0',
  };
}

/** The Status + Assignee grid shared by both comment cards. */
export function TriageSection({
  opId,
  status,
  assignee,
  onOpenChange,
  class: cls,
}: {
  opId: string;
  status: CommentStatus;
  assignee: string | null;
  onOpenChange?: (open: boolean) => void;
  /** The pins keep the grid tight inside a hover card; the panel gives it room. */
  class?: string;
}) {
  return (
    <div class={cn('px-3.5 py-2.5 grid grid-cols-2 gap-2', cls)}>
      <div class="flex flex-col gap-1">
        <span class={triageLabelCls}>Status</span>
        <StatusPicker opId={opId} status={status} onOpenChange={onOpenChange} />
      </div>
      <div class="flex flex-col gap-1">
        <span class={triageLabelCls}>Assignee</span>
        <AssigneePicker opId={opId} assignee={assignee} onOpenChange={onOpenChange} />
      </div>
    </div>
  );
}
