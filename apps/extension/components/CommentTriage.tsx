import { Menu } from '@base-ui/react/menu';
import { type CommentStatus, commentStatusSchema } from '@marklayer/types/ops';
import { cn } from '@marklayer/ui/cn';
import { Check, ChevronDown, CircleUserRound } from 'lucide-preact';
import type { ComponentChildren } from 'preact';
import { useCardHold } from '../lib/card-hold';
import { geist } from '../lib/geist';
import { glass } from '../lib/glass';
import { localUser } from '../lib/identity';
import { setOpAssignee, setOpStatus } from '../lib/ops';
import { portalContainer } from '../lib/portal';
import { peers } from '../lib/presence';
import { stableComputed } from '../lib/stable';
import { STATUS_COLORS, STATUS_LABELS } from '../lib/status-ui';

const STATUS_ORDER = commentStatusSchema.options;

/** Sentinel RadioGroup value standing in for "no assignee" (`null` on the op). */
const UNASSIGNED = '\u0000unassigned';
const OFFLINE_COLOR = 'oklch(0.55 0.02 260)';

/* The menu only cares about who is present, so it holds its reference while the
   name→color pairs are unchanged — otherwise every remote cursor frame swaps
   `peers` and re-renders every comment pin. */
const peerRoster = stableComputed({
  compute: () => {
    const next = new Map<string, string>();
    for (const p of peers.value.values()) if (p.name) next.set(p.name, p.color);
    return next;
  },
  equals: (previous, next) => {
    if (previous.size !== next.size) return false;
    for (const [name, color] of next) if (previous.get(name) !== color) return false;
    return true;
  },
});

/* The value is the control: no box at rest, a tonal fill on hover. The negative
   margin keeps the chevron on the card's gutter while the fill grows outward. */
const triggerCls = cn(
  'min-w-0 max-w-[60%] inline-flex items-center gap-1.5 h-7 px-2 -mr-2 rounded-md cursor-pointer select-none',
  'appearance-none border-none bg-transparent outline-none',
  'text-meta font-medium text-(--ds-gray-1000)',
  'hover:bg-(--ds-gray-alpha-100) data-popup-open:bg-(--ds-gray-alpha-100)',
  'focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-(--ds-focus-color)',
  'transition-[background-color] duration-150 ease-out',
);

const itemCls = cn(
  'flex items-center gap-2 px-2.5 py-1.5',
  'text-meta font-medium leading-none',
  glass.menuItem,
  glass.menuItemHighlight,
  'data-checked:text-(--ds-gray-1000)',
);

function TriageMenu({ trigger, children }: { trigger: ComponentChildren; children: ComponentChildren }) {
  const hold = useCardHold();
  return (
    <Menu.Root onOpenChange={hold}>
      <Menu.Trigger className={triggerCls} onClick={(e: MouseEvent) => e.stopPropagation()}>
        {trigger}
        <ChevronDown size={12} class="text-(--ds-gray-900) shrink-0" aria-hidden="true" />
      </Menu.Trigger>
      <Menu.Portal container={portalContainer.value ?? undefined}>
        <Menu.Positioner
          side="bottom"
          align="end"
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

export function CheckMark() {
  return (
    <Menu.RadioItemIndicator className="shrink-0 inline-flex text-(--ds-gray-900) ml-auto">
      <Check size={12} strokeWidth={2.5} aria-hidden="true" />
    </Menu.RadioItemIndicator>
  );
}

/** Status dropdown for a comment card — colored dot + label, one radio item per status. */
function StatusPicker({ opId, status }: { opId: string; status: CommentStatus }) {
  return (
    <TriageMenu
      trigger={
        <>
          <span class="w-2 h-2 rounded-full shrink-0" style={{ background: STATUS_COLORS[status] }} />
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
            <span class="w-2 h-2 rounded-full shrink-0" style={{ background: STATUS_COLORS[s] }} />
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
function AssigneePicker({ opId, assignee }: { opId: string; assignee: string | null }) {
  const options = new Map<string, string>([[localUser.name, localUser.color]]);
  for (const [name, c] of peerRoster.value) if (!options.has(name)) options.set(name, c);
  if (assignee && !options.has(assignee)) options.set(assignee, OFFLINE_COLOR);

  return (
    <TriageMenu
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

const rowCls = 'flex items-center justify-between gap-3 h-8';
const triageLabelCls = 'text-meta text-(--ds-gray-900) font-medium shrink-0';

/** Status and Assignee as property rows, label left and value right, shared by every comment card. */
export function TriageSection({
  opId,
  status,
  assignee,
  class: cls,
}: {
  opId: string;
  status: CommentStatus;
  assignee: string | null;
  /** The pins keep the grid tight inside a hover card; the panel gives it room. */
  class?: string;
}) {
  return (
    <div class={cn('px-3.5 py-1.5', cls)}>
      <div class={rowCls}>
        <span class={triageLabelCls}>Status</span>
        <StatusPicker opId={opId} status={status} />
      </div>
      <div class={rowCls}>
        <span class={triageLabelCls}>Assignee</span>
        <AssigneePicker opId={opId} assignee={assignee} />
      </div>
    </div>
  );
}
