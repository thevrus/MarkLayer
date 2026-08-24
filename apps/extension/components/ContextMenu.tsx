import { Menu } from '@base-ui/react/menu';
import { cn } from '@marklayer/types';
import { glass } from '../lib/glass';
import { Icon } from '../lib/icons';
import { portalContainer } from '../lib/portal';
import { closeContextMenu, contextMenu } from '../lib/state';

export function ContextMenu() {
  const state = contextMenu.value;
  if (!state) return null;

  // Base UI positions popups against an anchor element (or a virtual stand-in for
  // one). This menu opens at a point, not from a trigger, so we hand the
  // Positioner a virtual anchor: a zero-size rect at the click coordinates. Its
  // collision handling then replaces the old manual flip-into-viewport logic.
  const anchor = {
    getBoundingClientRect: () => DOMRect.fromRect({ x: state.x, y: state.y }),
  };

  return (
    <Menu.Root
      open
      onOpenChange={(nextOpen: boolean) => {
        if (!nextOpen) closeContextMenu();
      }}
    >
      <Menu.Portal container={portalContainer.value ?? undefined}>
        <Menu.Positioner
          anchor={anchor}
          positionMethod="fixed"
          side="bottom"
          align="start"
          collisionPadding={6}
          className="z-2147483647 outline-none"
        >
          <Menu.Popup
            className={cn('min-w-50', glass.menuPopup, glass.surfaceSmall, glass.font)}
            onContextMenu={(e: MouseEvent) => e.preventDefault()}
          >
            {state.items.map((it) => (
              <Menu.Item
                key={it.label}
                onClick={(e: MouseEvent) => {
                  e.stopPropagation();
                  it.onClick();
                }}
                className={cn(
                  'w-full flex items-center gap-2.5 px-3 py-1.5 text-left',
                  'text-[12.5px] font-medium leading-none',
                  glass.menuItem,
                  it.danger
                    ? 'text-(--ml-state-red) hover:bg-(--ml-state-red)/15 data-highlighted:bg-(--ml-state-red)/15'
                    : glass.menuItemHighlight,
                )}
              >
                {it.icon && (
                  <span class="inline-flex w-3.5 shrink-0">
                    <Icon name={it.icon} size={13} />
                  </span>
                )}
                {it.label}
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
