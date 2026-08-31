import { describe, expect, test } from 'bun:test';
import { injectCrosshairCursor } from './dom';

describe('injectCrosshairCursor', () => {
  test('adds a style rule that outranks the page own cursor rules', () => {
    // Page CSS on links, buttons and inputs is more specific than anything we
    // could write, so `!important` is the only thing that wins.
    const cleanup = injectCrosshairCursor(document);
    const style = document.head.querySelector('style');
    expect(style?.textContent).toContain('cursor: crosshair !important');
    cleanup?.();
  });

  test('removes only its own style on cleanup', () => {
    const existing = document.createElement('style');
    existing.textContent = 'body{color:red}';
    document.head.appendChild(existing);

    const cleanup = injectCrosshairCursor(document);
    expect(document.head.querySelectorAll('style')).toHaveLength(2);
    cleanup?.();
    expect(document.head.querySelectorAll('style')).toHaveLength(1);
    existing.remove();
  });

  test('returns undefined for a document that cannot take a style', () => {
    // An iframe whose contentDocument is not there yet. The caller returns this
    // straight out of an effect, so it has to be a valid cleanup value.
    expect(injectCrosshairCursor(null)).toBeUndefined();
    expect(injectCrosshairCursor(undefined)).toBeUndefined();
  });
});
