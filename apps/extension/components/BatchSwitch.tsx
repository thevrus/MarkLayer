import { Switch } from '@base-ui/react/switch';
import { cn } from '@marklayer/types';
import { track } from '../lib/analytics';
import { batchAvailable, batchMode, toggleBatchMode } from '../lib/batch';
import { Tooltip } from './Tooltip';

/** The "Batch" toggle in every note card. Hidden where Send does not exist (the web viewer). */
export function BatchSwitch({ class: className }: { class?: string }) {
  if (!batchAvailable.value) return null;
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: Base UI renders the switch as a button inside the label.
    <label
      class={cn('inline-flex items-center gap-1.5 h-7 px-1 text-meta text-(--ds-gray-900) select-none', className)}
    >
      <Switch.Root
        checked={batchMode.value}
        onCheckedChange={(on: boolean) => {
          toggleBatchMode();
          track('batch_mode_toggled', { on });
        }}
        class={cn(
          'relative inline-flex h-4 w-7 shrink-0 rounded-full p-0.5 transition-colors duration-150',
          'bg-(--ds-gray-alpha-400) data-checked:bg-(--ds-gray-1000)',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ds-gray-1000)',
        )}
      >
        <Switch.Thumb class="block h-3 w-3 rounded-full bg-(--ds-background-100) transition-transform duration-150 data-checked:translate-x-3" />
      </Switch.Root>
      Batch
      <Tooltip text="Hold notes here until you Send them together" wrap />
    </label>
  );
}
