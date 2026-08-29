import { Collapsible } from '@base-ui/react/collapsible';
import { cn } from '@marklayer/types';
import { ChevronRight, type LucideIcon } from 'lucide-preact';
import type { ComponentChildren } from 'preact';
import { geist } from '../lib/geist';

/**
 * A panel section that collapses. Base UI carries the disclosure semantics and
 * publishes the measured height as `--collapsible-panel-height`, which is what
 * the height transition animates against.
 *
 * Two densities, one recipe: with an `icon` the trigger is a full-bleed panel
 * row (it assumes a `px-4` body and bleeds back out to the panel edge); without
 * one it is a compact inline disclosure for nesting inside a section.
 */
export function PanelSection({
  icon: Icon,
  label,
  count,
  defaultOpen = false,
  children,
}: {
  icon?: LucideIcon;
  label: string;
  count?: number;
  defaultOpen?: boolean;
  children: ComponentChildren;
}) {
  return (
    <Collapsible.Root defaultOpen={defaultOpen}>
      <Collapsible.Trigger
        className={cn(
          'group flex items-center w-full cursor-pointer appearance-none border-none bg-transparent text-left',
          'transition-[background-color,color] duration-150 ease-out',
          'focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-(--ds-focus-color)',
          geist.sectionLabel,
          Icon
            ? // Full-bleed 36px row: out to the panel edge, back in to the body's own 16px gutter.
              'gap-3 h-9 -mx-4 px-4 w-[calc(100%+32px)] focus-visible:-outline-offset-2 hover:bg-(--ds-gray-alpha-100)'
            : // Nested: no fill, so the trigger stays on the same left edge as the
              // fields beside it and answers the hover with its colour alone.
              'gap-1.5 h-7 rounded-sm focus-visible:outline-offset-2',
          'text-(--ds-gray-900) hover:text-(--ds-gray-1000) data-panel-open:text-(--ds-gray-1000)',
        )}
      >
        {Icon && <Icon size={14} strokeWidth={1.5} class="shrink-0" aria-hidden="true" />}
        <span class="flex-1 truncate">
          {label}
          {count != null && <span class="tabular-nums"> ({count})</span>}
        </span>
        <ChevronRight
          size={14}
          strokeWidth={1.5}
          class="shrink-0 transition-transform duration-200 ease-out group-data-panel-open:rotate-90"
          aria-hidden="true"
        />
      </Collapsible.Trigger>
      {/* The clip box runs 4px past the content on each side so a focus ring
          inside the panel is never shaved by the height animation's overflow. */}
      <Collapsible.Panel
        className={cn(
          'overflow-hidden -mx-1 h-(--collapsible-panel-height)',
          'transition-[height] duration-200 ease-out data-starting-style:h-0 data-ending-style:h-0',
        )}
      >
        {/* 26px aligns the body under the label, past the 14px icon and its 12px gap. */}
        <div class={cn('pt-1.5 pb-1', Icon ? 'pl-[30px] pr-1' : 'px-1')}>{children}</div>
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}
