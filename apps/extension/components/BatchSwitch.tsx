import { cn } from '@marklayer/types';
import { track } from '../lib/analytics';
import { batchAvailable, batchMode, toggleBatchMode } from '../lib/batch';
import { Toggle } from './Toggle';
import { Tooltip } from './Tooltip';

/** The "Batch" toggle in every note card. Hidden where Send does not exist (the web viewer). */
export function BatchSwitch({ class: className }: { class?: string }) {
  if (!batchAvailable.value) return null;
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: Base UI renders the switch as a button inside the label.
    <label
      class={cn('inline-flex items-center gap-1.5 h-7 px-1 text-meta text-(--ds-gray-900) select-none', className)}
    >
      <Toggle
        size="sm"
        checked={batchMode.value}
        onChange={(on) => {
          toggleBatchMode();
          track('batch_mode_toggled', { on });
        }}
      />
      Batch
      <Tooltip text="Hold notes here until you Send them together" wrap />
    </label>
  );
}
