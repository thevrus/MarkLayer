import { cn } from '@marklayer/types';
import type { ComponentChildren } from 'preact';

/* The seeded pin's purple, so every mark the page leaves on itself is one person's. */
const MARK = '#8b5cf6';

/**
 * A note left in the margin with the pen and text tools: a stroked arrow and a
 * label in the mark's colour. The page is a board, so its asides are marks on
 * it rather than typeset copy. Decorative: the heading beside it says it all.
 */
export function MarginNote({
  children,
  class: extra,
  flip,
}: {
  children: ComponentChildren;
  class?: string;
  flip?: boolean;
}) {
  return (
    <div
      aria-hidden="true"
      class={cn('pointer-events-none absolute hidden select-none lg:flex', flip ? 'flex-row-reverse' : '', extra)}
      style={{ color: MARK }}
    >
      <span class="font-ui text-ui-lg font-medium whitespace-nowrap">{children}</span>
      <svg
        role="presentation"
        width="44"
        height="52"
        viewBox="0 0 44 52"
        fill="none"
        class={cn('mt-3 shrink-0', flip ? 'mr-1 -scale-x-100' : 'ml-1')}
      >
        <path
          d="M4 2c14 6 24 20 22 44M14 36l12 11 9-13"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </div>
  );
}
