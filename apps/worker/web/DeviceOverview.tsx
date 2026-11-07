import { Tooltip } from '@ext/components/Tooltip';
import { bumpAnchorGeneration } from '@ext/lib/host-mutations';
import { useDismissible } from '@ext/lib/keymap';
import { rootComments } from '@ext/lib/ops';
import { findPageScroller, notePageScroller, scrollOffset, scrollPageBy } from '@ext/lib/scroller';
import type { CommentOp, DeviceMode } from '@ext/lib/types';
import { isSettled, resolveOpStatus } from '@marklayer/types/ops';
import { cn } from '@marklayer/ui/cn';
import { computed, signal, useSignalEffect } from '@preact/signals';
import { useLayoutEffect, useRef } from 'preact/hooks';
import { FRAME_SANDBOX_PREVIEW, hasFrameMarker } from '../shared/frame-protocol';
import {
  cam,
  type Frame,
  fitCanvas,
  frames,
  LABEL_H,
  panBy,
  stageCenter,
  stageSize,
  touched,
  zoomAt,
} from './deviceCamera';
import { frameSrc, hideScrollbars } from './docSource';
import { resolveAnchors, useIframeOverlay, wheelUnit } from './iframeOverlay';
import { pageUrl } from './projects';
import { DEVICE_ICONS, DEVICE_LABELS } from './shared';
import { openAnnotation } from './viewer-actions';
import { deviceMode, deviceOverview } from './viewer-state';
import { useViewerFrame } from './viewerFrame';

/** Travel before a press becomes a pan, so a slightly shaky click still opens the frame. */
const DRAG_SLOP = 4;

interface Pin {
  op: CommentOp;
  x: number;
  y: number;
}

const panning = signal(false);
const frameDocs = signal<Partial<Record<DeviceMode, Document>>>({});
/** Bumped when a frame's page reflows (late fonts, lazy images), so its pins re-resolve. */
const layoutTick = signal(0);
/** Each frame's page scroll, so its pins move with the page under them. */
const frameScroll = signal<Partial<Record<DeviceMode, number>>>({});

const openComments = computed(() => {
  const byMode: Partial<Record<DeviceMode, CommentOp[]>> = {};
  for (const op of rootComments.value) {
    if (isSettled(resolveOpStatus(op))) continue;
    const mode = op.device ?? 'desktop';
    byMode[mode] = [...(byMode[mode] ?? []), op];
  }
  return byMode;
});

/** Open comments resolved against each frame's own page, in that page's document coordinates. */
const framePins = computed(() => {
  void layoutTick.value;
  const byMode: Partial<Record<DeviceMode, Pin[]>> = {};
  for (const f of frames.value) {
    const doc = frameDocs.value[f.mode];
    byMode[f.mode] = (openComments.value[f.mode] ?? [])
      .map((op) => {
        const at = doc ? resolveAnchors({ target: op.target, pdf: op.pdf, docX: op.x, docY: op.y, doc }) : op;
        return { op, x: at.x, y: at.y };
      })
      .filter((p) => p.x >= 0 && p.x <= f.w);
  }
  return byMode;
});

function pick(mode: DeviceMode) {
  deviceMode.value = mode;
  deviceOverview.value = false;
}

/** The frame under a stage point, if any: the wheel scrolls its page instead of panning. */
function frameAt(at: { x: number; y: number }): Frame | undefined {
  const { x, y, z } = cam.value;
  const wx = (at.x - x) / z;
  const wy = (at.y - y) / z;
  return frames.value.find((f) => wx >= f.x && wx <= f.x + f.w && wy >= 0 && wy <= f.h);
}

function trackScroll({ mode, doc, win }: { mode: DeviceMode; doc: Document; win: Window }) {
  findPageScroller(doc);
  // A reload starts the new page at its top; the last page's offset would misplace every pin.
  frameScroll.value = { ...frameScroll.value, [mode]: scrollOffset(win).y };
  let queued = false;
  const onScroll = (e: Event) => {
    notePageScroller(doc, e.target);
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      frameScroll.value = { ...frameScroll.value, [mode]: scrollOffset(win).y };
    });
  };
  // Capture phase: an app-shell page scrolls an element, whose scroll event never bubbles.
  doc.addEventListener('scroll', onScroll, true);
  return () => doc.removeEventListener('scroll', onScroll, true);
}

function trackLayout(doc: Document) {
  const Observer = doc.defaultView?.ResizeObserver;
  if (!Observer) return () => {};
  let queued = false;
  const observer = new Observer(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      // The anchor cache keeps a miss until the generation moves, so an SPA's late render would never re-anchor.
      bumpAnchorGeneration();
      layoutTick.value++;
    });
  });
  observer.observe(doc.documentElement);
  return () => observer.disconnect();
}

function FramePage({ frame }: { frame: Frame }) {
  const { mode, x, w, h } = frame;
  const ref = useRef<HTMLIFrameElement>(null);
  useIframeOverlay(ref, ({ win, doc }) => {
    // The frame's first document is the blank one it was created with.
    if (!hasFrameMarker(doc)) return () => {};
    // A scrollbar in a frame is noise; the wheel scrolls it from here instead.
    hideScrollbars(doc);
    const stopLayout = trackLayout(doc);
    const stopScroll = trackScroll({ mode, doc, win });
    frameDocs.value = { ...frameDocs.value, [mode]: doc };
    return () => {
      stopLayout();
      stopScroll();
    };
  });
  return (
    <iframe
      ref={ref}
      title={`${DEVICE_LABELS[mode]} preview`}
      src={pageUrl.value ? frameSrc({ url: pageUrl.value }) : undefined}
      sandbox={FRAME_SANDBOX_PREVIEW}
      tabIndex={-1}
      aria-hidden="true"
      class="ph-no-capture absolute top-0 border-none bg-white pointer-events-none"
      style={{ left: x, width: w, height: h }}
    />
  );
}

/**
 * Label, hit area and pins for one frame, in screen space: they keep their size
 * at any zoom, the way a design tool's frame names and comment pins do.
 */
function FrameChrome({
  frame,
  onPick,
  onPin,
}: {
  frame: Frame;
  onPick: (mode: DeviceMode) => void;
  onPin: (target: { pin: Pin; mode: DeviceMode }) => void;
}) {
  const { mode, x, w, h } = frame;
  const { x: cx, y: cy, z } = cam.value;
  const left = cx + x * z;
  const width = w * z;
  const Icon = DEVICE_ICONS[mode];
  const count = openComments.value[mode]?.length ?? 0;
  const scrollY = frameScroll.value[mode] ?? 0;
  const pins = framePins.value[mode]?.filter((p) => p.y >= scrollY && p.y <= scrollY + h) ?? [];
  return (
    <>
      <div
        class="absolute flex items-end gap-1.5 pb-2 text-meta text-(--ds-gray-900) whitespace-nowrap overflow-hidden pointer-events-none"
        style={{ left, top: cy - LABEL_H, width, height: LABEL_H }}
      >
        <Icon size={13} strokeWidth={1.5} aria-hidden="true" class="shrink-0 mb-px" />
        <span class={cn('font-medium', deviceMode.value === mode && 'text-(--ds-gray-1000)')}>
          {DEVICE_LABELS[mode]}
        </span>
        <span class="tabular-nums text-(--ds-gray-700) truncate">
          {w} × {h}
        </span>
        {count > 0 && <span class="ml-auto pl-2 tabular-nums text-(--ds-gray-1000)">{count} open</span>}
      </div>
      <button
        type="button"
        aria-label={`Edit on ${DEVICE_LABELS[mode].toLowerCase()}`}
        onClick={() => onPick(mode)}
        class="absolute cursor-pointer border-none bg-transparent outline-none
               shadow-[0_0_0_1px_var(--ds-gray-alpha-400)] hover:shadow-[0_0_0_1px_var(--ds-gray-alpha-700)]
               focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ds-focus-color)
               transition-shadow duration-150"
        style={{ left, top: cy, width, height: h * z }}
      />
      {pins.map((pin) => (
        <button
          key={pin.op.id}
          type="button"
          aria-label={`Comment ${pin.op.num} on ${DEVICE_LABELS[mode].toLowerCase()}`}
          onClick={() => onPin({ pin, mode })}
          // Matches the stage's pin: flat fill, a surface ring that thickens on hover, one tight shadow.
          class="absolute -translate-x-1/2 -translate-y-1/2 w-7 h-7 rounded-full border-none text-white text-meta font-semibold
                 grid place-items-center cursor-pointer outline-none
                 shadow-[0_0_0_2px_var(--ds-background-100),0_1px_2px_oklch(0_0_0/0.25)]
                 hover:shadow-[0_0_0_3px_var(--ds-background-100),0_1px_2px_oklch(0_0_0/0.3)]
                 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ds-focus-color)
                 transition-shadow duration-150 ease-out"
          style={{ left: left + pin.x * z, top: cy + (pin.y - scrollY) * z, background: pin.op.color }}
        >
          {pin.op.num}
          <Tooltip text={pin.op.text || 'Comment'} wrap />
        </button>
      ))}
    </>
  );
}

/** Every device side by side on a pannable, zoomable canvas. Picking a frame or a pin opens that device. */
export function DeviceOverview() {
  const stageRef = useRef<HTMLDivElement>(null);
  const press = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null);
  /** A press that turned into a pan must not also land as a click on the frame under it. */
  const panned = useRef(false);
  const {
    actions: { scrollToAnnotation },
  } = useViewerFrame();
  const open = deviceOverview.value;
  useDismissible({
    open: deviceOverview,
    close: () => {
      deviceOverview.value = false;
    },
  });

  // Until the visitor moves the view, it follows the stage size and the desktop width.
  useSignalEffect(() => {
    if (deviceOverview.value && stageSize.value.w > 0 && !touched.value) fitCanvas();
  });

  // Wheel, Safari's gesture events and ResizeObserver are not signal-aware. A layout
  // effect, so a reopen measures and refits before the first paint instead of flashing the last camera.
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!open || !el) return;
    touched.value = false;
    const measure = () => {
      stageSize.value = { w: el.clientWidth, h: el.clientHeight };
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);

    const local = (clientX: number, clientY: number) => {
      const r = el.getBoundingClientRect();
      return { x: clientX - r.left, y: clientY - r.top };
    };
    // Trackpads pinch as a ctrl+wheel; ⌘+wheel zooms too, as in Figma. A plain wheel over a
    // frame scrolls its page, anywhere else it pans; drag pans everywhere.
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const unit = wheelUnit({ e, pageHeight: el.clientHeight });
      const dx = e.deltaX * unit;
      const dy = e.deltaY * unit;
      if (e.ctrlKey || e.metaKey) {
        // A mouse wheel notch is ~100px against a pinch's few; clamping keeps one notch a sane step.
        const step = Math.max(-50, Math.min(50, dy));
        zoomAt({ z: cam.value.z * Math.exp(-step * 0.01), at: local(e.clientX, e.clientY) });
        return;
      }
      if (e.shiftKey && dx === 0) {
        panBy(-dy, 0);
        return;
      }
      const over = frameAt(local(e.clientX, e.clientY));
      const win = over && frameDocs.value[over.mode]?.defaultView;
      if (!win) {
        panBy(-dx, -dy);
        return;
      }
      // Locked to the dominant axis, so a vertical swipe's sideways jitter doesn't drift the canvas.
      // Divided by the zoom so the page tracks the gesture on screen.
      if (Math.abs(dx) > Math.abs(dy)) panBy(-dx, 0);
      else scrollPageBy(win, 0, dy / cam.value.z);
    };
    // Safari reports a trackpad pinch as gesture events, not ctrl+wheel. GestureEvent is not in the DOM lib.
    let gestureFrom = 1;
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      gestureFrom = cam.value.z;
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      if (!('scale' in e) || typeof e.scale !== 'number') return;
      const at =
        e instanceof UIEvent &&
        'clientX' in e &&
        typeof e.clientX === 'number' &&
        'clientY' in e &&
        typeof e.clientY === 'number'
          ? local(e.clientX, e.clientY)
          : stageCenter();
      zoomAt({ z: gestureFrom * e.scale, at });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('gesturestart', onGestureStart);
    el.addEventListener('gesturechange', onGestureChange);
    return () => {
      ro.disconnect();
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('gesturestart', onGestureStart);
      el.removeEventListener('gesturechange', onGestureChange);
      frameDocs.value = {};
      frameScroll.value = {};
      stageSize.value = { w: 0, h: 0 };
      panning.value = false;
    };
  }, [open]);

  if (!open) return null;

  const onPin = ({ pin, mode }: { pin: Pin; mode: DeviceMode }) => {
    if (panned.current) return;
    openAnnotation(pin.op.id);
    pick(mode);
    // The stage takes the new width on the next render; the pin's place in it is the one resolved here.
    requestAnimationFrame(() => scrollToAnnotation(pin.y));
  };
  const onPick = (mode: DeviceMode) => {
    if (!panned.current) pick(mode);
  };
  const { x, y, z } = cam.value;

  return (
    <div
      ref={stageRef}
      role="dialog"
      aria-label="All devices"
      class={cn(
        'absolute inset-0 z-40 overflow-hidden bg-ml-bg-device touch-none select-none',
        panning.value ? 'cursor-grabbing **:cursor-grabbing!' : 'cursor-grab',
      )}
      onPointerDown={(e) => {
        // Primary drags anywhere; middle drags too, without the browser's autoscroll.
        if (e.button !== 0 && e.button !== 1) return;
        if (e.button === 1) e.preventDefault();
        panned.current = false;
        press.current = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
      }}
      onPointerMove={(e) => {
        const p = press.current;
        if (!p || p.id !== e.pointerId) return;
        const dx = e.clientX - p.x;
        const dy = e.clientY - p.y;
        if (!p.moved) {
          if (Math.hypot(dx, dy) < DRAG_SLOP) return;
          p.moved = true;
          panned.current = true;
          panning.value = true;
          e.currentTarget.setPointerCapture(e.pointerId);
        }
        p.x = e.clientX;
        p.y = e.clientY;
        panBy(dx, dy);
      }}
      onPointerUp={() => {
        press.current = null;
        panning.value = false;
        // Past this pointerup's own click, so a keyboard press on a frame afterwards still lands.
        if (panned.current) setTimeout(() => (panned.current = false));
      }}
      onPointerCancel={() => {
        press.current = null;
        panning.value = false;
      }}
    >
      {stageSize.value.w > 0 && (
        <>
          <div
            class="absolute top-0 left-0 origin-top-left"
            style={{ transform: `translate(${x}px, ${y}px) scale(${z})` }}
          >
            {frames.value.map((f) => (
              <FramePage key={f.mode} frame={f} />
            ))}
          </div>
          {frames.value.map((f) => (
            <FrameChrome key={f.mode} frame={f} onPick={onPick} onPin={onPin} />
          ))}
        </>
      )}
    </div>
  );
}
