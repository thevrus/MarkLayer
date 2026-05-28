import { autoUpdate, computePosition, flip, offset, shift } from '@floating-ui/dom';
import { cn } from '@marklayer/types';
import { useLayoutEffect, useRef } from 'preact/hooks';
import { glass } from '../lib/glass';

type Placement = 'top' | 'bottom';

/**
 * Tooltip — render as a child of a `class="group …"` trigger; visibility is driven
 * by `group-hover` / `group-focus-within`.
 */
export function Tooltip({
  text,
  shortcut,
  placement = 'top',
  wrap = false,
}: {
  text: string;
  shortcut?: string;
  placement?: Placement;
  /** Allow long descriptive text to wrap onto multiple lines (default: single-line). */
  wrap?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // `position: fixed` so the tooltip escapes any overflow-hidden ancestor; Floating UI
  // flips/shifts to keep it inside the viewport.
  useLayoutEffect(() => {
    const floating = ref.current;
    const reference = floating?.parentElement;
    if (!floating || !reference) return;
    return autoUpdate(reference, floating, () => {
      computePosition(reference, floating, {
        placement,
        strategy: 'fixed',
        middleware: [offset(8), flip(), shift({ padding: 8 })],
      }).then(({ x, y }) => {
        floating.style.left = `${x}px`;
        floating.style.top = `${y}px`;
      });
    });
  }, [placement]);

  return (
    <div
      ref={ref}
      class={cn(
        'fixed top-0 left-0 pointer-events-none',
        'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100',
        'scale-90 group-hover:scale-100 group-focus-within:scale-100',
        'transition-[opacity,transform] duration-150 ease-out z-2147483647',
      )}
    >
      <div
        class={cn(
          glass.surfaceSmall,
          'rounded-[10px] px-2.5 py-1.5 flex items-center gap-2',
          wrap ? 'w-44 leading-snug' : 'whitespace-nowrap',
        )}
      >
        <span class="text-[11px] text-ml-glass-fg/70 font-medium tracking-[0.01em]">{text}</span>
        {shortcut && (
          <kbd
            class={cn(
              'text-[10px] text-ml-glass-fg/35 bg-ml-glass-accent/[0.06] border border-ml-glass-fg/[0.08]',
              'rounded-[5px] px-1.5 py-0.5 font-mono leading-none',
            )}
          >
            {shortcut}
          </kbd>
        )}
      </div>
    </div>
  );
}
