import { useComputed, useSignal, useSignalEffect } from '@preact/signals';
import { tinykeys } from 'tinykeys';
import { injectCrosshairCursor } from '../lib/dom';
import { pickGuideAtPoint, type RectLike } from '../lib/measure';
import { isExtensionElement } from '../lib/selector';
import {
  activeTool,
  addGuide,
  clearGuides,
  ensureScrollTickListener,
  flipGuide,
  guides,
  type Orientation,
  removeGuide,
  scrollTick,
  selectedGuideId,
  updateGuide,
} from '../lib/state';

const HUE_GUIDE = 30;
export const GUIDE_COLOR = `oklch(0.7 0.19 ${HUE_GUIDE} / 0.7)`;
export const GUIDE_COLOR_SELECTED = `oklch(0.75 0.22 ${HUE_GUIDE})`;
export const GUIDE_COLOR_PREVIEW = `oklch(0.7 0.19 ${HUE_GUIDE} / 0.35)`;
export const GUIDE_PANEL = `oklch(0.22 0.015 200 / 0.96)`;
export const GUIDE_PANEL_FG = `oklch(0.88 0.12 ${HUE_GUIDE})`;
export const GUIDE_HIT_PX = 8;

// `screenPosition` is in viewport coords — callers subtract the current scroll offset
// from the guide's stored document coord. `bounds` (optional) clips the line to a host
// container — e.g. the web viewer's iframe rect — so guides don't bleed over the Topbar.
// Vertical lines clip top/height (Topbar sits above iframe); horizontal lines keep full
// viewport width since there's no left/right chrome in either layout.
const lineStyle = (
  orientation: Orientation,
  screenPosition: number,
  bounds: RectLike | undefined,
  border: string,
): Record<string, string | number> | null => {
  if (bounds) {
    if (orientation === 'vertical') {
      if (screenPosition < bounds.left || screenPosition > bounds.left + bounds.width) return null;
      return { left: screenPosition, top: bounds.top, width: 0, height: bounds.height, borderLeft: border };
    }
    if (screenPosition < bounds.top || screenPosition > bounds.top + bounds.height) return null;
    return { left: 0, top: screenPosition, width: '100vw', height: 0, borderTop: border };
  }
  return orientation === 'vertical'
    ? { left: screenPosition, top: 0, width: 0, height: '100vh', borderLeft: border }
    : { left: 0, top: screenPosition, width: '100vw', height: 0, borderTop: border };
};

export function GuideLine({
  orientation,
  screenPosition,
  selected,
  hovered,
  bounds,
}: {
  orientation: Orientation;
  screenPosition: number;
  selected: boolean;
  hovered?: boolean;
  bounds?: RectLike;
}) {
  const color = selected || hovered ? GUIDE_COLOR_SELECTED : GUIDE_COLOR;
  const thickness = hovered || selected ? 2 : 1;
  const style = lineStyle(orientation, screenPosition, bounds, `${thickness}px solid ${color}`);
  if (!style) return null;
  return <div class="fixed z-2147483645 pointer-events-none" style={style} />;
}

export function GuidePreview({
  orientation,
  position,
  bounds,
}: {
  orientation: Orientation;
  position: number;
  bounds?: RectLike;
}) {
  const style = lineStyle(orientation, position, bounds, `1px dashed ${GUIDE_COLOR_PREVIEW}`);
  if (!style) return null;
  return <div class="fixed z-2147483645 pointer-events-none" style={style} />;
}

export function GuidePositionTag({ x, y, text }: { x: number; y: number; text: string }) {
  return (
    <div
      class="fixed z-2147483647 pointer-events-none font-mono text-micro tabular-nums"
      style={{
        left: x,
        top: y,
        transform: 'translate(8px, 8px)',
        padding: '2px 6px',
        borderRadius: 4,
        background: GUIDE_PANEL,
        color: GUIDE_PANEL_FG,
        border: `1px solid ${GUIDE_COLOR}`,
        boxShadow: '0 2px 8px oklch(0 0 0 / 0.3)',
      }}
    >
      {text}
    </div>
  );
}

const stopEvent = (e: Event) => {
  e.preventDefault();
  e.stopPropagation();
};
const PILL_BTN = 'inline-flex items-center gap-1 px-2 py-1 cursor-pointer hover:brightness-110';

// `data-marklayer-overlay` marker so window-level mousedown handlers skip clicks on our UI
// (otherwise they'd create a phantom guide alongside the action).
export function GuidePill({
  orientation,
  screenPosition,
  onFlip,
  onDelete,
  bounds,
}: {
  orientation: Orientation;
  screenPosition: number;
  onFlip: (e: MouseEvent) => void;
  onDelete: () => void;
  bounds?: RectLike;
}) {
  // Anchor the pill inside the host container (the web viewer's iframe rect) when
  // provided, otherwise to the viewport edge. Keeps the pill out of UI chrome like the Topbar.
  const anchor = bounds ? { x: bounds.left + 16, y: bounds.top + 16 } : { x: 16, y: 16 };
  const style: Record<string, string | number> =
    orientation === 'vertical'
      ? { left: screenPosition, top: anchor.y, transform: 'translate(-50%, 0)' }
      : { left: anchor.x, top: screenPosition, transform: 'translate(0, -50%)' };
  return (
    <div
      data-marklayer-overlay="true"
      class="fixed z-2147483647 inline-flex items-center font-mono text-micro tabular-nums rounded-md overflow-hidden"
      style={{
        ...style,
        background: GUIDE_PANEL,
        color: GUIDE_PANEL_FG,
        border: `1px solid ${GUIDE_COLOR_SELECTED}`,
        boxShadow: '0 2px 8px oklch(0 0 0 / 0.3)',
      }}
      onMouseDown={stopEvent}
    >
      <button
        type="button"
        class={PILL_BTN}
        title={`flip to ${orientation === 'vertical' ? 'horizontal' : 'vertical'}`}
        onClick={(e) => {
          stopEvent(e);
          onFlip(e);
        }}
      >
        <span>⇄</span>
        <span>flip</span>
      </button>
      <span style={{ width: 1, alignSelf: 'stretch', background: GUIDE_COLOR_SELECTED, opacity: 0.5 }} />
      <button
        type="button"
        class={PILL_BTN}
        title="delete guide"
        onClick={(e) => {
          stopEvent(e);
          onDelete();
        }}
      >
        <span>×</span>
        <span>delete</span>
      </button>
    </div>
  );
}

export function GuideHint({ bounds }: { bounds?: RectLike }) {
  // Pin to the host container's top so the hint doesn't render over outer chrome like the Topbar.
  const containerStyle: Record<string, string | number> = bounds
    ? { left: bounds.left + bounds.width / 2, top: bounds.top + 20, transform: 'translate(-50%, 0)' }
    : { left: '50%', top: 20, transform: 'translate(-50%, 0)' };
  return (
    <div
      class="fixed z-2147483647 pointer-events-none
             px-3 py-1.5 text-mini font-medium tracking-label rounded-lg
             animate-[fadeInDown_180ms_ease-out] font-mono whitespace-nowrap"
      style={{
        ...containerStyle,
        background: GUIDE_PANEL,
        color: GUIDE_PANEL_FG,
        border: `1px solid ${GUIDE_COLOR}`,
        boxShadow: '0 6px 20px oklch(0 0 0 / 0.35)',
      }}
    >
      Click to drop · Shift+click for vertical · Drag a guide to move · Backspace to delete · ⌘Z to undo
    </div>
  );
}

/**
 * Always-mounted overlay that renders document-anchored ruler guides.
 * Guides scroll with the page (Figma/Photoshop semantics) — stored as
 * document coords and rendered with the current scroll subtracted.
 */
export function GuideLayer() {
  const cursor = useSignal<{ x: number; y: number } | null>(null);
  const shift = useSignal(false);
  const dragId = useSignal<string | null>(null);

  // Listeners and keybindings only exist while the guide tool is active —
  // tool-switch tear-down doubles as the state reset.
  useSignalEffect(() => {
    if (activeTool.value !== 'guide') return;
    ensureScrollTickListener();

    const onMove = (e: MouseEvent) => {
      cursor.value = { x: e.clientX, y: e.clientY };
      const id = dragId.peek();
      if (id) {
        const g = guides.peek().find((p) => p.id === id);
        if (g) updateGuide(id, g.orientation === 'vertical' ? e.clientX + window.scrollX : e.clientY + window.scrollY);
      }
    };

    const onDown = (e: MouseEvent) => {
      if (e.target instanceof Element && (isExtensionElement(e.target) || e.target.closest('[data-marklayer-overlay]')))
        return;
      e.preventDefault();
      e.stopPropagation();
      const docPoint = { x: e.clientX + window.scrollX, y: e.clientY + window.scrollY };
      const hit = pickGuideAtPoint(docPoint, guides.peek(), GUIDE_HIT_PX);
      if (hit) {
        selectedGuideId.value = hit.id;
        dragId.value = hit.id;
        return;
      }
      const orientation = e.shiftKey ? 'vertical' : 'horizontal';
      const position = orientation === 'vertical' ? docPoint.x : docPoint.y;
      const g = addGuide(orientation, position);
      selectedGuideId.value = g.id;
      dragId.value = g.id;
    };

    const onUp = () => {
      dragId.value = null;
    };

    const deleteSelected = (e: KeyboardEvent) => {
      const sel = selectedGuideId.peek() ?? guides.peek().at(-1)?.id;
      if (!sel) return;
      e.preventDefault();
      e.stopPropagation();
      removeGuide(sel);
    };

    const onBlur = () => {
      shift.value = false;
      dragId.value = null;
    };

    const unbindKeysDown = tinykeys(window, {
      Shift: () => {
        shift.value = true;
      },
      Escape: (e) => {
        if (!guides.peek().length) return;
        e.preventDefault();
        e.stopPropagation();
        clearGuides();
      },
      Backspace: deleteSelected,
      Delete: deleteSelected,
    });
    const unbindKeysUp = tinykeys(
      window,
      {
        Shift: () => {
          shift.value = false;
        },
      },
      { event: 'keyup' },
    );

    window.addEventListener('mousemove', onMove, true);
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('mouseup', onUp, true);
    window.addEventListener('blur', onBlur);
    return () => {
      unbindKeysDown();
      unbindKeysUp();
      window.removeEventListener('mousemove', onMove, true);
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('mouseup', onUp, true);
      window.removeEventListener('blur', onBlur);
      cursor.value = null;
      shift.value = false;
      dragId.value = null;
      selectedGuideId.value = null;
    };
  });

  useSignalEffect(() => {
    if (activeTool.value !== 'guide') return;
    return injectCrosshairCursor(document);
  });

  const isGuideTool = activeTool.value === 'guide';
  const cur = cursor.value;
  const orientation = shift.value ? 'vertical' : 'horizontal';
  const previewPos = cur ? (orientation === 'vertical' ? cur.x : cur.y) : 0;
  const dragging = !!dragId.value;

  void scrollTick.value;
  const sx = typeof window === 'undefined' ? 0 : window.scrollX;
  const sy = typeof window === 'undefined' ? 0 : window.scrollY;

  const docCursor = cur ? { x: cur.x + sx, y: cur.y + sy } : null;
  const hoveredGuide = docCursor ? pickGuideAtPoint(docCursor, guides.value, GUIDE_HIT_PX) : null;
  // Derived as a computed so the cursor-injection effect only re-runs when the
  // resulting cursor string actually changes — not on every mousemove tick.
  const guideCursor = useComputed<'ew-resize' | 'ns-resize' | null>(() => {
    if (activeTool.value !== 'guide') return null;
    const id = dragId.value;
    const dragged = id ? guides.value.find((g) => g.id === id) : null;
    const cur2 = cursor.value;
    const target =
      dragged ??
      (cur2
        ? pickGuideAtPoint({ x: cur2.x + window.scrollX, y: cur2.y + window.scrollY }, guides.value, GUIDE_HIT_PX)
        : null);
    if (!target) return null;
    return target.orientation === 'vertical' ? 'ew-resize' : 'ns-resize';
  });
  useSignalEffect(() => {
    const c = guideCursor.value;
    if (!c) return;
    const style = document.createElement('style');
    style.textContent = `*, *::before, *::after { cursor: ${c} !important; }`;
    document.head.appendChild(style);
    return () => style.remove();
  });
  const showPreview = isGuideTool && !dragging && cur && !hoveredGuide;
  const selected = guides.value.find((g) => g.id === selectedGuideId.value) ?? null;
  const screenSelectedPos = selected
    ? selected.orientation === 'vertical'
      ? selected.position - sx
      : selected.position - sy
    : 0;
  const dragGuide = dragId.value ? guides.value.find((g) => g.id === dragId.value) : null;

  return (
    <>
      {isGuideTool && !guides.value.length && !dragging && <GuideHint />}
      {guides.value.map((g) => (
        <GuideLine
          key={g.id}
          orientation={g.orientation}
          screenPosition={g.orientation === 'vertical' ? g.position - sx : g.position - sy}
          selected={g.id === selectedGuideId.value}
          hovered={isGuideTool && (g.id === hoveredGuide?.id || g.id === dragId.value)}
        />
      ))}
      {showPreview && <GuidePreview orientation={orientation} position={previewPos} />}
      {isGuideTool && cur && dragGuide && (
        <GuidePositionTag
          x={cur.x}
          y={cur.y}
          text={`${dragGuide.orientation === 'vertical' ? 'x' : 'y'}: ${Math.round(dragGuide.position)}px`}
        />
      )}
      {isGuideTool && selected && !dragging && (
        <GuidePill
          orientation={selected.orientation}
          screenPosition={screenSelectedPos}
          onFlip={(e) => {
            // After flip, place the new line where the user clicked: cursor X if becoming vertical, Y if horizontal.
            const newPos = selected.orientation === 'vertical' ? e.clientY + sy : e.clientX + sx;
            flipGuide(selected.id, newPos);
          }}
          onDelete={() => removeGuide(selected.id)}
        />
      )}
    </>
  );
}
