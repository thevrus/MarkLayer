import { describe, expect, test } from 'bun:test';
import { cn } from './cn';

describe('cn', () => {
  // tailwind-merge resolves an unknown `text-*` to the colour group, so before the
  // type scale was declared to it every one of these dropped its size and the
  // element fell back to the inherited 16px — silently, in both apps' chrome.
  test('keeps a type-scale size beside a text colour', () => {
    expect(cn('text-meta font-medium', 'text-inherit')).toBe('text-meta font-medium text-inherit');
    expect(cn('text-ui text-(--ds-gray-900)')).toBe('text-ui text-(--ds-gray-900)');
    expect(cn('text-mini', 'text-red-500')).toBe('text-mini text-red-500');
  });

  test('still merges two sizes, and two colours', () => {
    expect(cn('text-meta', 'text-ui')).toBe('text-ui');
    expect(cn('text-red-500', 'text-(--ds-gray-900)')).toBe('text-(--ds-gray-900)');
  });
});
