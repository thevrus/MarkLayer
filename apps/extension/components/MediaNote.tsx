import { cn } from '@marklayer/ui/cn';
import { Square, X } from 'lucide-preact';
import type { ComponentChildren } from 'preact';
import { geist } from '../lib/geist';
import type { Recorder } from '../lib/recorder';
import { Tooltip } from './Tooltip';

export const clock = (seconds: number): string =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

/** What a recording control turns into while it records: stop, with the running clock. */
export function RecorderStop({ recorder }: { recorder: Pick<Recorder, 'elapsed' | 'stop'> }) {
  return (
    <button
      type="button"
      onClick={recorder.stop}
      aria-label="Stop recording"
      class={cn(geist.ctlXs, geist.ctlOn, 'w-auto gap-1 px-1.5 text-meta tabular-nums')}
    >
      <Square size={10} fill="currentColor" aria-hidden="true" />
      {clock(recorder.elapsed.value)}
      <Tooltip text="Stop recording" />
    </button>
  );
}

/** A recorded note as it sits in the composer, with a way to throw it away and record again. */
export function MediaDraft({
  label,
  onClear,
  children,
}: {
  label: string;
  onClear: () => void;
  children: ComponentChildren;
}) {
  return (
    <div class="flex items-start gap-1.5">
      <div class="min-w-0 flex-1">{children}</div>
      <button
        type="button"
        onClick={onClear}
        aria-label={label}
        class={cn(geist.ctlXs, geist.ctlIdle, 'mt-1.5 shrink-0')}
      >
        <X size={12} strokeWidth={2} aria-hidden="true" />
        <Tooltip text={label} />
      </button>
    </div>
  );
}
