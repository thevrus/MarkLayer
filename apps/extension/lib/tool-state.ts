import { computed, effect, signal } from '@preact/signals';
import { track, trackChanges } from './analytics';
import { markersVisible } from './prefs';
import { scrollPageBy } from './scroller';
import { lsGet, lsSet, onHydrate } from './storage';
import {
  GROUP_OF,
  isTool,
  isToolGroup,
  parseToolSlots,
  TOOL_DEFS,
  TOOL_GROUPS,
  type ToolGroup,
  type ToolSlot,
  toolCapturesSelection,
} from './tools';
import type { Tool } from './types';

export const activeTool = signal<Tool>('navigate');

export const isDrawingTool = (t: Tool) => t !== 'navigate';

/**
 * Whether a mouseup on the page should be read for a selection at all. Markers
 * hidden is review mode: the selection layer renders at opacity 0, so a popover
 * opened then would be an invisible panel saving an invisible annotation.
 *
 * Both surfaces gate on this, so the rule cannot drift between them.
 */
export const selectionCaptureArmed = computed(() => toolCapturesSelection(activeTool.value) && markersVisible.value);

export const isDrawingActive = signal(false);

function loadGroupFaces(): Record<ToolGroup, Tool> {
  const faces: Record<ToolGroup, Tool> = { draw: TOOL_GROUPS.draw[0], shapes: TOOL_GROUPS.shapes[0] };
  try {
    const parsed: unknown = JSON.parse(lsGet('ml-tool-faces') ?? 'null');
    if (!Array.isArray(parsed)) return faces;
    for (const t of parsed) {
      if (!isTool(t)) continue;
      const g = GROUP_OF.get(t);
      if (g) faces[g] = t;
    }
    return faces;
  } catch {
    return faces;
  }
}

/** Which member each group's button shows. Follows `activeTool`, so a shortcut moves it too. */
export const groupFaces = signal<Record<ToolGroup, Tool>>({ draw: TOOL_GROUPS.draw[0], shapes: TOOL_GROUPS.shapes[0] });

/** The tool a slot selects when its button is pressed. */
export const slotTool = (slot: ToolSlot): Tool => (isToolGroup(slot) ? groupFaces.value[slot] : slot);

/**
 * Tools that read the framed page's element tree. On a PDF there isn't one worth
 * reading — every hover resolves to a page-sized canvas or a single text run —
 * so the web app raises this: the toolbar drops them, `selectTool` refuses them
 * and an armed one falls back to navigate. The extension never sets it: it only
 * ever runs on a real document.
 */
const readsElements = (slot: ToolSlot) => isTool(slot) && Boolean(TOOL_DEFS[slot].readsElements);
export const elementToolsUnavailable = signal(false);

export const toolSlots = signal<ToolSlot[]>(parseToolSlots(null));

onHydrate(() => {
  groupFaces.value = loadGroupFaces();
  toolSlots.value = parseToolSlots(lsGet('ml-tool-order'));
});

/** What the toolbar renders. Derived rather than filtered per render: the list
 *  keys a FLIP layout pass, so a fresh array identity re-measures every button. */
export const visibleSlots = computed(() =>
  elementToolsUnavailable.value ? toolSlots.value.filter((t) => !readsElements(t)) : toolSlots.value,
);

/** Moves `slot` into the place `to` holds, by identity, so slots the host hides keep their own places. */
export function moveSlot({ slot, to }: { slot: ToolSlot; to: ToolSlot }) {
  const arr = toolSlots.value;
  const from = arr.indexOf(slot);
  const at = arr.indexOf(to);
  if (from === at || from < 0 || at < 0) return;
  const next = arr.filter((s) => s !== slot);
  next.splice(at, 0, slot);
  toolSlots.value = next;
  lsSet('ml-tool-order', JSON.stringify(next));
  // A tool dragged to the front is someone telling us it matters more than its default slot.
  track('toolbar_reordered', { tool: slot, to: at });
}

/**
 * Hand tool. Sticky while `H` is toggled on, momentary while Space is held —
 * both drag-scroll the annotated surface without leaving the current tool.
 */
export const handTool = signal(false);
export const spaceHeld = signal(false);
export const panActive = computed(() => handTool.value || spaceHeld.value);

/** How a tool was reached. A programmatic switch — Escape, an inspector exit — reports `other`. */
export type ToolSelectVia = 'toolbar' | 'shortcut' | 'radial' | 'other';

let pendingVia: ToolSelectVia = 'other';

/**
 * Pick a tool, recording how. The write and the reset happen here rather than at
 * the call sites because re-picking the tool that is already active is a no-op
 * write: the effect never runs, and a `via` left pending would then be spent on
 * whatever automatic switch came next.
 */
export function selectTool({ tool, via }: { tool: Tool; via: ToolSelectVia }) {
  // Before anything else: a shortcut has no button to be hidden with.
  if (elementToolsUnavailable.value && readsElements(tool)) return;
  pendingVia = via;
  activeTool.value = tool;
  pendingVia = 'other';
}

/** Started by `initHost`, so importing this module changes nothing. */
export function wireToolState() {
  effect(() => {
    const t = activeTool.value;
    const g = GROUP_OF.get(t);
    const faces = groupFaces.peek();
    if (!g || faces[g] === t) return;
    groupFaces.value = { ...faces, [g]: t };
    lsSet('ml-tool-faces', JSON.stringify(Object.values(groupFaces.value)));
  });
  // Structural rather than a setTool() wrapper: every tool writer (toolbar click,
  // shortcut, Escape, the inspect layers) has to drop sticky hand mode, and a
  // wrapper only the shortcut path called left the others holding it.
  effect(() => {
    activeTool.value;
    handTool.value = false;
  });
  // The frame can land on a PDF with one of these already armed.
  effect(() => {
    if (elementToolsUnavailable.value && readsElements(activeTool.value)) activeTool.value = 'navigate';
  });
  // Which tools people actually reach for. On the signal, not in `selectTool`, so
  // the switches nothing routes through it are still counted.
  trackChanges(activeTool, (tool) => track('tool_selected', { tool, via: pendingVia }));
}

/**
 * Scrolls the annotated surface by a viewport delta. Null means the host window
 * itself (the extension); the web viewer sets it to scroll the proxied iframe,
 * which is a different scroller sitting behind a CSS transform.
 */
export const panScrollBy = signal<((dx: number, dy: number) => void) | null>(null);

export function panBy(dx: number, dy: number) {
  const fn = panScrollBy.value;
  fn ? fn(dx, dy) : scrollPageBy(window, dx, dy);
}

/**
 * Alt held on its own. Figma shows measurements whenever you hover with Alt
 * down, from any tool, so the measure overlays read this alongside their own
 * tool check. Fed by `bindFigmaKeys`.
 */
export const altHeld = signal(false);

/** The M tool is selected — pinned anchors and the crosshair belong to it alone. */
export const measureToolActive = computed(() => activeTool.value === 'measure');

/** The measure overlays should render: the M tool, or a held Alt from any tool. */
export const measureActive = computed(() => measureToolActive.value || altHeld.value);
