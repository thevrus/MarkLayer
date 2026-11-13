import { cn } from '@marklayer/ui/cn';
import { createPortal } from 'preact/compat';
import { useEffect } from 'preact/hooks';
import type * as Real from '../../components/BottomSheet';
import { glass } from '../../lib/glass';
import { portalContainer } from '../../lib/portal';

// Widget stand-in for the modal sheet: a static sheet in place of Base UI's Drawer,
// which was most of the bundle. No swipe-to-dismiss; the backdrop closes it.

export const ModalSheet: typeof Real.ModalSheet = ({ open, onOpenChange, label, initialFocus, children }) => {
  useEffect(() => {
    if (open) initialFocus?.current?.focus();
  }, [open, initialFocus]);

  // biome-ignore lint/complexity/noUselessFragments: 返回类型沿用 Real.ModalSheet 的 Element，空 fragment 代替 null
  if (!open) return <></>;
  const sheet = (
    <div class="fixed inset-0 z-2147483647 flex items-end pointer-events-auto">
      <div aria-hidden="true" class="absolute inset-0 bg-black opacity-20" onClick={() => onOpenChange(false)} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        class={cn(
          'relative flex w-full flex-col max-h-[calc(100dvh-2.5rem)] overflow-y-auto',
          'rounded-t-2xl bg-(--ds-background-100) border-t border-(--ds-gray-alpha-400)',
          'pb-[env(safe-area-inset-bottom,0px)]',
          glass.font,
        )}
      >
        {children}
      </div>
    </div>
  );
  return <>{portalContainer.value ? createPortal(sheet, portalContainer.value) : sheet}</>;
};

export const PeekSheet: typeof Real.PeekSheet = () => <></>;
