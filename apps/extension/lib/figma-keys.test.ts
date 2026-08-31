import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

/* Same reason as state.test.ts: no IndexedDB in the test DOM, and every op
   mutation these keys reach schedules a draft save. */
mock.module('idb-keyval', () => ({
  createStore: () => ({}),
  get: async () => undefined,
  set: async () => {},
  del: async () => {},
}));

const { activeTool, altHeld, bindFigmaKeys, handTool, operations, spaceHeld, toolbarMinimized, uiHidden } =
  await import('./state');

/**
 * tinykeys resolves modifiers through `getModifierState`, not through the
 * `metaKey`/`ctrlKey` flags, and happy-dom's KeyboardEvent does not implement it
 * — so the dispatched event has to answer that call itself. `$mod` is whichever
 * of Meta/Control tinykeys picked for this platform.
 */
const MOD = /Mac|iPod|iPhone|iPad/.test(navigator.platform) ? 'Meta' : 'Control';

const press = (
  code: string,
  {
    type = 'keydown',
    repeat = false,
    mod = false,
    shift = false,
  }: Partial<{ type: 'keydown' | 'keyup'; repeat: boolean; mod: boolean; shift: boolean }> = {},
) => {
  const held = new Set<string>();
  if (mod) held.add(MOD);
  if (shift) held.add('Shift');
  if (code === 'Alt') held.add('Alt');

  const event = new KeyboardEvent(type, {
    code,
    key: code.startsWith('Key') ? code.slice(3).toLowerCase() : code,
    repeat,
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(event, 'getModifierState', {
    value: (name: string) => held.has(name),
    configurable: true,
  });
  window.dispatchEvent(event);
  return event;
};

const allow: Parameters<typeof bindFigmaKeys>[0]['guard'] = (fn) => fn;
const block: Parameters<typeof bindFigmaKeys>[0]['guard'] = () => () => {};

let unbind: (() => void) | null = null;

const bind = (opts: Partial<Parameters<typeof bindFigmaKeys>[0]> = {}) => {
  unbind?.();
  unbind = bindFigmaKeys({ target: window, guard: allow, ...opts });
};

beforeEach(() => {
  operations.value = [];
  activeTool.value = 'navigate';
  spaceHeld.value = false;
  altHeld.value = false;
  handTool.value = false;
  uiHidden.value = false;
  if (toolbarMinimized.value) toolbarMinimized.value = false;
});

afterEach(() => {
  unbind?.();
  unbind = null;
  spaceHeld.value = false;
  altHeld.value = false;
});

describe('tool letters', () => {
  test('arm the tool they are bound to', () => {
    bind();
    press('KeyR');
    expect(activeTool.value).toBe('rectangle');
    press('KeyC');
    expect(activeTool.value).toBe('comment');
  });

  test('distinguish a shifted binding', () => {
    bind();
    press('KeyH', { shift: true });
    expect(activeTool.value).toBe('highlight');
    // Bare H is the hand tool, not the highlighter.
    expect(handTool.value).toBe(false);
  });

  test('prevent the host page default, so the letter is not typed through', () => {
    bind();
    expect(press('KeyR').defaultPrevented).toBe(true);
  });
});

describe('the hand tool', () => {
  test('toggles on H', () => {
    bind();
    press('KeyH');
    expect(handTool.value).toBe(true);
    press('KeyH');
    expect(handTool.value).toBe(false);
  });
});

describe('held Space', () => {
  test('is set on press and cleared on release', () => {
    bind();
    press('Space');
    expect(spaceHeld.value).toBe(true);
    press('Space', { type: 'keyup' });
    expect(spaceHeld.value).toBe(false);
  });

  test('stays held across the OS auto-repeats, and releases exactly once', () => {
    bind();
    press('Space');
    press('Space', { repeat: true });
    press('Space', { repeat: true });
    expect(spaceHeld.value).toBe(true);

    press('Space', { type: 'keyup' });
    expect(spaceHeld.value).toBe(false);
  });

  test('a press the guard rejected never becomes held', () => {
    // Space typed into a text field must keep its default and not start a pan.
    bind({ viewGuard: block });
    press('Space');
    expect(spaceHeld.value).toBe(false);
    expect(press('Space').defaultPrevented).toBe(false);
  });
});

describe('held Alt', () => {
  test('is set on press and cleared on release', () => {
    bind();
    press('Alt');
    expect(altHeld.value).toBe(true);
    press('Alt', { type: 'keyup' });
    expect(altHeld.value).toBe(false);
  });

  test('stays held across auto-repeats', () => {
    bind();
    press('Alt');
    press('Alt', { repeat: true });
    expect(altHeld.value).toBe(true);
  });

  test('does not preventDefault, so Alt keeps its native behaviour', () => {
    bind();
    expect(press('Alt').defaultPrevented).toBe(false);
  });
});

describe('losing focus', () => {
  test('releases both held modifiers, so neither can stick', () => {
    // A window that blurs mid-pan would otherwise come back still panning.
    bind();
    press('Space');
    press('Alt');
    window.dispatchEvent(new Event('blur'));
    expect(spaceHeld.value).toBe(false);
    expect(altHeld.value).toBe(false);
  });
});

describe('guards', () => {
  test('a read-only host drops the editing keys', () => {
    bind({ guard: block });
    press('KeyR');
    expect(activeTool.value).toBe('navigate');
    expect(press('KeyR').defaultPrevented).toBe(false);
  });

  test('but keeps navigation live, which is what viewGuard is for', () => {
    bind({ guard: block, viewGuard: allow });
    press('Space');
    expect(spaceHeld.value).toBe(true);
    press('KeyH');
    expect(handTool.value).toBe(true);
  });

  test('viewGuard defaults to guard when the host does not split them', () => {
    bind({ guard: block });
    press('Space');
    expect(spaceHeld.value).toBe(false);
  });
});

describe('command chords', () => {
  test('hide the interface on the slash chord', () => {
    bind();
    press('Slash', { mod: true });
    expect(uiHidden.value).toBe(true);
  });

  test('minimize the toolbar on the backslash chord', () => {
    bind();
    const before = toolbarMinimized.value;
    press('Backslash', { mod: true });
    expect(toolbarMinimized.value).toBe(!before);
  });

  test('duplicate the last op on the D chord', () => {
    bind();
    operations.value = [{ id: 't1', color: '#000', lineWidth: 2, tool: 'text', text: 'x', x: 0, y: 0, fontSize: 14 }];
    press('KeyD', { mod: true });
    expect(operations.value).toHaveLength(2);
    expect(operations.value[1]).toMatchObject({ x: 12, y: 12 });
  });

  test('do not fire without the modifier', () => {
    bind();
    press('Slash');
    expect(uiHidden.value).toBe(false);
  });
});

describe('unbind', () => {
  test('removes the keydown, keyup and blur listeners together', () => {
    bind();
    unbind?.();
    unbind = null;

    press('KeyR');
    expect(activeTool.value).toBe('navigate');

    spaceHeld.value = true;
    press('Space', { type: 'keyup' });
    expect(spaceHeld.value).toBe(true);

    window.dispatchEvent(new Event('blur'));
    expect(spaceHeld.value).toBe(true);
    spaceHeld.value = false;
  });
});
