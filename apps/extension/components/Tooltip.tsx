import { cn } from '@marklayer/types';
import { glass } from '../lib/glass';

type Placement = 'top' | 'bottom';

export function Tooltip({
  text,
  shortcut,
  placement = 'top',
}: {
  text: string;
  shortcut?: string;
  placement?: Placement;
}) {
  const pos = placement === 'top' ? 'bottom-full mb-2.5' : 'top-full mt-2.5';
  return (
    <div
      class={cn(
        'absolute left-1/2 -translate-x-1/2 pointer-events-none',
        'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100',
        'scale-90 group-hover:scale-100 group-focus-within:scale-100',
        'transition-all duration-150 ease-out z-10',
        pos,
      )}
    >
      <div class={cn(glass.surfaceSmall, '!rounded-[10px] px-2.5 py-1.5 flex items-center gap-2 whitespace-nowrap')}>
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
