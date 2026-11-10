import { trackChanges } from '@ext/lib/analytics';
import { annotatedUrl } from '@ext/lib/page-url';
import { activeRoomId, setAnnotationId } from '@ext/lib/room-id';
import { toast } from '@ext/lib/toasts';
import { activeTool } from '@ext/lib/tool-state';
import { DEFAULT_WIDTH, sharePath } from '@marklayer/brand/links';
import { deviceModeSchema } from '@marklayer/types/ops';
import { effect, type Signal } from '@preact/signals';
import { capture, setRole } from './analytics';
import { fromBase64 } from './encoding';
import { annotationId, currentPageIdx, originalWidth, pageUrl, projectId } from './projects';
import { wirePanelState } from './ui-state';
import {
  compactChrome,
  deviceMode,
  hoverless,
  isLanding,
  isReadonly,
  isStillFrame,
  narrowViewport,
  PHONE_TOOLS,
  urlForcesReadonly,
  viewerZoom,
} from './viewer-state';
import { zoomStop } from './zoomScale';

const ZOOM_KEY = 'ml-zoom';

/** Keeps a signal on a media query, so layout that depends on it re-renders when it flips. */
function watchMedia({ query, into }: { query: string; into: Signal<boolean> }) {
  const mq = matchMedia(query);
  into.value = mq.matches;
  mq.addEventListener('change', (e) => (into.value = e.matches));
}

/** Parses the room out of the URL. False on anything that is not a room: the marketing page. */
function parseRoomUrl(): boolean {
  const params = new URLSearchParams(location.search);
  const viewParam = params.get('view');

  const projectMatch = location.pathname.match(/^\/p\/([A-Za-z0-9_-]+)$/);
  if (!viewParam && projectMatch) {
    projectId.value = projectMatch[1];
    const pageParam = parseInt(params.get('page') ?? '0', 10);
    currentPageIdx.value = Number.isFinite(pageParam) && pageParam >= 0 ? pageParam : 0;
    return true;
  }

  const pathMatch = location.pathname.match(/^\/s\/([A-Za-z0-9_-]+)$/);
  if (!viewParam && pathMatch) {
    annotationId.value = pathMatch[1];
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
      originalWidth.value = DEFAULT_WIDTH;
    annotationId.value = meta.substring(eqIdx + 1);
    return !!(pageUrl.value && annotationId.value);
  } catch {
    return false;
  }
}

function readStoredZoom(): number | 'auto' {
  try {
    // 'auto', a missing key and a value off the scale all parse to no stop.
    return zoomStop(Number(localStorage.getItem(ZOOM_KEY))) ?? 'auto';
  } catch {
    return 'auto';
  }
}

function wireViewerEffects() {
  wirePanelState();

  // The kernel asks `room-id` which room it is in, and Settings' Join a room answers through
  // it, so the two ids stay one: ours flows down, and a different one there means go to it.
  effect(() => {
    const id = annotationId.value;
    if (id) setAnnotationId(id);
  });
  effect(() => {
    const id = activeRoomId.value;
    if (id && id !== annotationId.peek()) location.assign(sharePath(id));
  });

  // Every path that frames a page writes `pageUrl` — the legacy view param, the
  // server init, a project page change — so the bridge sits on the signal rather
  // than on each of them.
  effect(() => {
    annotatedUrl.value = pageUrl.value || null;
  });

  // No tool the phone bar lacks may stay armed: picked on a wide window, or by a
  // hardware-keyboard shortcut, it would have no button left to disarm it.
  effect(() => {
    if (compactChrome.value && !PHONE_TOOLS.some((t) => t.tool === activeTool.value)) activeTool.value = 'navigate';
  });

  // Mirror read-only into the telemetry label (see setRole). The room can demote a
  // session after boot, which is why this is an effect and not a one-off read.
  effect(() => setRole(isReadonly.value ? 'viewer' : 'editor'));

  effect(() => {
    try {
      localStorage.setItem(ZOOM_KEY, String(viewerZoom.value));
    } catch {
      /* quota / private mode */
    }
  });

  // Whether the responsive frames get used, and which ones. Changes only: the mode
  // is in the URL, so a share can arrive on one without anyone having picked it.
  trackChanges(deviceMode, (device) => capture('device_mode_changed', { device }));

  effect(() => {
    const dev = deviceMode.value;
    const url = new URL(location.href);
    if (dev === 'desktop') url.searchParams.delete('device');
    else url.searchParams.set('device', dev);
    history.replaceState(null, '', url);
  });
}

/** Everything the page reads off its URL and environment, once, before the first render. Importing state does none of it. */
export function bootFromUrl() {
  const params = new URLSearchParams(location.search);
  urlForcesReadonly.value = params.get('readonly') === '1';
  isStillFrame.value = params.get('still') === '1';
  const device = deviceModeSchema.safeParse(params.get('device'));
  if (device.success) deviceMode.value = device.data;

  viewerZoom.value = readStoredZoom();
  // Below Tailwind's `md`: the same line the viewer's CSS breakpoints draw.
  watchMedia({ query: '(max-width: 767.98px)', into: narrowViewport });
  watchMedia({ query: '(hover: none)', into: hoverless });

  if (parseRoomUrl()) isLanding.value = false;
  wireViewerEffects();

  // Show friendly error when redirected from proxy. Use the hash (not a query
  // param) so the error URL is not indexable as a duplicate of `/`.
  if (location.hash === '#error=self') {
    toast("You can't annotate visual collaboration itself — try a different URL", { type: 'error', duration: 5000 });
    history.replaceState(null, '', location.pathname + location.search);
  }
}
