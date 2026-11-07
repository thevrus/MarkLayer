import { shortcutLabel, TOOL_CATALOG } from '@marklayer/types/tools';
import type { Tool } from './types';

const isCatalogued = (k: string): k is Tool => Object.hasOwn(TOOL_CATALOG, k);
const TOOLS_IN_ORDER: Tool[] = Object.keys(TOOL_CATALOG).filter(isCatalogued);

export type FreehandTool = 'pen' | 'eraser' | 'highlight';
export type ShapeTool = 'rectangle' | 'circle' | 'line' | 'arrow';

/** How a tool behaves on the page; the catalog in @marklayer/types holds what it is called and its keys. */
interface ToolBehaviour {
  paints?: 'freehand' | 'shape';
  /**
   * A plain text selection under this tool means "annotate this passage". Positive,
   * so a tool added later stays inert until someone decides otherwise: every other
   * tool owns a drag across the page, and the highlight its gesture sweeps up is a
   * side effect, not a request. `navigate` is on the list on purpose — proposing a
   * copy edit is the most common annotation there is.
   */
  capturesSelection?: boolean;
  /** A double-click edits page text in place. */
  editsText?: boolean;
  /** The toolbar counts its pending items on the button. */
  badge?: boolean;
  /** Reads the framed page's element tree, so a PDF has nothing for it. */
  readsElements?: boolean;
  /** The toolbar's name, where it is shorter than the catalog's. */
  label?: string;
}

/** Exhaustive by type: a tool added to the catalog does not compile until it is placed here. */
export const TOOL_DEFS: Record<Tool, ToolBehaviour> = {
  navigate: { capturesSelection: true },
  pen: { paints: 'freehand' },
  highlight: { paints: 'freehand' },
  line: { paints: 'shape' },
  arrow: { paints: 'shape' },
  rectangle: { paints: 'shape' },
  circle: { paints: 'shape' },
  text: { capturesSelection: true },
  comment: { capturesSelection: true },
  selection: { capturesSelection: true, editsText: true },
  area: {},
  eraser: { paints: 'freehand' },
  inspect: { capturesSelection: true, editsText: true, badge: true, readsElements: true, label: 'Inspect' },
  multiInspect: { readsElements: true },
  measure: { readsElements: true },
  guide: {},
};

export const toolLabel = (t: Tool): string => TOOL_DEFS[t].label ?? TOOL_CATALOG[t].label;

export const FREEHAND = {
  has: (t: string): t is FreehandTool => t === 'pen' || t === 'eraser' || t === 'highlight',
};
export const SHAPES = {
  has: (t: string): t is ShapeTool => t === 'rectangle' || t === 'circle' || t === 'line' || t === 'arrow',
};

/** Whether a tool paints on the drawing canvas, as opposed to placing a DOM-anchored annotation over it. */
export const toolPaintsCanvas = (t: Tool) => TOOL_DEFS[t].paints !== undefined;
export const toolCapturesSelection = (t: Tool) => Boolean(TOOL_DEFS[t].capturesSelection);
export const toolEditsText = (t: Tool) => Boolean(TOOL_DEFS[t].editsText);

export const TOOLS: Tool[] = TOOLS_IN_ORDER;

const TOOL_SET: ReadonlySet<string> = new Set(TOOLS);
export const isTool = (v: unknown): v is Tool => typeof v === 'string' && TOOL_SET.has(v);

/**
 * Tools that share a gesture and differ only in what they leave behind sit
 * behind one toolbar button, as Figma's shape and pen menus do. The first
 * member is the button's face until another one is used.
 */
export const TOOL_GROUPS = {
  draw: ['pen', 'highlight'],
  shapes: ['rectangle', 'circle', 'line', 'arrow'],
} as const satisfies Record<string, readonly Tool[]>;
export type ToolGroup = keyof typeof TOOL_GROUPS;
/** One toolbar position: a lone tool, or a group showing whichever member was used last. */
export type ToolSlot = Tool | ToolGroup;

export const isToolGroup = (v: unknown): v is ToolGroup => typeof v === 'string' && Object.hasOwn(TOOL_GROUPS, v);

export const GROUP_OF = new Map<Tool, ToolGroup>();
for (const g of Object.keys(TOOL_GROUPS)) if (isToolGroup(g)) for (const t of TOOL_GROUPS[g]) GROUP_OF.set(t, g);
/** The toolbar position a tool lives in. */
export const slotOf = (t: Tool): ToolSlot => GROUP_OF.get(t) ?? t;

function dedupeSlots(entries: unknown[]): ToolSlot[] {
  const seen = new Set<ToolSlot>();
  for (const v of entries) {
    // An order saved before grouping lists members; the group takes its first member's place.
    const slot = isTool(v) ? slotOf(v) : isToolGroup(v) ? v : null;
    if (slot) seen.add(slot);
  }
  return [...seen];
}

const DEFAULT_SLOTS: ToolSlot[] = dedupeSlots(TOOLS);

/** A saved toolbar order, migrated: unknown entries dropped, slots added in code since appended. */
export function parseToolSlots(raw: string | null): ToolSlot[] {
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!Array.isArray(parsed)) return DEFAULT_SLOTS;
    return dedupeSlots([...parsed, ...DEFAULT_SLOTS]);
  } catch {
    return DEFAULT_SLOTS;
  }
}

/**
 * Tool keybindings, aligned with Figma so the muscle memory transfers: V move,
 * R rectangle, O ellipse, T text, C comment, P pen, L line, E eraser. `H` is
 * the hand tool here as it is there, which is why the highlighter moved to
 * Shift+H. A tool may list more than one pattern — Figma binds the arrow to
 * Shift+L and the frame to both F and A — and the first entry is the one the
 * toolbar shows.
 */
export const TOOL_SHORTCUTS: {
  tool: Tool;
  /** tinykeys pattern, e.g. `KeyR` or `Shift+KeyL`. */
  pattern: string;
}[] = TOOLS.flatMap((tool) => TOOL_CATALOG[tool].shortcuts.map((pattern) => ({ tool, pattern })));

/** First pattern per tool — what the toolbar tooltip displays. */
export const SHORTCUTS: Partial<Record<Tool, string>> = {};
for (const { tool, pattern } of TOOL_SHORTCUTS) SHORTCUTS[tool] ??= shortcutLabel(pattern);
