import { TOOL_CATALOG, type Tool } from '@marklayer/types/tools';

/** Stable semantic identities are independent of presentation and DOM structure. */
export interface UiSemantic {
  id: string;
  label: string;
  purpose: string;
  region: string;
  related: readonly string[];
}

const purposes: Record<Tool, string> = {
  navigate: 'Move around the page.',
  pen: 'Draw freehand strokes.',
  highlight: 'Highlight content with a freehand stroke.',
  line: 'Draw a line.',
  arrow: 'Draw an arrow.',
  rectangle: 'Draw a rectangle.',
  circle: 'Draw a circle.',
  text: 'Add text to the page.',
  comment: 'Place a comment on the page.',
  selection: 'Select page text for annotation or editing.',
  area: 'Mark a rectangular area.',
  eraser: 'Erase drawn annotations.',
  inspect: 'Inspect an element and its details.',
  multiInspect: 'Inspect multiple elements.',
  measure: 'Measure page elements.',
  guide: 'Guide collaborators on the page.',
};

export function toolbarToolSemantic(tool: Tool, label = TOOL_CATALOG[tool].label): UiSemantic {
  const group = TOOL_CATALOG[tool].group;
  return {
    id: `toolbar.tool.${tool}`,
    label,
    purpose: purposes[tool],
    region: 'toolbar',
    related: group
      ? (Object.keys(TOOL_CATALOG) as Tool[])
          .filter((other) => other !== tool && TOOL_CATALOG[other].group === group)
          .map((other) => `toolbar.tool.${other}`)
      : [],
  };
}
