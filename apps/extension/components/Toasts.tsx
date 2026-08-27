import { cn } from '@marklayer/types';
import { geist } from '../lib/geist';
import { glass } from '../lib/glass';
import { Icon } from '../lib/icons';
import { toasts } from '../lib/state';

/** Where the stack sits — the viewer clears its own top bar, the rest hug the top edge. */
type Offset = 'top' | 'below-bar';

const ICONS = { success: 'check', error: 'alert', info: 'info' } as const;
const ICON_INK = {
  success: 'text-(--ds-green-700)',
  error: 'text-(--ds-red-700)',
  info: 'text-(--ds-gray-900)',
} as const;

/**
 * Notifications. One card per message: the status lives in a glyph, not in the
 * colour of the words — coloured body text was both harder to read and the
 * loudest thing on screen for a line as small as "URL copied".
 */
export function Toasts({ offset = 'top' }: { offset?: Offset }) {
  if (!toasts.value.length) return null;
  return (
    <div
      class={cn(
        'fixed left-1/2 -translate-x-1/2 z-2147483647 flex flex-col gap-2 items-center',
        offset === 'below-bar' ? 'top-16' : 'top-5',
      )}
    >
      {toasts.value.map((t) => {
        const kind = t.type ?? 'info';
        return (
          <div
            key={t.id}
            class={cn(
              geist.surfaceSmall,
              glass.font,
              'flex items-center gap-2 h-9 px-3 rounded-lg',
              'text-[13px] font-medium text-(--ds-gray-1000) whitespace-nowrap',
              'animate-[fadeInDown_0.2s_ease-out]',
            )}
          >
            <span class={cn('inline-flex shrink-0', ICON_INK[kind])}>
              <Icon name={ICONS[kind]} size={14} strokeWidth={1.5} />
            </span>
            {t.message}
          </div>
        );
      })}
    </div>
  );
}
