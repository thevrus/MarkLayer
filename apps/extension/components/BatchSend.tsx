import { Popover } from '@base-ui/react/popover';
import { type AnnotationOp, cn, opAnchor } from '@marklayer/types';
import { track } from '../lib/analytics';
import { applyAnchorDelta } from '../lib/anchor';
import { clearArmed, editHeld, heldNote, heldOps, pressClear, removeHeld } from '../lib/batch';
import { geist } from '../lib/geist';
import { glass } from '../lib/glass';
import { Icon } from '../lib/icons';
import { MARKER_LAYER } from '../lib/popover';
import { portalContainer } from '../lib/portal';
import { hostMutationTick, scrollTick, sendHeld } from '../lib/state';

const KIND: Record<AnnotationOp['tool'], string> = {
  comment: 'Comment',
  area: 'Area',
  selection: 'Text',
  inspect: 'Element',
};

/** Where a held note's pin sits, in document coordinates. */
function heldPoint(op: AnnotationOp): { x: number; y: number } {
  return op.tool === 'comment' ? applyAnchorDelta(op.target, { docX: op.x, docY: op.y }) : opAnchor(op);
}

/** Held notes as numbered pins: outlined and tonal, so they read as not yet sent beside the filled live ones. */
export function HeldPins() {
  const ops = heldOps.value;
  if (!ops.length) return null;
  scrollTick.value;
  hostMutationTick.value;
  return (
    <div class={cn(MARKER_LAYER, 'pointer-events-none')}>
      {ops.map((op, i) => {
        const { x, y } = heldPoint(op);
        return (
          <div
            key={op.id}
            data-marker
            class={cn(
              'absolute -translate-x-1/2 -translate-y-1/2 w-7 h-7 rounded-full grid place-items-center',
              'bg-(--ds-background-100) text-(--ds-gray-1000) text-meta font-semibold tabular-nums leading-none',
              'border-2 border-dashed border-(--ds-gray-900)',
              glass.font,
            )}
            style={{ left: x - scrollX, top: y - scrollY }}
            title={heldNote(op) || KIND[op.tool]}
          >
            {i + 1}
          </div>
        );
      })}
    </div>
  );
}

/** "Send N" beside the toolbar while notes are held, with the pending list behind its caret. */
export function BatchSend() {
  const ops = heldOps.value;
  if (!ops.length) return null;
  return (
    <div class={cn(geist.surface, glass.font, 'pointer-events-auto flex items-center gap-1 p-1')}>
      <button
        type="button"
        onClick={() => {
          track('batch_sent', { count: ops.length });
          sendHeld();
        }}
        class={cn(geist.ctl, geist.ctlOn, 'w-auto px-3 gap-1.5 text-ui font-medium tabular-nums')}
      >
        Send {ops.length}
      </button>
      <Popover.Root>
        <Popover.Trigger aria-label="Pending notes" class={cn(geist.ctl, geist.ctlIdle)}>
          <Icon name="chevUp" size={16} strokeWidth={1.5} />
        </Popover.Trigger>
        <Popover.Portal container={portalContainer.value ?? undefined}>
          <Popover.Positioner side="top" sideOffset={8} class="pointer-events-auto z-2147483647">
            <Popover.Popup
              class={cn(geist.surface, glass.font, 'pointer-events-auto w-80 p-2 text-ui text-(--ds-gray-1000)')}
            >
              <ol class="m-0 p-0 list-none flex flex-col gap-1 max-h-72 overflow-auto">
                {ops.map((op, i) => (
                  <li key={op.id} class="grid grid-cols-[1.5rem_4rem_1fr_1.75rem] items-center gap-2 pl-2">
                    <span class="text-meta font-semibold tabular-nums text-(--ds-gray-1000)">{i + 1}</span>
                    <span class="text-meta text-(--ds-gray-900)">{KIND[op.tool]}</span>
                    <input
                      value={heldNote(op).split('\n')[0]}
                      placeholder="No note"
                      aria-label={`Note ${i + 1}`}
                      onInput={(e) => editHeld({ id: op.id, note: e.currentTarget.value })}
                      class="min-w-0 h-7 px-1.5 rounded-md bg-transparent text-ui text-(--ds-gray-1000) placeholder:text-(--ds-gray-700) hover:bg-(--ds-gray-alpha-100) focus:bg-(--ds-gray-alpha-100) outline-none"
                    />
                    <button
                      type="button"
                      aria-label={`Remove note ${i + 1}`}
                      onClick={() => {
                        removeHeld(op.id);
                        track('batch_note_removed');
                      }}
                      class={cn(geist.ctlSm, geist.ctlIdle)}
                    >
                      <Icon name="close" size={14} strokeWidth={1.5} />
                    </button>
                  </li>
                ))}
              </ol>
              <div class="mt-2 pt-2 px-2 flex items-center justify-between border-t border-(--ds-gray-alpha-200)">
                <span class="text-meta text-(--ds-gray-900)">Held here until Send</span>
                <button
                  type="button"
                  onClick={() => {
                    if (clearArmed.value) track('batch_cleared', { count: ops.length });
                    pressClear();
                  }}
                  class={cn(geist.ctlSm, geist.ctlIdle, 'w-auto px-2 text-ui font-medium')}
                >
                  {clearArmed.value ? `Clear ${ops.length} note${ops.length === 1 ? '' : 's'}?` : 'Clear All'}
                </button>
              </div>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
