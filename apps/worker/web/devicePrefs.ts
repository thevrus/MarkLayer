// Browsers return real device labels only after the user grants media permission,
// so we re-enumerate after every successful getUserMedia and on `devicechange`.

import { effect, signal } from '@preact/signals';

export type DeviceKind = 'audioinput' | 'videoinput' | 'audiooutput';

export interface DeviceInfo {
  deviceId: string;
  label: string;
  kind: DeviceKind;
}

const STORAGE_KEYS: Record<DeviceKind, string> = {
  audioinput: 'ml-device-audioinput',
  videoinput: 'ml-device-videoinput',
  audiooutput: 'ml-device-audiooutput',
};

function readStored(kind: DeviceKind): string | null {
  try {
    return localStorage.getItem(STORAGE_KEYS[kind]);
  } catch {
    return null;
  }
}

function writeStored(kind: DeviceKind, id: string | null) {
  try {
    if (id) localStorage.setItem(STORAGE_KEYS[kind], id);
    else localStorage.removeItem(STORAGE_KEYS[kind]);
  } catch {
    /* quota / private mode */
  }
}

export const availableDevices = signal<DeviceInfo[]>([]);

/** Selected device IDs. `null` = "system default" (let the browser pick). */
export const selectedAudioInput = signal<string | null>(readStored('audioinput'));
export const selectedVideoInput = signal<string | null>(readStored('videoinput'));
export const selectedAudioOutput = signal<string | null>(readStored('audiooutput'));

effect(() => writeStored('audioinput', selectedAudioInput.value));
effect(() => writeStored('videoinput', selectedVideoInput.value));
effect(() => writeStored('audiooutput', selectedAudioOutput.value));

let watching = false;
let onChange: (() => void) | null = null;

// Safe to call before permission is granted — labels are empty strings then.
// Coalesces concurrent calls (devicechange + getUserMedia + picker-open can
// otherwise stack 3 enumerateDevices() within the same tick).
let refreshInFlight: Promise<DeviceInfo[]> | null = null;
export function refreshDevices(): Promise<DeviceInfo[]> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = doRefresh().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

async function doRefresh(): Promise<DeviceInfo[]> {
  if (!navigator.mediaDevices?.enumerateDevices) {
    availableDevices.value = [];
    return [];
  }
  try {
    const raw = await navigator.mediaDevices.enumerateDevices();
    const list: DeviceInfo[] = raw
      .filter(
        (d): d is MediaDeviceInfo & { kind: DeviceKind } =>
          d.kind === 'audioinput' || d.kind === 'videoinput' || d.kind === 'audiooutput',
      )
      .map((d) => ({
        deviceId: d.deviceId,
        label: d.label || defaultLabel(d.kind, d.deviceId),
        kind: d.kind,
      }));
    availableDevices.value = list;
    pruneStale(list);
    return list;
  } catch {
    return [];
  }
}

function defaultLabel(kind: DeviceKind, id: string): string {
  if (id === 'default') return 'System default';
  if (id === 'communications') return 'Communications default';
  return kind === 'audioinput' ? 'Microphone' : kind === 'videoinput' ? 'Camera' : 'Speaker';
}

function pruneStale(list: DeviceInfo[]) {
  const known = new Set(list.map((d) => d.deviceId));
  if (selectedAudioInput.value && !known.has(selectedAudioInput.value)) selectedAudioInput.value = null;
  if (selectedVideoInput.value && !known.has(selectedVideoInput.value)) selectedVideoInput.value = null;
  if (selectedAudioOutput.value && !known.has(selectedAudioOutput.value)) selectedAudioOutput.value = null;
}

/** Start watching for device changes. Idempotent. */
export function watchDevices() {
  if (watching || !navigator.mediaDevices?.addEventListener) return;
  watching = true;
  onChange = () => {
    refreshDevices();
  };
  navigator.mediaDevices.addEventListener('devicechange', onChange);
  refreshDevices();
}

export function unwatchDevices() {
  if (!watching || !onChange) return;
  navigator.mediaDevices.removeEventListener?.('devicechange', onChange);
  watching = false;
  onChange = null;
}

export function listByKind(kind: DeviceKind): DeviceInfo[] {
  return availableDevices.value.filter((d) => d.kind === kind);
}

/** Build a getUserMedia constraint object honoring the user's stored device picks. */
export function audioConstraint(): MediaTrackConstraints {
  const id = selectedAudioInput.value;
  // Echo cancellation + noise suppression + auto-gain default to true in most
  // browsers; spell them out so the device-swap path stays consistent.
  const base: MediaTrackConstraints = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  };
  return id ? { ...base, deviceId: { exact: id } } : base;
}

export function videoConstraint(extra: MediaTrackConstraints = {}): MediaTrackConstraints {
  const id = selectedVideoInput.value;
  return id ? { ...extra, deviceId: { exact: id } } : extra;
}

/**
 * Whether the runtime supports HTMLMediaElement.setSinkId (Chrome/Edge, not Firefox/Safari).
 * Used to hide the speaker picker on browsers that can't act on it.
 */
export function supportsSinkId(): boolean {
  return typeof document !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;
}
