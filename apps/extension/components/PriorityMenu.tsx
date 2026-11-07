import { Menu } from '@base-ui/react/menu';
import type { CommentPriority } from '@marklayer/types/ops';
import { cn } from '@marklayer/ui/cn';
import { Check, Minus } from 'lucide-preact';
import type { ComponentChildren } from 'preact';
import { geist } from '../lib/geist';
import { glass } from '../lib/glass';
import { portalContainer } from '../lib/portal';
import { PRIORITY_LEVELS, PRIORITY_META } from '../lib/priority';

/** RadioGroup value standing in for "no priority" (`undefined` on the op). */
const NONE = 'none';

const itemCls = cn(
  'flex items-center gap-2 px-2.5 py-1.5',
  'text-meta font-medium leading-none',
  glass.menuItem,
  glass.menuItemHighlight,
  'data-checked:text-(--ds-gray-1000)',
);

/** The level menu behind `PriorityPicker`; its own module so the widget can swap Base UI out. */
export function PriorityMenu({
  value,
  onChange,
  class: cls,
  children,
}: {
  value: CommentPriority | undefined;
  onChange: (next: CommentPriority | undefined) => void;
  class: string;
  children: ComponentChildren;
}) {
  return (
    <Menu.Root>
      <Menu.Trigger
        onClick={(e: MouseEvent) => e.stopPropagation()}
        aria-label={`Priority: ${value ? PRIORITY_META[value].label : 'none'}`}
        className={cls}
      >
        {children}
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
            <Menu.RadioGroup
              value={value ?? NONE}
              onValueChange={(next: string) => onChange(PRIORITY_LEVELS.find((level) => level === next))}
            >
              <Menu.RadioItem value={NONE} closeOnClick className={itemCls}>
                <Minus size={14} strokeWidth={1.75} class="text-(--ds-gray-900)" aria-hidden="true" />
                No priority
                <Indicator />
              </Menu.RadioItem>
              {/* Most urgent first: it sits nearest the trigger, and it is the level worth a click. */}
              {[...PRIORITY_LEVELS].reverse().map((level) => {
                const m = PRIORITY_META[level];
                return (
                  <Menu.RadioItem key={level} value={level} closeOnClick className={itemCls}>
                    <m.Icon size={14} strokeWidth={1.75} style={{ color: m.color }} aria-hidden="true" />
                    {m.label}
                    <Indicator />
                  </Menu.RadioItem>
                );
              })}
            </Menu.RadioGroup>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

function Indicator() {
  return (
    <Menu.RadioItemIndicator className="shrink-0 inline-flex text-(--ds-gray-900) ml-auto pl-3">
      <Check size={12} strokeWidth={2.5} aria-hidden="true" />
    </Menu.RadioItemIndicator>
  );
}
