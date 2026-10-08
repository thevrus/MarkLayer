import { Drawer } from '@base-ui/react/drawer';
import { cn } from '@marklayer/types';
import type { ComponentChildren, RefObject } from 'preact';
import { useState } from 'preact/hooks';
import { glass } from '../lib/glass';
import { portalContainer } from '../lib/portal';

const EASE = 'duration-[450ms] ease-[cubic-bezier(0.32,0.72,0,1)]';

interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The sheet's accessible name; there is no visible title to point at. */
  label: string;
  children: ComponentChildren;
}

/** Viewport, popup, grab handle and scroll body: everything both sheets share. */
function SheetFrame({
  label,
  height,
  initialFocus,
  children,
}: {
  label: string;
  height: string;
  initialFocus?: RefObject<HTMLElement | null>;
  children: ComponentChildren;
}) {
  return (
    <Drawer.Viewport className="fixed inset-0 z-2147483647 flex items-end pointer-events-none">
      <Drawer.Popup
        aria-label={label}
        initialFocus={initialFocus}
        className={cn(
          'relative flex w-full flex-col min-h-0 outline-none touch-none pointer-events-auto',
          'rounded-t-2xl bg-(--ds-background-100) border-t border-(--ds-gray-alpha-400)',
          // Portalled out of the viewer root, so the face it sets has to come along.
          glass.font,
          // Full height stops short of the top edge, so a strip of the page shows the sheet is over it.
          '[--sheet-full:calc(100dvh-2.5rem-env(safe-area-inset-top,0px))]',
          height,
          // The rest offset, not the live drag: padding is layout, and tracking the finger
          // with it re-flowed the whole thread list every frame.
          'pb-(--drawer-snap-point-offset,0px)',
          'transform-[translateY(calc(var(--drawer-snap-point-offset,0px)+var(--drawer-swipe-movement-y,0px)))]',
          // Its own layer before the first frame, so the open doesn't stall on a raster.
          'will-change-transform transition-transform data-swiping:select-none',
          // A flick closes as fast as it was thrown.
          'data-ending-style:duration-[calc(var(--drawer-swipe-strength,1)*400ms)]',
          'data-starting-style:transform-[translateY(100%)] data-ending-style:transform-[translateY(100%)]',
          'data-starting-style:pb-0 data-ending-style:pb-0',
          'motion-reduce:transition-none',
          EASE,
        )}
      >
        <div class="shrink-0 grid place-items-center h-5" aria-hidden="true">
          <div class="h-1 w-9 rounded-full bg-(--ds-gray-alpha-400)" />
        </div>
        <Drawer.Content className="flex min-h-0 flex-1 flex-col touch-auto pb-[env(safe-area-inset-bottom,0px)]">
          {children}
        </Drawer.Content>
      </Drawer.Popup>
    </Drawer.Viewport>
  );
}

/**
 * A task that holds the screen until it is done or dismissed: writing a comment.
 * As tall as its content, over a dimmed page, with a focused field kept clear of
 * the software keyboard.
 */
export function ModalSheet({
  open,
  onOpenChange,
  label,
  initialFocus,
  children,
}: SheetProps & { initialFocus?: RefObject<HTMLElement | null> }) {
  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange}>
      <Drawer.VirtualKeyboardProvider>
        <Drawer.Portal container={portalContainer.value ?? undefined}>
          <Drawer.Backdrop
            className={cn(
              'fixed inset-0 z-2147483647 bg-black opacity-[calc(0.2*(1-var(--drawer-swipe-progress,0)))]',
              'transition-opacity data-swiping:duration-0 data-starting-style:opacity-0 data-ending-style:opacity-0',
              'data-ending-style:duration-[calc(var(--drawer-swipe-strength,1)*400ms)]',
              EASE,
            )}
          />
          <SheetFrame label={label} height="max-h-(--sheet-full)" initialFocus={initialFocus}>
            {children}
          </SheetFrame>
        </Drawer.Portal>
      </Drawer.VirtualKeyboardProvider>
    </Drawer.Root>
  );
}

/**
 * A panel read alongside the page: the threads. It opens at `peek` so what it is
 * about stays visible above it, drags to full height, and leaves the page live,
 * so it goes only by swipe or its own close, never by a tap outside.
 */
export function PeekSheet({ open, onOpenChange, label, peek, children }: SheetProps & { peek: number }) {
  const [snap, setSnap] = useState<Drawer.Root.SnapPoint | null>(peek);
  return (
    <Drawer.Root
      open={open}
      onOpenChange={(next) => {
        if (next) setSnap(peek);
        onOpenChange(next);
      }}
      snapPoints={[peek, 1]}
      snapPoint={snap}
      onSnapPointChange={setSnap}
      modal={false}
      disablePointerDismissal
    >
      <Drawer.VirtualKeyboardProvider>
        <Drawer.Portal container={portalContainer.value ?? undefined}>
          <SheetFrame label={label} height="h-(--sheet-full)">
            {children}
          </SheetFrame>
        </Drawer.Portal>
      </Drawer.VirtualKeyboardProvider>
    </Drawer.Root>
  );
}
