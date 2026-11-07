import { bumpAnchorGeneration } from '@ext/lib/host-mutations';
import type { RectLike } from '@ext/lib/measure';
import { areas, comments, placeOp, pushOp, selections } from '@ext/lib/ops';
import { canEditFromRoom } from '@ext/lib/realtime';
import type { DeviceMode, DrawOp } from '@ext/lib/types';
import { computed, signal } from '@preact/signals';
import { captureOnce } from './analytics';
import { nextLargeStop } from './zoomScale';

/** No URL matched: the marketing page, not a room. Settled by `bootFromUrl`. */
export const isLanding = signal(true);

export const narrowViewport = signal(false);
/**
 * No pointer can hover here, so a thread that opens on hover would never open.
 * A tap on a pin opens it in the panel instead.
 */
export const hoverless = signal(false);

/** The viewer on a phone-width screen: a phone bar and sheets in place of the
 *  desktop chrome. The landing keeps its own narrow layout. */
export const compactChrome = computed(() => !isLanding.value && narrowViewport.value);

/** What the phone bar offers. The rest need a hover, a drag precise to the pixel, or a modifier key. */
export const PHONE_TOOLS = [
  { tool: 'navigate', label: 'Move' },
  { tool: 'comment', label: 'Comment' },
] as const;

export const iframeScrollY = signal(0);
/** CSS transform scale — how much the locked container is visually scaled to fit the viewer */
export const cssScale = signal(1);
/** The frame's box in the viewport, for layers portalled over it. Kept by `useFrameRectTracker`. */
export const frameRect = signal<RectLike | null>(null);
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

/** `?readonly=1`: the URL's own way to ask for a view-only session, independent of
 * whatever the room says about who may edit. Set once by `bootFromUrl`. */
export const urlForcesReadonly = signal(false);
/** `?still=1`: the page under review does not scroll. The landing page embeds a
 * room this way: a wheel over the window then chains to the page around it
 * instead of scrolling a second document inside the first. */
export const isStillFrame = signal(false);
/** The URL flag always wins over the room, in one place — not by convention at every writer. */
export const isReadonly = computed(() => urlForcesReadonly.value || canEditFromRoom.value === false);

export const deviceMode = signal<DeviceMode>('desktop');
export const DEVICE_WIDTHS: Record<DeviceMode, number> = { desktop: 0, tablet: 768, mobile: 390 };

/** A device frame takes its panels beside it; desktop and the phone lay them over the page. */
export const panelsDocked = computed(() => deviceMode.value !== 'desktop' && !compactChrome.value);

/** The read-only "all devices" view over the stage; picking a frame sets `deviceMode` and closes it. */
export const deviceOverview = signal(false);

/**
 * Viewer zoom for the iframe+canvas composite.
 * - 'auto' (default): fits available width, downscaling or upscaling up to `MAX_AUTO_UPSCALE`.
 * - number: an explicit factor, one of the stops on the slider's scale (`zoomScale.ts`).
 * Drawings stay pixel-aligned at any zoom because the iframe and canvas share the same transform wrapper.
 */
export type ViewerZoom = number | 'auto';
/** Ceiling on how far 'auto' zoom will upscale a narrow capture to fill available width. */
export const MAX_AUTO_UPSCALE = 2;

export const viewerZoom = signal<ViewerZoom>('auto');

/** Step to the next/previous large stop relative to the current effective scale. */
export function stepZoom(dir: 1 | -1) {
  const next = nextLargeStop({ from: viewerZoom.value === 'auto' ? cssScale.value : viewerZoom.value, dir });
  if (next !== null) viewerZoom.value = next;
}

export function pushDeviceOp(op: DrawOp) {
  // Gates session replay, which needs a stable event name of its own — the first
  // `annotation_created` of a session would do as a number, but not as a trigger.
  captureOnce('annotation_started', { tool: op.tool });
  pushOp({ ...op, device: deviceMode.value });
}

/** Same device tagging, for ops the app places itself — never counts as the visitor annotating. */
export function seedDeviceOp(op: DrawOp) {
  placeOp({ ...op, device: deviceMode.value });
}

/** Ops without a device tag were drawn at desktop width. */
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
