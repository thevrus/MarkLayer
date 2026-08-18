import { Menu } from '@base-ui/react/menu';
import { useComputed } from '@preact/signals';
import { Check, ChevronDown, Headphones, Mic, Video } from 'lucide-preact';
import type { ComponentChildren } from 'preact';
import {
  availableDevices,
  type DeviceKind,
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
      <Menu.Trigger
        aria-label="Audio and video settings"
        className="w-5 h-9 rounded-md grid place-items-center cursor-pointer border-none bg-transparent text-ml-glass-fg/60 hover:text-ml-glass-fg hover:bg-ml-glass-accent/[0.06] transition-[color,background-color] duration-150"
      >
        <ChevronDown size={12} aria-hidden="true" />
      </Menu.Trigger>

      <Menu.Portal>
        <Menu.Positioner side="bottom" align="end" sideOffset={6} className="z-2147483647">
          <Menu.Popup className="min-w-70 p-1.5 rounded-xl bg-(--ml-glass-bg-small) backdrop-blur-[80px] backdrop-saturate-[1.9] border border-(--ml-glass-border) shadow-[0_8px_30px_oklch(0_0_0/0.22)] text-ml-glass-fg text-[13px]">
            {!hasPermission && (
              <div class="mx-1 mb-1 px-2.5 py-2 rounded-md bg-ml-glass-accent/[0.08] text-[12px] text-ml-glass-fg/70 leading-snug">
                Grant microphone access to see device names.
              </div>
            )}

            <DeviceSection
              title="Microphone"
              icon={<Mic size={13} strokeWidth={2} />}
              options={mics}
              selectedId={selectedAudioInput.value}
              onSelect={(id) => {
                selectedAudioInput.value = id;
              }}
              kind="audioinput"
            />

            <SectionDivider />

            <DeviceSection
              title="Camera"
              icon={<Video size={13} strokeWidth={2} />}
              options={cams}
              selectedId={selectedVideoInput.value}
              onSelect={(id) => {
                selectedVideoInput.value = id;
              }}
              kind="videoinput"
            />

            {supportsSinkId() && (
              <>
                <SectionDivider />
                <DeviceSection
                  title="Speaker"
                  icon={<Headphones size={13} strokeWidth={2} />}
                  options={speakers}
                  selectedId={selectedAudioOutput.value}
                  onSelect={(id) => {
                    selectedAudioOutput.value = id;
                  }}
                  kind="audiooutput"
                />
              </>
            )}

            <SectionDivider />

            <div class="px-2.5 pt-1.5 pb-1 text-[10.5px] uppercase tracking-[0.08em] text-ml-glass-fg/60 font-semibold">
              Video quality
            </div>
            <div class="flex gap-1 p-1 pt-0.5">
              {QUALITY_OPTIONS.map((q) => {
                const isSelected = videoQuality.value === q.value;
                return (
                  <button
                    key={q.value}
                    type="button"
                    onClick={() => persistQuality(q.value)}
                    class={`flex-1 py-1.5 rounded-md text-[12px] font-medium cursor-pointer border-none transition-colors ${
                      isSelected
                        ? 'bg-ml-glass-accent/[0.22] text-ml-glass-fg shadow-[inset_0_0_0_1px_var(--ml-glass-border)] '
                        : 'bg-transparent text-ml-glass-fg/65 hover:text-ml-glass-fg hover:bg-ml-glass-accent/[0.1]'
                    }`}
                  >
                    {q.short}
                  </button>
                );
              })}
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
  kind: DeviceKind;
}

function SectionDivider() {
  return <div class="mx-2 my-1 h-px bg-(--ml-glass-divider)" />;
}

function DeviceSection({ title, icon, options, selectedId, onSelect }: SectionProps) {
  return (
    <div>
      <div class="px-2.5 pt-1.5 pb-1 flex items-center gap-1.5 text-[10.5px] uppercase tracking-[0.08em] text-ml-glass-fg/60 font-semibold">
        <span class="opacity-80">{icon}</span>
        {title}
      </div>
      <Menu.RadioGroup
        className="flex flex-col gap-px"
        value={selectedId ?? DEFAULT_DEVICE}
        onValueChange={(value: string) => onSelect(value === DEFAULT_DEVICE ? null : value)}
      >
        <DeviceRow label="System default" value={DEFAULT_DEVICE} />
        {options.length === 0 && (
          <div class="px-2.5 py-1.5 text-[12px] text-ml-glass-fg/60 italic">No devices detected</div>
        )}
        {options.map((d) => (
          <DeviceRow key={d.deviceId} label={d.label} value={d.deviceId} />
        ))}
      </Menu.RadioGroup>
    </div>
  );
}

// Selection is Base UI's to track — the row styles off `data-checked` rather
// than re-deriving it from the group's value.
function DeviceRow({ label, value }: { label: string; value: string }) {
  return (
    <Menu.RadioItem
      value={value}
      closeOnClick={false}
      className="flex items-center justify-between gap-2 px-2.5 py-2 rounded-md text-[13px] cursor-pointer border-none transition-colors
                 bg-transparent text-ml-glass-fg/80 hover:text-ml-glass-fg hover:bg-ml-glass-accent/[0.1]
                 data-checked:bg-ml-glass-accent/[0.18] data-checked:text-ml-glass-fg data-checked:font-medium"
    >
      <span class="truncate text-left leading-tight">{label}</span>
      <Menu.RadioItemIndicator className="shrink-0 inline-flex opacity-90">
        <Check size={14} strokeWidth={2.5} aria-hidden="true" />
      </Menu.RadioItemIndicator>
    </Menu.RadioItem>
  );
}
