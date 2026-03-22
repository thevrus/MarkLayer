import { pushOp } from '@ext/lib/state';
import type { DeviceMode, DrawOp } from '@ext/lib/types';
import { effect, signal } from '@preact/signals';
import { nanoid } from 'nanoid';
import { fromBase64 } from './encoding';

export const API_BASE = '/api/';

export const isMobileDevice = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) && 'ontouchstart' in window;

// Web-specific state
export const iframeScrollY = signal(0);
/** CSS transform scale — how much the locked container is visually scaled to fit the viewer */
export const cssScale = signal(1);
export const pageUrl = signal('');
export const originalWidth = signal(0);
export const annotationId = signal('');
export const isLanding = signal(true);
export const urlReady = signal(false);
export const commentPopover = signal<{ x: number; y: number } | null>(null);
export const textInput = signal<{ x: number; y: number } | null>(null);
export const selectionPopover = signal<{
  text: string;
  rects: import('@ext/lib/types').SelectionRect[];
  screenX: number;
  screenY: number;
} | null>(null);
export const isReadonly = signal(false);
export const sharing = signal(false);
export const showInfoPanel = signal(false);

/** Peer ID we're currently following (auto-scroll to their cursor) */
export const followingPeer = signal<string | null>(null);

/** Callback for follow-mode scrolling — set by Viewer (owns iframe ref) */
export const onFollowScroll = signal<((y: number) => void) | null>(null);

// Device mode
const VALID_DEVICES = new Set<DeviceMode>(['desktop', 'tablet', 'mobile']);
const initDevice = new URLSearchParams(location.search).get('device') as DeviceMode | null;
export const deviceMode = signal<DeviceMode>(initDevice && VALID_DEVICES.has(initDevice) ? initDevice : 'desktop');
export const DEVICE_WIDTHS: Record<DeviceMode, number> = { desktop: 0, tablet: 768, mobile: 390 };

// Sync device mode to URL
effect(() => {
  const dev = deviceMode.value;
  const url = new URL(location.href);
  if (dev === 'desktop') url.searchParams.delete('device');
  else url.searchParams.set('device', dev);
  history.replaceState(null, '', url);
});

/** Tag an operation with the current device mode before pushing */
export function pushDeviceOp(op: DrawOp) {
  pushOp({ ...op, device: deviceMode.value } as DrawOp);
}

/** Check if an operation belongs to the current device viewport (ops without a device tag default to desktop) */
export function opMatchesDevice(op: { device?: string }): boolean {
  return (op.device ?? 'desktop') === deviceMode.value;
}

// Parse URL params (synchronous — called before first render)
function parseViewParam(): boolean {
  const params = new URLSearchParams(location.search);
  const viewParam = params.get('view');

  // New short URL: /s/:id (no view param)
  const pathMatch = location.pathname.match(/^\/s\/([A-Za-z0-9_-]+)$/);
  if (!viewParam && pathMatch) {
    annotationId.value = pathMatch[1];
    isReadonly.value = params.get('readonly') === '1';
    // url + width will be filled by server init (useRealtimeSync → serverUrl/serverWidth)
    return true;
  }

  // Legacy: full view param with encoded URL
  if (!viewParam) return false;
  try {
    const decoded = fromBase64(viewParam);
    const hashIdx = decoded.indexOf('#ant=');
    if (hashIdx === -1) return false;
    pageUrl.value = decoded.substring(0, hashIdx);
    const meta = decoded.substring(hashIdx + 5);
    const eqIdx = meta.indexOf('=');
    if (eqIdx === -1) return false;
    originalWidth.value = parseInt(meta.substring(0, eqIdx), 10);
    if (!originalWidth.value || originalWidth.value <= 0 || Number.isNaN(originalWidth.value))
      originalWidth.value = 1280;
    annotationId.value = meta.substring(eqIdx + 1);
    isReadonly.value = params.get('readonly') === '1';
    return !!(pageUrl.value && annotationId.value);
  } catch {
    return false;
  }
}

if (parseViewParam()) {
  isLanding.value = false;
}

export async function navigateTo(url: string) {
  const w = window.innerWidth;
  const id = nanoid();
  await fetch(`${API_BASE}${id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ops: [], url, width: w }),
  });
  location.href = `/s/${id}`;
}

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
export function timeAgo(unix: number): string {
  const s = Math.floor(Date.now() / 1000) - unix;
  if (s < 60) return rtf.format(-s, 'second');
  if (s < 3600) return rtf.format(-Math.floor(s / 60), 'minute');
  if (s < 86400) return rtf.format(-Math.floor(s / 3600), 'hour');
  if (s < 2592000) return rtf.format(-Math.floor(s / 86400), 'day');
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(unix * 1000);
}
