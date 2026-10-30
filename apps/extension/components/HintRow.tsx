import { cn, isAnnotationOp } from '@marklayer/types';
import { signal, useSignalEffect } from '@preact/signals';
import { batchAvailable, batchMode } from '../lib/batch';
import { geist } from '../lib/geist';
import { glass } from '../lib/glass';
import { Icon } from '../lib/icons';
import { activeTool, lsGet, lsSet, operations, uiHidden, visible } from '../lib/state';
import type { Tool } from '../lib/types';
import { Tooltip } from './Tooltip';

type Hint = { keys: string[]; verb: string };

const EXIT: Hint = { keys: ['Esc'], verb: 'exit' };

const HINTS: Partial<Record<Tool, Hint[]>> = {
  inspect: [
    { keys: ['Click'], verb: 'pick' },
    { keys: ['Shift', 'Click'], verb: 'add' },
    { keys: ['↑', '↓'], verb: 'parent / child' },
    { keys: ['Double-click'], verb: 'edit text' },
    EXIT,
  ],
  area: [
    { keys: ['Drag'], verb: 'mark an area' },
    { keys: ['Shift'], verb: 'square' },
    { keys: ['Alt'], verb: 'from center' },
    EXIT,
  ],
  comment: [{ keys: ['Click'], verb: 'to pin' }, EXIT],
  selection: [{ keys: ['Select'], verb: 'text' }, { keys: ['Double-click'], verb: 'edit text' }, EXIT],
};

const QUIET_KEY = 'ml-hints-quiet';
const QUIET_AFTER = 5;

// Read once: after the fifth annotation the verbs stay off for good, across reloads.
const quiet = signal(lsGet(QUIET_KEY) === '1');

const KEYCAP = cn(
  'inline-flex items-center justify-center h-5 min-w-5 px-1.5 rounded-sm',
  'text-mini leading-none font-medium text-(--ds-gray-1000)',
  'bg-(--ds-gray-alpha-200) [box-shadow:inset_0_0_0_1px_var(--ds-gray-alpha-400)]',
);

/** The gesture cheat-sheet for the armed tool, with a way out. Nothing shows for move or the drawing tools. */
export function HintRow() {
  useSignalEffect(() => {
    if (quiet.value) return;
    if (operations.value.filter(isAnnotationOp).length < QUIET_AFTER) return;
    quiet.value = true;
    lsSet(QUIET_KEY, '1');
  });

  const hints = HINTS[activeTool.value];
  if (!hints || !visible.value || uiHidden.value) return null;
  const verbs = !quiet.value;

  return (
    <div class="fixed inset-x-0 top-3 z-2147483647 flex justify-center px-3 pointer-events-none">
      <div
        role="note"
        class={cn(
          geist.surface,
          glass.font,
          'pointer-events-auto select-none flex items-center gap-3 h-9 max-w-full pl-3 pr-1',
          'text-meta text-(--ds-gray-900) whitespace-nowrap',
        )}
      >
        <div class="flex min-w-0 items-center gap-3 overflow-x-auto [scrollbar-width:none]">
          {hints.map((h) => (
            <span key={h.keys.join('')} class="inline-flex items-center gap-1.5">
              <span class="inline-flex items-center gap-1">
                {h.keys.map((k) => (
                  <kbd key={k} class={KEYCAP}>
                    {k}
                  </kbd>
                ))}
              </span>
              {verbs && <span class="hidden sm:inline">{h.verb}</span>}
            </span>
          ))}
          {batchAvailable.value && batchMode.value && (
            <span class="text-(--ds-gray-1000)">Notes are held until Send</span>
          )}
        </div>
        <button
          type="button"
          aria-label="Exit tool"
          onClick={() => {
            activeTool.value = 'navigate';
          }}
          class={cn(geist.ctlSm, geist.ctlIdle, 'shrink-0')}
        >
          <Icon name="close" size={14} strokeWidth={1.5} />
          <Tooltip text="Exit" shortcut="Esc" placement="bottom" />
        </button>
      </div>
    </div>
  );
}
