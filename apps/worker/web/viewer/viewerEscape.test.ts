import { afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { dismissTop, pushDismisser } from '@ext/lib/keymap';
import { activeTool } from '@ext/lib/tool-state';
import { viewerEscape } from './viewerEscape';

beforeAll(() => {
  Object.defineProperty(globalThis, 'Element', { value: class {}, configurable: true, writable: true });
});

const pressEscape = () => viewerEscape(new Event('keydown'));
const tool = () => activeTool.value;

describe('B12: Escape spends itself on one level', () => {
  afterEach(() => {
    while (dismissTop());
    activeTool.value = 'navigate';
  });

  test('closing a surface leaves the tool alone', () => {
    const closed: string[] = [];
    activeTool.value = 'pen';
    pushDismisser(() => closed.push('board'));

    pressEscape();
    expect(closed).toEqual(['board']);
    expect(tool()).toBe('pen');

    pressEscape();
    expect(tool()).toBe('navigate');
  });
});
