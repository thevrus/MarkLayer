import { cn } from '@marklayer/types';
import type { ComponentChildren } from 'preact';
import { geist } from '../lib/geist';

/**
 * Footer dismiss for a composer popover. Every one of these panels closes on
 * Escape, but a bare `Esc` chip beside a word reads as a hint while still
 * looking clickable — so the hint is the button, with the shortcut inside it.
 *
 * The negative margin pulls the label back onto the panel's own gutter, so only
 * the hover fill bleeds past it — the same trick `PriorityPicker` uses.
 */
export function CancelButton({ onClick, children = 'Cancel' }: { onClick: () => void; children?: ComponentChildren }) {
  return (
    <button
      type="button"
      onClick={onClick}
      class={cn(geist.ctlSm, geist.ctlIdle, 'w-auto gap-1.5 px-2 -ml-2 text-ui font-medium')}
    >
      {children}
      <kbd class={geist.kbd}>Esc</kbd>
    </button>
  );
}
