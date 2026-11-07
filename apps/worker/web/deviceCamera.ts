import type { DeviceMode } from '@ext/lib/types';
import { DEFAULT_WIDTH } from '@marklayer/brand/links';
import { DEVICE_MODES } from '@marklayer/types/ops';
import { computed, signal } from '@preact/signals';
import { originalWidth } from './projects';
import { DEVICE_WIDTHS } from './viewer-state';

/** How much of the page a frame shows: one screen of it. Desktop takes a 16:10 screen at its width. */
const VIEWPORT_H = { tablet: 1024, mobile: 844 } as const;
const DESKTOP_RATIO = 0.625;
/** World px between frames. */
const GAP = 120;
/** Screen px kept clear around the frames when fitting. */
const PAD = 56;
/** Screen px above a frame for its label. */
export const LABEL_H = 28;
const MIN_Z = 0.05;
const MAX_Z = 4;
const STOPS = [0.05, 0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4];

export interface Frame {
  mode: DeviceMode;
  x: number;
  w: number;
  h: number;
}

export const stageSize = signal({ w: 0, h: 0 });
/** Screen offset of the world origin, and the world-to-screen scale. */
export const cam = signal({ x: 0, y: 0, z: 1 });
/** Set once the visitor pans or zooms, so a resize stops refitting the view under them. */
export const touched = signal(false);

export const frames = computed<Frame[]>(() => {
  let x = 0;
  return DEVICE_MODES.map((mode) => {
    const w = mode === 'desktop' ? originalWidth.value || DEFAULT_WIDTH : DEVICE_WIDTHS[mode];
    const h = mode === 'desktop' ? Math.round(w * DESKTOP_RATIO) : VIEWPORT_H[mode];
    const frame = { mode, x, w, h };
    x += w + GAP;
    return frame;
  });
});

const extent = computed(() => ({
  w: Math.max(...frames.value.map((f) => f.x + f.w)),
  h: Math.max(...frames.value.map((f) => f.h)),
}));

const clampZ = (z: number) => Math.min(MAX_Z, Math.max(MIN_Z, z));

const fitZoom = computed(() => {
  const { w, h } = stageSize.value;
  return clampZ(Math.min((w - PAD * 2) / extent.value.w, (h - PAD * 2 - LABEL_H) / extent.value.h, 1));
});

export const canvasZoom = computed(() => cam.value.z);
export const canvasFitted = computed(() => !touched.value);

export function fitCanvas() {
  const { w, h } = stageSize.value;
  const z = fitZoom.value;
  cam.value = { z, x: (w - extent.value.w * z) / 2, y: (h - extent.value.h * z + LABEL_H) / 2 };
}

/** An explicit fit hands the view back to auto-fit, so a resize after it refits again. */
export function refit() {
  touched.value = false;
  fitCanvas();
}

/** Zoom keeping the world point under `at` (stage px) where it is. */
export function zoomAt({ z, at }: { z: number; at: { x: number; y: number } }) {
  const c = cam.value;
  const next = clampZ(z);
  touched.value = true;
  cam.value = { z: next, x: at.x - ((at.x - c.x) * next) / c.z, y: at.y - ((at.y - c.y) * next) / c.z };
}

export function panBy(dx: number, dy: number) {
  touched.value = true;
  cam.value = { ...cam.value, x: cam.value.x + dx, y: cam.value.y + dy };
}

export const stageCenter = () => ({ x: stageSize.value.w / 2, y: stageSize.value.h / 2 });

export function zoomCanvasTo(z: number) {
  zoomAt({ z, at: stageCenter() });
}

export function stepCanvasZoom(dir: 1 | -1) {
  const z = cam.value.z;
  const next = dir > 0 ? STOPS.find((s) => s > z + 0.001) : [...STOPS].reverse().find((s) => s < z - 0.001);
  if (next !== undefined) zoomCanvasTo(next);
}

export function toggleCanvasFit() {
  if (canvasFitted.value) zoomCanvasTo(1);
  else refit();
}
