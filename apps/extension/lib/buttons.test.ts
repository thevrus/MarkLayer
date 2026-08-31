import { describe, expect, test } from 'bun:test';
import { secondaryBtn, submitBtn, textareaCls, trim } from './buttons';

describe('trim', () => {
  test('collapses a multi-line class recipe onto one line', () => {
    expect(trim('\n  flex items-center\n  gap-2\n')).toBe('flex items-center gap-2');
  });

  test('leaves a single-line recipe alone', () => {
    expect(trim('flex items-center')).toBe('flex items-center');
  });

  test('never leaves a double space, which would read as an empty class', () => {
    for (const recipe of [submitBtn, secondaryBtn, textareaCls]) {
      expect(recipe).not.toContain('  ');
      expect(recipe).not.toContain('\n');
      expect(recipe.trim()).toBe(recipe);
    }
  });
});
