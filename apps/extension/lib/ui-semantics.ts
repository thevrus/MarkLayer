import { TOOL_CATALOG, type Tool } from '@marklayer/types/tools';
import toolPurposes from './ui-semantic-tools.json';

/** Stable semantic identities are independent of presentation and DOM structure. */
export interface UiSemantic {
  id: string;
  label: string;
  purpose: string;
  region: string;
  related: readonly string[];
}

const purposes: Record<Tool, string> = toolPurposes;

/** A registry accepts data only; a semantic entry does not grant executable capabilities. */
export function createSemanticRegistry() {
  const entries = new Map<string, UiSemantic>();
  return {
    register(value: UiSemantic): void {
      if (!/^[a-zA-Z][a-zA-Z0-9._-]{0,127}$/.test(value.id) ||
          !value.label.trim() || !value.purpose.trim() || !value.region.trim() ||
          !Array.isArray(value.related) || value.related.some((id) => typeof id !== 'string')) {
        throw new Error('Invalid UI semantic definition');
      }
      if (entries.has(value.id)) throw new Error(`Duplicate UI semantic ID: ${value.id}`);
      entries.set(value.id, { ...value, related: [...value.related] });
    },
    get(id: string): UiSemantic | undefined {
      const entry = entries.get(id);
      return entry ? { ...entry, related: [...entry.related] } : undefined;
    },
  };
}

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
