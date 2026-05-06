import { cn } from '@marklayer/types';
import { useSignalEffect } from '@preact/signals';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { glass } from '../lib/glass';
import { Icon } from '../lib/icons';
import { closeContextMenu, contextMenu } from '../lib/state';

const MENU_WIDTH = 200;
const VIEWPORT_PAD = 6;

export function ContextMenu() {
  const state = contextMenu.value;
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useSignalEffect(() => {
    if (!contextMenu.value) return;
    const onDown = (e: PointerEvent) => {
      const menu = ref.current;
      if (!menu) return;
      // composedPath() walks through shadow roots — events bubbling out of the
      // extension's <mark-layer> host get retargeted, so a plain `e.target`
      // check would treat every menu-item click as "outside" and close the
      // menu before the click handler runs.
      if (e.composedPath().includes(menu)) return;
      closeContextMenu();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeContextMenu();
      }
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  });

  // Flip the menu horizontally / vertically if it would overflow the viewport.
  useLayoutEffect(() => {
    if (!state || !ref.current) {
      setPos(null);
      return;
    }
    const r = ref.current.getBoundingClientRect();
    const w = r.width || MENU_WIDTH;
    const h = r.height || 1;
    let left = state.x;
    let top = state.y;
    if (left + w > innerWidth - VIEWPORT_PAD) left = Math.max(VIEWPORT_PAD, state.x - w);
    if (top + h > innerHeight - VIEWPORT_PAD) top = Math.max(VIEWPORT_PAD, state.y - h);
    setPos({ left, top });
  }, [state]);

  if (!state) return null;

  return (
    <div
      ref={ref}
      role="menu"
      class={cn(
        'fixed z-2147483647 pointer-events-auto py-1 select-none',
        'animate-[mlPanelIn_140ms_cubic-bezier(0.16,1,0.3,1)]',
        glass.surfaceSmall,
        glass.font,
      )}
      style={{
        minWidth: MENU_WIDTH,
        left: pos ? pos.left : state.x,
        top: pos ? pos.top : state.y,
        // Hidden until measured so the flip-into-viewport pass doesn't flash
        visibility: pos ? 'visible' : 'hidden',
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {state.items.map((it) => (
        <button
          key={it.label}
          type="button"
          role="menuitem"
          onClick={(e) => {
            e.stopPropagation();
            closeContextMenu();
            it.onClick();
          }}
          class={cn(
            'w-full flex items-center gap-2.5 px-3 py-1.5 text-left',
            'appearance-none border-none bg-transparent cursor-pointer',
            'text-[12.5px] font-medium leading-none',
            'transition-[background-color,color] duration-100',
            it.danger
              ? 'text-(--ml-state-red) hover:bg-(--ml-state-red)/15'
              : 'text-ml-glass-fg/80 hover:bg-ml-glass-fg/10 hover:text-ml-glass-fg',
          )}
        >
          {it.icon && (
            <span class="inline-flex w-3.5 shrink-0">
              <Icon name={it.icon} size={13} />
            </span>
          )}
          {it.label}
        </button>
      ))}
    </div>
  );
}
