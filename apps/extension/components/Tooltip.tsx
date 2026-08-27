import { Tooltip as BaseTooltip } from '@base-ui/react/tooltip';
import { cn } from '@marklayer/types';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { geist } from '../lib/geist';
import { portalContainer } from '../lib/portal';

type Placement = 'top' | 'bottom';

const MODIFIER_GLYPHS = '⌘⇧⌥⌃';

/**
 * A shortcut label as its parts: the leading modifier glyphs, then the key. Split
 * so the modifiers can carry their own optical size — `⇧H` and `⌘⇧Z` both come
 * through here, and the letter is always what remains after the run of modifiers.
 */
function ShortcutChip({ shortcut }: { shortcut: string }) {
  const chars = [...shortcut];
  const keyAt = chars.findIndex((c) => !MODIFIER_GLYPHS.includes(c));
  const modifiers = (keyAt === -1 ? chars : chars.slice(0, keyAt)).join('');
  const key = keyAt === -1 ? '' : chars.slice(keyAt).join('');
  return (
    <kbd class={geist.kbd}>
      {modifiers && <span class={geist.kbdModifier}>{modifiers}</span>}
      {key}
    </kbd>
  );
}

/**
 * Tooltip — render as a child of a `class="group …"` trigger; the trigger
 * itself is owned by the caller (e.g. a toolbar button), not by this
 * component, so it can't be wrapped in `Tooltip.Trigger` the usual Base UI
 * way. Instead this finds the trigger via the DOM (its own parent element),
 * drives `Tooltip.Root`'s `open` state from hover/focus listeners attached
 * there, and hands `Tooltip.Positioner` that element directly as its
 * `anchor` — the same virtual-anchor pattern already used by ContextMenu.tsx
 * for a Base UI popup that isn't opened from a `Trigger` element.
 */
export function Tooltip({
  text,
  shortcut,
  placement = 'top',
  wrap = false,
  disabled = false,
}: {
  text: string;
  shortcut?: string;
  placement?: Placement;
  /** Allow long descriptive text to wrap onto multiple lines (default: single-line). */
  wrap?: boolean;
  /** Hold the tooltip closed (e.g. while its trigger is being dragged) without unmounting it. */
  disabled?: boolean;
}) {
  const markerRef = useRef<HTMLSpanElement>(null);
  const anchorRef = useRef<Element | null>(null);
  const [open, setOpen] = useState(false);

  useLayoutEffect(() => {
    const anchor = markerRef.current?.parentElement;
    if (!anchor) return;
    anchorRef.current = anchor;

    // Hover and focus are tracked separately so tabbing away from a
    // still-hovered trigger (or vice versa) doesn't close the tooltip early.
    const active = { hover: false, focus: false };
    const update = (key: 'hover' | 'focus', on: boolean) => () => {
      active[key] = on;
      setOpen(active.hover || active.focus);
    };
    const ctrl = new AbortController();
    const { signal } = ctrl;
    anchor.addEventListener('mouseenter', update('hover', true), { signal });
    anchor.addEventListener('mouseleave', update('hover', false), { signal });
    // Keyboard focus only. Clicking a button focuses it too, and that focus
    // outlives the pointer — which left the tooltip pinned open after every tool
    // selection, long after the cursor had moved away.
    anchor.addEventListener(
      'focusin',
      () => {
        active.focus = anchor.matches(':focus-visible');
        setOpen(active.hover || active.focus);
      },
      { signal },
    );
    // A pointer press ends keyboard mode, and `focusin` does not fire again for an
    // already-focused button — so tabbing to a control and then clicking it would
    // otherwise keep the hold set from the earlier keyboard focus.
    anchor.addEventListener('pointerdown', update('focus', false), { signal });
    anchor.addEventListener('focusout', update('focus', false), { signal });
    return () => ctrl.abort();
  }, []);

  return (
    <>
      {/* Zero-footprint marker — its only job is to expose the real trigger
          (its parent element) via the DOM, without adding any visible or
          layout-affecting wrapper around it. */}
      <span ref={markerRef} class="hidden" aria-hidden="true" />
      <BaseTooltip.Root open={open && !disabled} onOpenChange={setOpen}>
        <BaseTooltip.Portal container={portalContainer.value ?? undefined}>
          <BaseTooltip.Positioner
            anchor={anchorRef}
            positionMethod="fixed"
            side={placement}
            sideOffset={8}
            collisionPadding={8}
            className="z-2147483647 outline-none pointer-events-none"
          >
            <BaseTooltip.Popup
              className={cn(
                geist.surfaceSmall,
                'px-2 py-1.5 flex items-center gap-2 outline-none',
                // Opacity only, and only on something already on screen: no
                // scale, so the label never wobbles as it settles.
                'transition-opacity duration-100 ease-out',
                'data-starting-style:opacity-0 data-ending-style:opacity-0',
                'data-instant:transition-none',
                wrap ? 'w-44 leading-snug' : 'whitespace-nowrap',
              )}
            >
              <span class="text-[12px] text-(--ds-gray-1000) font-medium tracking-[-0.01em]">{text}</span>
              {shortcut && <ShortcutChip shortcut={shortcut} />}
            </BaseTooltip.Popup>
          </BaseTooltip.Positioner>
        </BaseTooltip.Portal>
      </BaseTooltip.Root>
    </>
  );
}
