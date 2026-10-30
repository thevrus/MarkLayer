import { expect, test } from 'bun:test';
import { stepHover } from './hover-walk';

function build() {
  document.body.innerHTML = '<main id="mid"><span id="leaf"></span></main>';
  const mid = document.getElementById('mid');
  const leaf = document.getElementById('leaf');
  if (!mid || !leaf) throw new Error('fixture');
  return { mid, leaf };
}

test('ArrowDown retraces the climbed path, then falls back to the first child', () => {
  const { mid, leaf } = build();
  const up = stepHover({ el: leaf, stack: [], dir: 'up' });
  expect(up?.el).toBe(mid);
  expect(stepHover({ el: mid, stack: up?.stack ?? [], dir: 'down' })?.el).toBe(leaf);
  expect(stepHover({ el: mid, stack: [], dir: 'down' })?.el).toBe(leaf);
  expect(stepHover({ el: leaf, stack: [], dir: 'down' })).toBeNull();
});

test('ArrowUp stops at the document element', () => {
  expect(stepHover({ el: document.documentElement, stack: [], dir: 'up' })).toBeNull();
});
