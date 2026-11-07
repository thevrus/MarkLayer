import { signal } from '@preact/signals';
import { host } from './host-config';
import type { IconName } from './icons';

/**
 * Singleton context-menu state. A pin sets this on right-click; the renderer in App.tsx
 * shows the menu and clears the signal on outside-click / Esc / item-select.
 */
export interface ContextMenuItem {
  label: string;
  icon?: IconName;
  onClick: () => void;
  danger?: boolean;
}
export interface ContextMenuState {
  x: number;
  y: number;
  items: ContextMenuItem[];
}
export const contextMenu = signal<ContextMenuState | null>(null);

export function openContextMenu(e: MouseEvent, items: ContextMenuItem[]) {
  // No renderer to show it, so the browser's own menu has to survive.
  if (!host.capabilities.contextMenu) return;
  e.preventDefault();
  e.stopPropagation();
  contextMenu.value = { x: e.clientX, y: e.clientY, items };
}

export function closeContextMenu() {
  contextMenu.value = null;
}
