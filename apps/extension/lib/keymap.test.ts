import { afterEach, describe, expect, test } from 'bun:test';
import { dismissTop, pushDismisser } from './keymap';

describe('Escape dismiss stack', () => {
  afterEach(() => {
    while (dismissTop());
  });

  test('one Escape closes only the newest surface', () => {
    const closed: string[] = [];
    pushDismisser(() => closed.push('board'));
    pushDismisser(() => closed.push('dialog'));

    expect(dismissTop()).toBe(true);
    expect(closed).toEqual(['dialog']);
    expect(dismissTop()).toBe(true);
    expect(closed).toEqual(['dialog', 'board']);
  });

  test('an empty stack says so, so the host takes its next step', () => {
    expect(dismissTop()).toBe(false);
  });

  test('a surface that closed itself leaves no stale entry for Escape to spend', () => {
    const closed: string[] = [];
    pushDismisser(() => closed.push('board'));
    const remove = pushDismisser(() => closed.push('dialog'));
    remove();

    dismissTop();
    expect(closed).toEqual(['board']);
  });

  test('the effect cleanup after a pop cannot remove the surface beneath it', () => {
    const closed: string[] = [];
    const close = () => closed.push('dialog');
    pushDismisser(() => closed.push('board'));
    const remove = pushDismisser(close);

    dismissTop();
    remove();
    dismissTop();
    expect(closed).toEqual(['dialog', 'board']);
  });
});
