import { Menu } from '@base-ui/react/menu';
import { Toggle } from '@base-ui/react/toggle';
import { ToggleGroup } from '@base-ui/react/toggle-group';
import { geist } from '@ext/lib/geist';
import { cn } from '@marklayer/types';
import { useComputed } from '@preact/signals';
import { Check, ChevronDown, ChevronRight, Headphones, Mic, Video } from 'lucide-preact';
import type { ComponentChildren } from 'preact';
import {
  availableDevices,
  refreshDevices,
  selectedAudioInput,
  selectedAudioOutput,
  selectedVideoInput,
  supportsSinkId,
  watchDevices,
} from './devicePrefs';
import { persistQuality, type QualityPreset, videoQuality } from './voiceSignals';

const QUALITY_OPTIONS: { value: QualityPreset; label: string; short: string }[] = [
  { value: 'low', label: '160p', short: 'Small' },
  { value: 'medium', label: '240p', short: 'Medium' },
  { value: 'hd', label: '480p', short: 'HD' },
];

/** Sentinel RadioGroup value standing in for "system default" (`null` in the signals). */
const DEFAULT_DEVICE = 'default';
const DEFAULT_LABEL = 'System default';

interface Props {
  /** Whether the user has already granted media permission (controls hint copy). */
  hasPermission: boolean;
}

export function DeviceMenu({ hasPermission }: Props) {
  const grouped = useComputed(() => {
    const mics: typeof availableDevices.value = [];
    const cams: typeof availableDevices.value = [];
    const speakers: typeof availableDevices.value = [];
    for (const d of availableDevices.value) {
      if (d.kind === 'audioinput') mics.push(d);
      else if (d.kind === 'videoinput') cams.push(d);
      else if (d.kind === 'audiooutput') speakers.push(d);
    }
    return { mics, cams, speakers };
  });
  const { mics, cams, speakers } = grouped.value;

  return (
    <Menu.Root
      onOpenChange={(nextOpen: boolean) => {
        if (nextOpen) {
          watchDevices();
          refreshDevices();
        }
      }}
    >
      <Menu.Trigger aria-label="Audio and video settings" className={cn(geist.ctl, geist.ctlIdle, 'w-5')}>
        <ChevronDown size={12} strokeWidth={1.5} aria-hidden="true" />
      </Menu.Trigger>

      <Menu.Portal>
        <Menu.Positioner side="bottom" align="end" sideOffset={6} className="z-2147483647">
          <Menu.Popup className={cn(geist.surface, 'w-64 p-1 text-(--ds-gray-1000) text-ui')}>
            {!hasPermission && (
              <div class="mx-1 mb-1 px-2.5 py-2 rounded-md bg-(--ds-gray-alpha-100) text-meta text-(--ds-gray-900) leading-snug">
                Grant microphone access to see device names.
              </div>
            )}

            <DeviceSection
              title="Microphone"
              icon={<Mic size={14} strokeWidth={1.5} />}
              options={mics}
              selectedId={selectedAudioInput.value}
              onSelect={(id) => {
                selectedAudioInput.value = id;
              }}
            />

            <DeviceSection
              title="Camera"
              icon={<Video size={14} strokeWidth={1.5} />}
              options={cams}
              selectedId={selectedVideoInput.value}
              onSelect={(id) => {
                selectedVideoInput.value = id;
              }}
            />

            {supportsSinkId() && (
              <DeviceSection
                title="Speaker"
                icon={<Headphones size={14} strokeWidth={1.5} />}
                options={speakers}
                selectedId={selectedAudioOutput.value}
                onSelect={(id) => {
                  selectedAudioOutput.value = id;
                }}
              />
            )}

            <div class="mx-2 my-1 h-px bg-(--ds-gray-alpha-400)" />

            <div class={cn(geist.sectionLabel, 'px-2.5 pt-1.5 pb-1')}>Video quality</div>
            <div class="p-1 pt-0.5">
              <ToggleGroup
                value={[videoQuality.value]}
                onValueChange={(next: QualityPreset[]) => {
                  // One quality is always in force, so an empty selection holds it.
                  if (next[0]) persistQuality(next[0]);
                }}
                aria-label="Video quality"
                className={cn(geist.track, 'flex w-full')}
              >
                {QUALITY_OPTIONS.map((q) => (
                  <Toggle key={q.value} value={q.value} className={cn(geist.segmentText, 'flex-1 text-meta')}>
                    {q.short}
                  </Toggle>
                ))}
              </ToggleGroup>
            </div>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

interface SectionProps {
  title: string;
  icon: ComponentChildren;
  options: { deviceId: string; label: string }[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

/**
 * One row per device kind, with the choices in a submenu. Flat, the three lists
 * ran to a dozen-plus rows on a laptop with a phone paired — taller than most
 * viewports and unreadable at a glance.
 */
function DeviceSection({ title, icon, options, selectedId, onSelect }: SectionProps) {
  const current = (selectedId && options.find((d) => d.deviceId === selectedId)?.label) || DEFAULT_LABEL;

  return (
    <Menu.SubmenuRoot>
      <Menu.SubmenuTrigger
        className="flex items-center gap-2 w-full px-2.5 py-2 rounded-md text-ui cursor-pointer border-none transition-colors
                   bg-transparent text-(--ds-gray-1000) hover:bg-(--ds-gray-alpha-100) data-popup-open:bg-(--ds-gray-alpha-100)"
      >
        <span class="shrink-0 inline-flex text-(--ds-gray-900)">{icon}</span>
        <span class="shrink-0 leading-tight">{title}</span>
        <span class="ml-auto min-w-0 truncate text-right text-meta text-(--ds-gray-900)">{current}</span>
        <ChevronRight size={13} strokeWidth={1.5} class="shrink-0 text-(--ds-gray-900)" aria-hidden="true" />
      </Menu.SubmenuTrigger>

      <Menu.Portal>
        <Menu.Positioner side="left" align="start" sideOffset={4} className="z-2147483647">
          <Menu.Popup className={cn(geist.surface, 'min-w-56 max-w-80 p-1 text-(--ds-gray-1000) text-ui')}>
            <Menu.RadioGroup
              className="flex flex-col gap-px"
              value={selectedId ?? DEFAULT_DEVICE}
              onValueChange={(value: string) => onSelect(value === DEFAULT_DEVICE ? null : value)}
            >
              <DeviceRow label={DEFAULT_LABEL} value={DEFAULT_DEVICE} />
              {options.map((d) => (
                <DeviceRow key={d.deviceId} label={d.label} value={d.deviceId} />
              ))}
            </Menu.RadioGroup>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.SubmenuRoot>
  );
}

// Selection is Base UI's to track — the row styles off `data-checked` rather
// than re-deriving it from the group's value.
function DeviceRow({ label, value }: { label: string; value: string }) {
  return (
    <Menu.RadioItem
      value={value}
      className="flex items-center justify-between gap-2 px-2.5 py-2 rounded-md text-ui cursor-pointer border-none transition-colors
                 bg-transparent text-(--ds-gray-1000) hover:text-(--ds-gray-1000) hover:bg-(--ds-gray-alpha-100)
                 data-checked:bg-(--ds-gray-alpha-100) data-checked:text-(--ds-gray-1000) data-checked:font-medium"
    >
      <span class="truncate text-left leading-tight">{label}</span>
      <Menu.RadioItemIndicator className="shrink-0 inline-flex text-(--ds-gray-900)">
        <Check size={14} strokeWidth={1.5} aria-hidden="true" />
      </Menu.RadioItemIndicator>
    </Menu.RadioItem>
  );
}
