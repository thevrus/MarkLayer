import { describe, expect, test } from 'bun:test';
import { TOOL_CATALOG, type Tool } from '@marklayer/types/tools';
import { createSemanticRegistry, toolbarToolSemantic } from './ui-semantics';

describe('toolbar semantic catalog', () => {
  test('assigns every registered tool a stable identity and purpose', () => {
    for (const tool of Object.keys(TOOL_CATALOG) as Tool[]) {
      const semantic = toolbarToolSemantic(tool);
      expect(semantic.id).toBe(`toolbar.tool.${tool}`);
      expect(semantic.label).toBe(TOOL_CATALOG[tool].label);
      expect(semantic.purpose.length).toBeGreaterThan(0);
      expect(semantic.region).toBe('toolbar');
    }
  });

  test('relates tools in the same group without including itself', () => {
    expect(toolbarToolSemantic('pen').related).toContain('toolbar.tool.highlight');
    expect(toolbarToolSemantic('pen').related).not.toContain('toolbar.tool.pen');
    expect(toolbarToolSemantic('pen').related).not.toContain('toolbar.tool.rectangle');
  });
});

test('new component semantics can be registered without changing the lookup code', () => {
  const registry = createSemanticRegistry();
  const spec = { id: 'annotation.reply', label: '回复', purpose: '回复批注', region: 'annotation', related: ['annotation.thread'] };
  registry.register(spec);
  spec.related.push('changed-after-registration');
  expect(registry.get('annotation.reply')?.related).toEqual(['annotation.thread']);
  expect(() => registry.register(spec)).toThrow('Duplicate');
  expect(registry.get('unknown')).toBeUndefined();
});
