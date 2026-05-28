import { useComputed } from '@preact/signals';
import { Check, ChevronDown, Headphones, Mic, Video } from 'lucide-preact';
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { tinykeys } from 'tinykeys';
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

interface Props {
  /** Whether the user has already granted media permission (controls hint copy). */
  hasPermission: boolean;
}

export function DeviceMenu({ hasPermission }: Props) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    watchDevices();
    refreshDevices();
    const onDown = (e: MouseEvent) => {
      const target = e.target;
      if (target instanceof Node && !wrapperRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    const unbindKeys = tinykeys(window, { Escape: () => setOpen(false) });
    return () => {
      document.removeEventListener('mousedown', onDown);
      unbindKeys();
    };
  }, [open]);

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
    <div ref={wrapperRef} class="relative">
      <button
        type="button"
        aria-label="Audio and video settings"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        class="w-5 h-9 rounded-md grid place-items-center cursor-pointer border-none bg-transparent text-ml-glass-fg/50 hover:text-ml-glass-fg hover:bg-ml-glass-accent/[0.06] transition-all duration-150"
      >
        <ChevronDown size={12} aria-hidden="true" />
      </button>

      {open && (
        <div
          role="menu"
          class="absolute right-0 top-[calc(100%+6px)] z-2147483647 min-w-70 p-1.5 rounded-xl bg-(--ml-glass-bg-small) backdrop-blur-[80px] backdrop-saturate-[1.9] border border-(--ml-glass-border) shadow-[0_8px_30px_oklch(0_0_0/0.22)] text-ml-glass-fg text-[13px]"
        >
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

          <div class="px-2.5 pt-1.5 pb-1 text-[10.5px] uppercase tracking-[0.08em] text-ml-glass-fg/55 font-semibold">
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
        </div>
      )}
    </div>
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
      <div class="px-2.5 pt-1.5 pb-1 flex items-center gap-1.5 text-[10.5px] uppercase tracking-[0.08em] text-ml-glass-fg/55 font-semibold">
        <span class="opacity-80">{icon}</span>
        {title}
      </div>
      <div class="flex flex-col gap-px">
        <DeviceRow label="System default" selected={selectedId === null} onClick={() => onSelect(null)} />
        {options.length === 0 && (
          <div class="px-2.5 py-1.5 text-[12px] text-ml-glass-fg/45 italic">No devices detected</div>
        )}
        {options.map((d) => (
          <DeviceRow
            key={d.deviceId}
            label={d.label}
            selected={selectedId === d.deviceId}
            onClick={() => onSelect(d.deviceId)}
          />
        ))}
      </div>
    </div>
  );
}

function DeviceRow({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={selected}
      onClick={onClick}
      class={`flex items-center justify-between gap-2 px-2.5 py-2 rounded-md text-[13px] cursor-pointer border-none transition-colors ${
        selected
          ? 'bg-ml-glass-accent/[0.18] text-ml-glass-fg font-medium'
          : 'bg-transparent text-ml-glass-fg/80 hover:text-ml-glass-fg hover:bg-ml-glass-accent/[0.1]'
      }`}
    >
      <span class="truncate text-left leading-tight">{label}</span>
      {selected && <Check size={14} strokeWidth={2.5} class="shrink-0 opacity-90" aria-hidden="true" />}
    </button>
  );
}
