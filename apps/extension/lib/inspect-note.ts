import { formatStyleEdit } from '@marklayer/agent-tools/prompt';
import type { ElementDetails, StyleEdit } from '@marklayer/types';

/** Live CSS editing is a one-element affordance, as in Cursor: once other elements are stacked, the note is a batch. */
export const canEditCss = (stackedCount: number) => stackedCount === 0;

/** The edits as a markdown section in the same `property: from -> to` lines the MCP projection uses; empty when none. */
function styleEditsSection(edits: readonly StyleEdit[]): string {
  if (!edits.length) return '';
  return `## CSS tried live\n\n${edits.map((e) => `- \`${formatStyleEdit(e)}\``).join('\n')}\n\n`;
}

/** The single-element prompt Copy puts on the clipboard. */
export function buildInspectPrompt({
  comment,
  priorityLabel,
  markdown,
  styleEdits,
}: {
  comment: string;
  priorityLabel?: string;
  markdown: string;
  styleEdits: readonly StyleEdit[];
}): string {
  const priority = priorityLabel ? `## Priority\n\n${priorityLabel}\n\n` : '';
  const task = comment ? `## Task\n\n${comment}\n\n` : '';
  return `${priority}${task}${styleEditsSection(styleEdits)}${markdown}`;
}

/** Stack items carry no edits field, so the edits ride in the item's markdown rather than vanish on "Add to stack". */
export const stackMarkdown = ({ markdown, styleEdits }: { markdown: string; styleEdits: readonly StyleEdit[] }) =>
  styleEdits.length ? `${markdown.trimEnd()}\n\n${styleEditsSection(styleEdits).trimEnd()}\n` : markdown;

/** The element-specific half of an inspect op; empty edits are left off so old and new ops read the same. */
export function inspectFields({
  selector,
  tag,
  markdown,
  rect,
  details,
  styleEdits,
}: {
  selector: string;
  tag: string;
  markdown: string;
  rect: { x: number; y: number; width: number; height: number };
  details: ElementDetails;
  styleEdits: readonly StyleEdit[];
}) {
  return {
    selector,
    tag,
    markdown,
    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    details,
    styleEdits: styleEdits.length ? [...styleEdits] : undefined,
  };
}
