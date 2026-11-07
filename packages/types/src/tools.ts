/**
 * The annotation tools as data: what each is called, the keys that arm it and the
 * toolbar group it sits in. Here rather than in the extension so the marketing site
 * renders its feature table from the same list the toolbar does.
 *
 * Key order is toolbar order. `shortcuts` are tinykeys patterns, aligned with Figma so
 * the muscle memory transfers, and the first is the one a tooltip shows; a tool listing
 * two is deliberate parity, not a leftover.
 */
const TOOL_CATALOG_ROWS = {
  navigate: { label: 'Move', shortcuts: ['KeyV'] },
  pen: { label: 'Pen', shortcuts: ['KeyP'], group: 'draw' },
  highlight: { label: 'Highlight', shortcuts: ['Shift+KeyH'], group: 'draw' },
  line: { label: 'Line', shortcuts: ['KeyL'], group: 'shapes' },
  arrow: { label: 'Arrow', shortcuts: ['KeyA', 'Shift+KeyL'], group: 'shapes' },
  rectangle: { label: 'Rectangle', shortcuts: ['KeyR'], group: 'shapes' },
  circle: { label: 'Circle', shortcuts: ['KeyO'], group: 'shapes' },
  text: { label: 'Text', shortcuts: ['KeyT'] },
  comment: { label: 'Comment', shortcuts: ['KeyC'] },
  selection: { label: 'Selection', shortcuts: ['KeyS'] },
  area: { label: 'Area', shortcuts: ['KeyG', 'KeyF'] },
  eraser: { label: 'Eraser', shortcuts: ['KeyE'] },
  inspect: { label: 'Inspector', shortcuts: ['KeyI'] },
  multiInspect: { label: 'Multi-select', shortcuts: ['KeyX'] },
  measure: { label: 'Measure', shortcuts: ['KeyM'] },
  guide: { label: 'Guide', shortcuts: ['KeyU'] },
} as const satisfies Record<string, { label: string; shortcuts: readonly string[]; group?: 'draw' | 'shapes' }>;

export type Tool = keyof typeof TOOL_CATALOG_ROWS;
export type ToolGroup = 'draw' | 'shapes';

/** Widened so a reader can ask any tool for its `group`; the rows keep the literal keys `Tool` derives from. */
export const TOOL_CATALOG: Record<Tool, { label: string; shortcuts: readonly string[]; group?: ToolGroup }> =
  TOOL_CATALOG_ROWS;

/** `Shift+KeyH` → `⇧H`, what a person reads on a tooltip or a feature table. */
export const shortcutLabel = (pattern: string): string => pattern.replace('Shift+', '⇧').replace('Key', '');
