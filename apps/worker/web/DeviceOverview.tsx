import { rootComments } from '@ext/lib/state';
import type { DeviceMode } from '@ext/lib/types';
import { cn, isSettled, resolveOpStatus } from '@marklayer/types';
import { signal } from '@preact/signals';
import { useEffect, useRef } from 'preact/hooks';
import { tinykeys } from 'tinykeys';
import { frameSrc, stillFrame } from './docSource';
import { DEVICE_ICONS, DEVICE_LABELS } from './shared';
import { DEVICE_WIDTHS, deviceMode, deviceOverview, originalWidth, pageUrl } from './signals';

const MODES: readonly DeviceMode[] = ['desktop', 'tablet', 'mobile'];
/** Height of the page shown in every frame: the top of the page, which is what a viewport is. */
const SHOWN_H = 900;
const GAP = 40;
const PAD = 40;
/** Room under each frame for its label. */
const LABEL_H = 44;
const FALLBACK_DESKTOP_W = 1280;

const stageSize = signal({ w: 0, h: 0 });

const frameWidth = (mode: DeviceMode) =>
  mode === 'desktop' ? originalWidth.value || FALLBACK_DESKTOP_W : DEVICE_WIDTHS[mode];

function openCount(mode: DeviceMode): number {
  return rootComments.value.filter((op) => (op.device ?? 'desktop') === mode && !isSettled(resolveOpStatus(op))).length;
}

/** One scale for all three, so the frames keep their real proportions to each other. */
function sharedScale(): number {
  const { w, h } = stageSize.value;
  const totalW = MODES.reduce((sum, m) => sum + frameWidth(m), 0);
  const fitW = (w - PAD * 2 - GAP * (MODES.length - 1)) / totalW;
  const fitH = (h - PAD * 2 - LABEL_H) / SHOWN_H;
  return Math.max(0.05, Math.min(fitW, fitH));
}

function pick(mode: DeviceMode) {
  deviceMode.value = mode;
  deviceOverview.value = false;
}

function OverviewFrame({ mode, scale }: { mode: DeviceMode; scale: number }) {
  const Icon = DEVICE_ICONS[mode];
  const count = openCount(mode);
  const w = frameWidth(mode);
  return (
    <div class="flex flex-col shrink-0" style={{ width: w * scale }}>
      <div
        class="relative overflow-hidden rounded-lg bg-white border border-(--ds-gray-alpha-400)"
        style={{ width: w * scale, height: SHOWN_H * scale }}
      >
        <iframe
          title={`${DEVICE_LABELS[mode]} preview`}
          src={pageUrl.value ? frameSrc({ url: pageUrl.value }) : undefined}
          sandbox="allow-scripts allow-same-origin"
          tabIndex={-1}
          aria-hidden="true"
          class="ph-no-capture absolute top-0 left-0 border-none bg-white pointer-events-none origin-top-left"
          style={{ width: w, height: SHOWN_H, transform: `scale(${scale})` }}
          onLoad={(e) => {
            // Same stillness the embedded room uses: a scrollbar in a thumbnail is noise.
            const doc = e.currentTarget.contentDocument;
            if (doc) stillFrame(doc);
          }}
        />
        <button
          type="button"
          aria-label={`Edit on ${DEVICE_LABELS[mode].toLowerCase()}`}
          onClick={() => pick(mode)}
          class="absolute inset-0 cursor-pointer border-none bg-transparent outline-none hover:bg-(--ds-gray-alpha-100) focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ds-focus-color) transition-colors duration-150"
        />
      </div>
      <div class="flex items-center gap-2 pt-3 text-ui text-(--ds-gray-900) whitespace-nowrap">
        <Icon size={15} strokeWidth={1.5} aria-hidden="true" />
        <span class={cn('font-medium', deviceMode.value === mode && 'text-(--ds-gray-1000)')}>
          {DEVICE_LABELS[mode]}
        </span>
        <span class="tabular-nums text-(--ds-gray-700)">{w}px</span>
        <span class="ml-auto tabular-nums text-(--ds-gray-1000)">
          {count === 0 ? 'No open comments' : `${count} open`}
        </span>
      </div>
    </div>
  );
}

export function DeviceOverview() {
  const stageRef = useRef<HTMLDivElement>(null);
  const open = deviceOverview.value;

  // ResizeObserver and tinykeys are not signal-aware, so these are the effect's job.
  useEffect(() => {
    const el = stageRef.current;
    if (!open || !el) return;
    const measure = () => {
      stageSize.value = { w: el.clientWidth, h: el.clientHeight };
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    const unbind = tinykeys(window, {
      Escape: () => {
        deviceOverview.value = false;
      },
    });
    return () => {
      ro.disconnect();
      unbind();
    };
  }, [open]);

  if (!open) return null;
  const scale = sharedScale();
  return (
    <div
      ref={stageRef}
      role="dialog"
      aria-label="All devices"
      class="absolute inset-0 z-40 flex items-center justify-center overflow-hidden bg-ml-bg-device"
      style={{ gap: GAP, padding: PAD }}
    >
      {stageSize.value.w > 0 && MODES.map((mode) => <OverviewFrame key={mode} mode={mode} scale={scale} />)}
    </div>
  );
}
