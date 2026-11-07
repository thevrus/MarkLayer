import { geist } from '@ext/lib/geist';
import { cn } from '@marklayer/ui/cn';
import type { ComponentChildren } from 'preact';
import { annotationPanelOpen, infoPanelOpen } from './ui-state';
import { panelsDocked } from './viewer-state';

const PANEL_BASE = cn(geist.surface, 'flex flex-col overflow-hidden');

/**
 * The desktop panels as flush sidebars: square, hard against the window edge, and
 * separated from the frame by one inner hairline rather than an all-round shadow —
 * a panel welded to an edge has no side for a shadow to fall on. Layered above the
 * toolbar (z-2147483646) so a sidebar covers it instead of being covered by it.
 */
export const PANEL_SIDEBAR = cn(
  'absolute inset-y-0 z-2147483647 flex flex-col overflow-hidden bg-(--ds-background-100)',
);
export const PANEL_TRANSITION = 'transition-[opacity,translate] duration-300 ease-ml-spring';

/** Width of the docked variant, and the `m-3` gutters around it. The viewer subtracts
 *  both when auto-fitting a device frame, since a docked panel takes real width from it. */
export const DOCKED_ANNOTATION_WIDTH = 340;
export const DOCK_GUTTER = 24;
export const INFO_PANEL_WIDTH = 300;

/** Horizontal space the open docked panels take from a device frame. */
export function dockedPanelsWidth(): number {
  if (!panelsDocked.value) return 0;
  return (
    (infoPanelOpen.value ? INFO_PANEL_WIDTH + DOCK_GUTTER : 0) +
    (annotationPanelOpen.value ? DOCKED_ANNOTATION_WIDTH + DOCK_GUTTER : 0)
  );
}

/**
 * A panel docked beside the device frame (rather than overlaid on it), shared
 * by the annotation panel and the viewer's info panel so the collapse trick —
 * width-to-0 with `!mx-0 !p-0 !border-0` to erase the gutter — lives once.
 */
export function DockedPanel({
  visible,
  width,
  children,
}: {
  visible: boolean;
  width: number;
  children: ComponentChildren;
}) {
  return (
    <div
      class={cn(
        'shrink-0 m-3 rounded-xl',
        PANEL_TRANSITION,
        PANEL_BASE,
        visible ? 'opacity-100' : 'opacity-0 !mx-0 !p-0 !border-0',
      )}
      style={{ width: visible ? width : 0 }}
    >
      {children}
    </div>
  );
}
