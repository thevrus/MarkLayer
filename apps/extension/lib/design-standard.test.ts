import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const root = new URL('../../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');

test('design handoff baseline points to the implemented shared tokens and editable deliverables', () => {
  const standard = read('docs/design-standard-v1.md');
  const tokens = read('packages/tokens/theme.css');
  const template = read('docs/design-handoff-template.md');
  for (const [variable, value] of [
    ['--color-ml-bg', '#fbfaf9'],
    ['--color-ml-fg', '#1a1a1a'],
    ['--color-ml-btn', '#1a1a1a'],
    ['--color-ml-accent', 'oklch(0.65 0.15 300)'],
  ] as const) {
    expect(tokens).toContain(`${variable}: ${value};`);
    expect(standard).toContain(variable);
    expect(standard).toContain(value);
  }
  expect(standard).toContain('design-handoff-template.md');
  expect(standard).toContain('design-package-reconciliation.md');
  expect(template).toContain('可编辑 Figma');
  expect(template).toContain('稳定语义 ID');
  expect(read('docs/design-package-reconciliation.md')).toContain('不满足 v1.0 可编辑 Figma');
});
