import { type ReadonlySignal, useSignalEffect } from '@preact/signals';
import { tinykeys } from 'tinykeys';
import { duplicateLastOp } from './ops';
import { toggleToolbarMinimized } from './prefs';
import { altHeld, handTool, selectTool, spaceHeld } from './tool-state';
import { TOOL_SHORTCUTS } from './tools';
import { toggleUiHidden } from './ui-state';

export interface KeyBinding {
  /** tinykeys pattern. */
  keys: string;
  on: (e: KeyboardEvent) => void;
  event?: 'keydown' | 'keyup';
}

/** Binds a declarative list to `scope` and returns the unbind. The list is the one place a host's keys are read from. */
export function bindKeymap({ scope, bindings }: { scope: Window; bindings: KeyBinding[] }): () => void {
  const table = (event: KeyBinding['event']) =>
    Object.fromEntries(bindings.filter((b) => (b.event ?? 'keydown') === event).map((b) => [b.keys, b.on]));
  const unbindDown = tinykeys(scope, table('keydown'));
  const unbindUp = tinykeys(scope, table('keyup'), { event: 'keyup' });
  return () => {
    unbindDown();
    unbindUp();
  };
}

/** Undo and redo: the keys, and what the toolbar prints beside them. `$mod+KeyY` stays unlabelled on purpose. */
export const HISTORY_KEYS = {
  undo: { keys: ['$mod+KeyZ'], label: '⌘Z' },
  redo: { keys: ['$mod+Shift+KeyZ', '$mod+KeyY'], label: '⌘⇧Z' },
};

const dismissers: (() => void)[] = [];

/** Puts a surface on the Escape stack and returns its removal, which is safe after it was popped. */
export function pushDismisser(close: () => void): () => void {
  dismissers.push(close);
  return () => {
    const at = dismissers.lastIndexOf(close);
    if (at >= 0) dismissers.splice(at, 1);
  };
}

/** Closes the most recently opened surface and nothing else. False when none is open, so the host's next step runs. */
export function dismissTop(): boolean {
  const close = dismissers.pop();
  close?.();
  return Boolean(close);
}

/** A surface that Escape can close, on the stack for as long as `open` is true. */
export function useDismissible({ open, close }: { open: ReadonlySignal<boolean>; close: () => void }) {
  useSignalEffect(() => {
    if (open.value) return pushDismisser(close);
  });
}

/** Wraps a handler so a host can decide when the key belongs to it at all. */
type KeyGuard = (fn: (e: KeyboardEvent) => void) => (e: KeyboardEvent) => void;

/**
 * The Figma-parity half of a host's keymap: the tool letters, ⌘D, ⌘\, ⌘/, and the
 * held Space/Alt modifiers with their release. Both hosts bound this identically
 * and differed only in which guard wrapped each key, so the guards are the
 * parameters and the table lives here — press and release included, since a
 * keydown bound without its keyup leaves the pan overlay stuck on.
 *
 * The blur listener is the other half of that: a blur (⌘Tab, devtools) eats the
 * keyup outright.
 */
export function bindFigmaKeys({
  target,
  guard,
  viewGuard = guard,
}: {
  target: Window;
  /** Wraps the editing keys — a read-only host drops them. */
  guard: KeyGuard;
  /** Wraps zoom/pan/measure navigation, which stays live read-only. Defaults to `guard`. */
  viewGuard?: KeyGuard;
}): () => void {
  const pd = (wrap: KeyGuard, fn: () => void) =>
    wrap((e) => {
      e.preventDefault();
      fn();
    });

  // Space and Alt both auto-repeat while held, and the handlers are built once
  // here rather than per keypress so a repeat costs nothing to dispatch.
  const pressSpace = pd(viewGuard, () => {
    spaceHeld.value = true;
  });
  const pressAlt = viewGuard(() => {
    altHeld.value = true;
  });

  const bindings: KeyBinding[] = [
    { keys: '$mod+KeyD', on: pd(guard, duplicateLastOp) },
    // Figma's ⌘\ — shrink the toolbar to its compact form.
    { keys: '$mod+Backslash', on: pd(viewGuard, toggleToolbarMinimized) },
    // Figma's hide-UI: all chrome off, the annotations stay on screen.
    { keys: '$mod+Slash', on: pd(viewGuard, toggleUiHidden) },
    {
      keys: 'KeyH',
      on: pd(viewGuard, () => {
        handTool.value = !handTool.value;
      }),
    },
    // preventDefault stops the host page from page-scrolling under the pan. Once
    // the first press has been accepted the OS repeats carry nothing new, so they
    // skip the guard rather than walking the composed path ~30 times a second.
    // Gated on the held signal so a press the guard rejected — Space typed into a
    // text field — still falls through to it and keeps its default.
    {
      keys: 'Space',
      on: (e) => {
        if (e.repeat && spaceHeld.peek()) {
          e.preventDefault();
          return;
        }
        pressSpace(e);
      },
    },
    {
      keys: 'Alt',
      on: (e) => {
        if (e.repeat && altHeld.peek()) return;
        pressAlt(e);
      },
    },
    {
      keys: 'Space',
      event: 'keyup',
      on: () => {
        spaceHeld.value = false;
      },
    },
    {
      keys: 'Alt',
      event: 'keyup',
      on: () => {
        altHeld.value = false;
      },
    },
    ...TOOL_SHORTCUTS.map(({ tool, pattern }) => ({
      keys: pattern,
      on: pd(guard, () => selectTool({ tool, via: 'shortcut' })),
    })),
  ];

  const release = () => {
    spaceHeld.value = false;
    altHeld.value = false;
  };
  const unbind = bindKeymap({ scope: target, bindings });
  target.addEventListener('blur', release);
  return () => {
    unbind();
    target.removeEventListener('blur', release);
  };
}
