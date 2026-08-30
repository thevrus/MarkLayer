import { trackChanges } from '@ext/lib/analytics';
import {
  annotatedUrl,
  areas,
  bumpAnchorGeneration,
  comments,
  pushOp,
  selections,
  toast as showToast,
  uiHidden,
} from '@ext/lib/state';
import type { DeviceMode, DrawOp } from '@ext/lib/types';
import type { CaptureViewport, TargetElement } from '@marklayer/types';
import { computed, effect, signal } from '@preact/signals';
import { capture, captureOnce } from './analytics';
import { fromBase64 } from './encoding';
import { annotationId, currentPageIdx, originalWidth, pageUrl, projectId } from './projects';

// Re-export project surface so existing imports from './signals' keep working.
export {
  API_BASE,
  annotationId,
  createAnnotationFor,
  currentPageIdx,
  loadProject,
  navigateTo,
  originalWidth,
  type ProjectPage,
  pageUrl,
  projectId,
  projectLoading,
  projectPages,
  saveProject,
} from './projects';

// Every path that frames a page writes `pageUrl` — the legacy view param, the
// server init, a project page change — so the bridge sits on the signal rather
// than on each of them.
effect(() => {
  annotatedUrl.value = pageUrl.value || null;
});

export const isMobileDevice = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) && 'ontouchstart' in window;

// Web-specific state
export const iframeScrollY = signal(0);
/** CSS transform scale — how much the locked container is visually scaled to fit the viewer */
export const cssScale = signal(1);
/**
 * Bumped (RAF-debounced) when the proxied iframe's DOM mutates so element-anchored
 * annotation components re-resolve their selectors against the new layout.
 * Subscribed by WebCommentPin / WebAreaShape / WebSelectionHighlight.
 * Wired by Viewer once the iframe is ready (see attachIframeMutationObserver).
 */
export const iframeMutationTick = signal(0);

/**
 * Watch the iframe's document for DOM mutations and bump `iframeMutationTick`
 * once per RAF. Returns a teardown to disconnect the observer + cancel the RAF.
 * Cheap when the iframe is idle: MutationObserver is native and the RAF coalesces
 * bursts.
 */
export function attachIframeMutationObserver(doc: Document): () => void {
  let pending = false;
  const flush = () => {
    pending = false;
    bumpAnchorGeneration();
    iframeMutationTick.value++;
  };
  const obs = new MutationObserver(() => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(flush);
  });
  obs.observe(doc, { subtree: true, childList: true, attributes: true, characterData: false });
  return () => {
    obs.disconnect();
    pending = false;
  };
}
export const isLanding = signal(true);
export const urlReady = signal(false);
export const commentPopover = signal<{ x: number; y: number } | null>(null);
export const textInput = signal<{ x: number; y: number } | null>(null);
export const selectionPopover = signal<{
  text: string;
  rects: import('@ext/lib/types').SelectionRect[];
  screenX: number;
  screenY: number;
  target?: TargetElement;
  captureViewport?: CaptureViewport;
  /** Opened by the selection alone rather than by arming the selection tool. */
  auto: boolean;
} | null>(null);
/**
 * How the support card came to be open, or `null` when it is closed.
 *
 * One signal rather than an `open` boolean beside a `trigger`, so the two can
 * never disagree about which ask is on screen. `auto` is the earned, once-ever
 * offer; `bar` and `menu` are the person asking for it themselves.
 *
 * Web-app only by design (see support.ts), so it lives here rather than in the
 * shared extension state.
 */
export type SupportTrigger = 'auto' | 'bar' | 'menu';
export const showSupportDialog = signal<SupportTrigger | null>(null);
export const isReadonly = signal(false);
export const sharing = signal(false);
export const showInfoPanel = signal(false);

/** What the info panel actually renders on — ⌘/ closes it without forgetting it was open. */
export const infoPanelOpen = computed(() => showInfoPanel.value && !uiHidden.value);

/** Peer ID we're currently following (auto-scroll to their cursor) */
export const followingPeer = signal<string | null>(null);

/** Callback for follow-mode scrolling — set by Viewer (owns iframe ref) */
export const onFollowScroll = signal<((y: number) => void) | null>(null);

/** The full-screen triage board — a second view of the annotations, by status. */
export const showBoard = signal(false);

/** Whether we are presenting: pulling every other peer onto our scroll position. */
export const presenting = signal(false);

/** Sends the presenting state to the room — set by useRealtimeSync. */
export const onPresentChange = signal<((on: boolean) => void) | null>(null);

/**
 * Start or stop presenting. Presenting and following are mutually exclusive: you
 * cannot pull the room onto a scroll position you are not the one steering.
 */
export function setPresenting(on: boolean) {
  if (presenting.value === on) return;
  presenting.value = on;
  if (on) followingPeer.value = null;
  onPresentChange.value?.(on);
}

// Device mode
const isDeviceMode = (v: unknown): v is DeviceMode => v === 'desktop' || v === 'tablet' || v === 'mobile';
const initDevice = new URLSearchParams(location.search).get('device');
export const deviceMode = signal<DeviceMode>(isDeviceMode(initDevice) ? initDevice : 'desktop');
export const DEVICE_WIDTHS: Record<DeviceMode, number> = { desktop: 0, tablet: 768, mobile: 390 };

/**
 * Viewer zoom for the iframe+canvas composite.
 * - 'auto' (default): fits available width, downscaling or upscaling up to `MAX_AUTO_UPSCALE`.
 * - number: explicit factor (0.5, 0.75, 1, 1.5, 2).
 * Drawings stay pixel-aligned at any zoom because the iframe and canvas share the same transform wrapper.
 */
export type ViewerZoom = number | 'auto';
/** Ceiling on how far 'auto' zoom will upscale a narrow capture to fill available width. */
export const MAX_AUTO_UPSCALE = 2;
export const ZOOM_PRESETS: { value: ViewerZoom; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 0.5, label: '50%' },
  { value: 0.75, label: '75%' },
  { value: 1, label: '100%' },
  { value: 1.5, label: '150%' },
  { value: 2, label: '200%' },
];

const _zoomLs = typeof localStorage !== 'undefined' ? localStorage : null;
function parseStoredZoom(raw: string | null): ViewerZoom {
  if (raw === 'auto') return raw;
  const n = Number(raw);
  return ZOOM_PRESETS.some((p) => p.value === n) ? n : 'auto';
}
export const viewerZoom = signal<ViewerZoom>(parseStoredZoom(_zoomLs?.getItem('ml-zoom') ?? null));
effect(() => {
  try {
    _zoomLs?.setItem('ml-zoom', String(viewerZoom.value));
  } catch {
    /* quota / private mode */
  }
});

const NUMERIC_ZOOMS = ZOOM_PRESETS.flatMap((p) => (typeof p.value === 'number' ? [p.value] : []));

/** Step to the next/previous numeric preset relative to the current effective scale. */
export function stepZoom(dir: 1 | -1) {
  const current = viewerZoom.value === 'auto' ? cssScale.value : viewerZoom.value;
  const next = dir > 0 ? NUMERIC_ZOOMS.find((v) => v > current) : [...NUMERIC_ZOOMS].reverse().find((v) => v < current);
  if (next !== undefined) viewerZoom.value = next;
}

// Whether the responsive frames get used, and which ones. Changes only: the mode
// is in the URL, so a share can arrive on one without anyone having picked it.
trackChanges(deviceMode, (device) => capture('device_mode_changed', { device }));

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
  // Gates session replay, which needs a stable event name of its own — the first
  // `annotation_created` of a session would do as a number, but not as a trigger.
  captureOnce('annotation_started', { tool: op.tool });
  pushOp({ ...op, device: deviceMode.value });
}

/** Same device tagging, for ops the app places itself — never counts as the visitor annotating. */
export function seedDeviceOp(op: DrawOp) {
  pushOp({ ...op, device: deviceMode.value }, { seeded: true });
}

/** Check if an operation belongs to the current device viewport (ops without a device tag default to desktop) */
export function opMatchesDevice(op: { device?: string }): boolean {
  return (op.device ?? 'desktop') === deviceMode.value;
}

/**
 * The device-filtered op views, computed once rather than per render. The stage
 * re-renders on every scroll frame of the proxied page, and scrolling changes
 * neither the op list nor `deviceMode` — filtering inline redid the whole pass
 * each frame.
 */
export const deviceSelections = computed(() => selections.value.filter(opMatchesDevice));
export const deviceAreas = computed(() => areas.value.filter(opMatchesDevice));
export const deviceComments = computed(() => comments.value.filter(opMatchesDevice));

// Parse URL params (synchronous — called before first render)
function parseViewParam(): boolean {
  const params = new URLSearchParams(location.search);
  const viewParam = params.get('view');

  // Project URL: /p/:id (?page=N selects which page; defaults to 0)
  const projectMatch = location.pathname.match(/^\/p\/([A-Za-z0-9_-]+)$/);
  if (!viewParam && projectMatch) {
    projectId.value = projectMatch[1];
    isReadonly.value = params.get('readonly') === '1';
    const pageParam = parseInt(params.get('page') ?? '0', 10);
    currentPageIdx.value = Number.isFinite(pageParam) && pageParam >= 0 ? pageParam : 0;
    return true;
  }

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

// Show friendly error when redirected from proxy. Use the hash (not a query
// param) so the error URL is not indexable as a duplicate of `/`.
if (location.hash === '#error=self') {
  showToast("You can't annotate MarkLayer itself — try a different URL", 'error', 5000);
  history.replaceState(null, '', location.pathname + location.search);
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
