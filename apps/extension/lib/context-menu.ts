import { signal } from '@preact/signals';
import { host } from './host-config';
import type { IconName } from './icons';
import { canTriage } from './session-rights';

/**
 * Singleton context-menu state. A pin sets this on right-click; the renderer in App.tsx
 * shows the menu and clears the signal on outside-click / Esc / item-select.
 */
export interface ContextMenuItem {
  label: string;
  icon?: IconName;
  onClick: () => void;
  danger?: boolean;
  /** Status changes and deletes: dropped when this session may not triage. */
  triage?: boolean;
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
  const triage = canTriage();
  contextMenu.value = { x: e.clientX, y: e.clientY, items: items.filter((i) => triage || !i.triage) };
}

export function closeContextMenu() {
  contextMenu.value = null;
}
