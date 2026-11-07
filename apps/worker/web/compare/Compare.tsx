import { Toggle } from '@base-ui/react/toggle';
import { ToggleGroup } from '@base-ui/react/toggle-group';
import { submitBtn } from '@ext/lib/buttons';
import { geist } from '@ext/lib/geist';
import { displayHost } from '@marklayer/brand/links';
import { cn } from '@marklayer/ui/cn';
import { signal, useSignal, useSignalEffect } from '@preact/signals';
import type { JSX } from 'preact';
import { useLocation, useSearch } from 'wouter-preact';
import {
  FRAME_MESSAGE,
  FRAME_SANDBOX,
  onFrameMessage,
  PARENT_MESSAGE,
  type ParentMessage,
} from '../../shared/frame-protocol';
import { frameSrc } from '../docSource';
import { Logo } from '../shared';
import { parseCompareUrl } from './url';

type Side = 'a' | 'b';
type Mode = 'side' | 'overlay';

/** "Before" and "After", not "A" and "B": the pair is nearly always live vs. changed, and a letter says nothing. */
const SIDE_LABEL: Record<Side, string> = { a: 'Before', b: 'After' };

const MODES: { value: Mode; label: string }[] = [
  { value: 'side', label: 'Side by side' },
  { value: 'overlay', label: 'Slider' },
];

const mode = signal<Mode>('side');
/** Where the slider divider sits, as a percentage of the width: B shows to its right. */
const split = signal(50);

/** Mounted iframes. Module-level because switching mode remounts them and the relay only needs the live ones. */
const frames: Record<Side, HTMLIFrameElement | null> = { a: null, b: null };

const hostOf = (url: string): string => displayHost(url) ?? url;

const tellFrame = (frame: HTMLIFrameElement | null, message: ParentMessage) =>
  frame?.contentWindow?.postMessage(message, location.origin);

/**
 * Relays each page's scroll position to the other. The proxy's bridge script only
 * speaks after `ml-scroll-sync`, and both ends check `source`, so a stranger's
 * window can neither drive these frames nor be driven by them.
 */
function useScrollRelay() {
  useSignalEffect(() =>
    onFrameMessage({
      frames: () => [frames.a, frames.b],
      handler: ({ message, frame }) => {
        if (message.type !== FRAME_MESSAGE.scroll) return;
        tellFrame(frame === frames.a ? frames.b : frames.a, { type: PARENT_MESSAGE.scrollTo, ratio: message.ratio });
      },
    }),
  );
}

function CompareFrame({ side, url }: { side: Side; url: string }) {
  return (
    <iframe
      ref={(el) => {
        frames[side] = el;
      }}
      title={`${SIDE_LABEL[side]}: ${hostOf(url)}`}
      src={frameSrc({ url })}
      sandbox={FRAME_SANDBOX}
      onLoad={(e) => tellFrame(e.currentTarget, { type: PARENT_MESSAGE.scrollSync, on: true })}
      class="block h-full w-full border-none bg-white"
    />
  );
}

function FrameLabel({ side, url }: { side: Side; url: string }) {
  return (
    <div class="text-meta flex h-8 min-w-0 items-center gap-2 px-3 text-(--ds-gray-900)">
      <span class="font-medium text-(--ds-gray-1000)">{SIDE_LABEL[side]}</span>
      <span class="truncate">{hostOf(url)}</span>
    </div>
  );
}

function SideBySide({ a, b }: { a: string; b: string }) {
  return (
    <div class="grid min-h-0 flex-1 grid-cols-2 divide-x divide-(--ds-gray-alpha-400)">
      <div class="flex min-h-0 min-w-0 flex-col">
        <FrameLabel side="a" url={a} />
        <div class="min-h-0 flex-1">
          <CompareFrame side="a" url={a} />
        </div>
      </div>
      <div class="flex min-h-0 min-w-0 flex-col">
        <FrameLabel side="b" url={b} />
        <div class="min-h-0 flex-1">
          <CompareFrame side="b" url={b} />
        </div>
      </div>
    </div>
  );
}

const overlayLabel =
  'pointer-events-none absolute top-2 rounded-md bg-(--ds-background-100) [box-shadow:var(--ds-shadow-border-small)]';

function SliderOverlay({ a, b }: { a: string; b: string }) {
  const dragging = useSignal(false);
  const move = (e: PointerEvent) => {
    const box = e.currentTarget instanceof HTMLElement ? e.currentTarget.parentElement?.getBoundingClientRect() : null;
    if (!dragging.value || !box || box.width === 0) return;
    split.value = Math.max(0, Math.min(100, ((e.clientX - box.left) / box.width) * 100));
  };
  const key = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 10 : 2;
    if (e.key === 'ArrowLeft') split.value = Math.max(0, split.value - step);
    else if (e.key === 'ArrowRight') split.value = Math.min(100, split.value + step);
    else return;
    e.preventDefault();
  };
  return (
    <div class="relative min-h-0 flex-1">
      <div class="absolute inset-0">
        <CompareFrame side="a" url={a} />
      </div>
      {/* clip-path also clips hit-testing, so the wheel reaches A left of the divider and B right of it. */}
      <div class="absolute inset-0" style={{ clipPath: `inset(0 0 0 ${split.value}%)` }}>
        <CompareFrame side="b" url={b} />
      </div>
      <div class={cn(overlayLabel, 'left-2')}>
        <FrameLabel side="a" url={a} />
      </div>
      <div class={cn(overlayLabel, 'right-2')}>
        <FrameLabel side="b" url={b} />
      </div>
      <div
        role="slider"
        tabIndex={0}
        aria-label="Reveal the after page"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(split.value)}
        class="group absolute top-0 bottom-0 z-10 flex w-6 -translate-x-1/2 cursor-ew-resize touch-none justify-center outline-none"
        style={{ left: `${split.value}%` }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          dragging.value = true;
        }}
        onPointerMove={move}
        onPointerUp={() => {
          dragging.value = false;
        }}
        onPointerCancel={() => {
          dragging.value = false;
        }}
        onKeyDown={key}
      >
        <div class="h-full w-0.5 rounded-full bg-(--ds-gray-1000) group-focus-visible:bg-(--ds-focus-color)" />
        <div class="absolute top-1/2 h-9 w-3 -translate-y-1/2 rounded-full bg-(--ds-gray-1000)" />
      </div>
    </div>
  );
}

function UrlField({
  id,
  label,
  value,
  onInput,
  autoFocus,
}: {
  id: string;
  label: string;
  value: string;
  onInput: (v: string) => void;
  autoFocus?: boolean;
}) {
  return (
    <div class="flex min-w-0 flex-1 flex-col gap-1">
      <label class="text-meta font-medium text-(--ds-gray-900)" for={id}>
        {label}
      </label>
      <div class={cn(geist.field, 'flex h-10 items-center px-3')}>
        <input
          id={id}
          type="text"
          inputMode="url"
          autocomplete="off"
          spellcheck={false}
          placeholder="staging.example.com"
          value={value}
          // The field the visitor came to fill: the link from a room pre-fills the other one.
          ref={(el) => {
            if (autoFocus) el?.focus();
          }}
          onInput={(e) => onInput(e.currentTarget.value)}
          /* 16px, not the text-ui step: iOS Safari zooms into any focused input below it. */
          class={cn(geist.input, 'w-full text-base')}
        />
      </div>
    </div>
  );
}

function CompareBar({ a, b, compared }: { a: string; b: string; compared: boolean }) {
  const [, navigate] = useLocation();
  const draftA = useSignal(a);
  const draftB = useSignal(b);
  const error = useSignal<string | null>(null);

  const submit = (e: JSX.TargetedEvent<HTMLFormElement, Event>) => {
    e.preventDefault();
    const nextA = parseCompareUrl(draftA.value);
    const nextB = parseCompareUrl(draftB.value);
    if (!nextA || !nextB) {
      error.value = 'Enter two web addresses starting with http or https.';
      return;
    }
    error.value = null;
    navigate(`/compare?${new URLSearchParams({ a: nextA, b: nextB })}`);
  };

  return (
    <header class={cn(geist.bar, 'px-4 py-3')}>
      <form class="flex flex-wrap items-end gap-3" onSubmit={submit}>
        <a href="/" class="mb-2 flex h-6 shrink-0 items-center" aria-label="MarkLayer home">
          <Logo size={20} />
        </a>
        <UrlField
          id="ml-cmp-a"
          label={SIDE_LABEL.a}
          value={draftA.value}
          onInput={(v) => (draftA.value = v)}
          autoFocus={!a}
        />
        <UrlField
          id="ml-cmp-b"
          label={SIDE_LABEL.b}
          value={draftB.value}
          onInput={(v) => (draftB.value = v)}
          autoFocus={Boolean(a) && !b}
        />
        <button type="submit" class={cn(submitBtn, 'h-10')}>
          Compare
        </button>
        {/* Layout is a choice about two pages on screen; before there are two, it is noise. */}
        {compared && (
          <ToggleGroup
            value={[mode.value]}
            onValueChange={(next: Mode[]) => {
              if (next[0]) mode.value = next[0];
            }}
            aria-label="Layout"
            className={cn(geist.track, 'mb-0.5')}
          >
            {MODES.map((m) => (
              <Toggle key={m.value} value={m.value} className={geist.segmentText}>
                {m.label}
              </Toggle>
            ))}
          </ToggleGroup>
        )}
      </form>
      {error.value ? (
        <p role="alert" class="text-meta mt-2 text-(--ds-red-700)">
          {error.value}
        </p>
      ) : null}
    </header>
  );
}

/** Two pages, one scroll. Read-only: annotating stays in the normal viewer. */
export function ComparePage() {
  useScrollRelay();
  const params = new URLSearchParams(useSearch());
  const rawA = params.get('a') ?? '';
  const rawB = params.get('b') ?? '';
  const a = parseCompareUrl(rawA);
  const b = parseCompareUrl(rawB);
  return (
    <div class="flex h-dvh flex-col bg-(--ds-background-100)">
      {/* Keyed on the pair so a submit re-seeds the drafts from the address bar. */}
      <CompareBar key={`${rawA}|${rawB}`} a={rawA} b={rawB} compared={Boolean(a && b)} />
      {a && b ? (
        mode.value === 'side' ? (
          <SideBySide a={a} b={b} />
        ) : (
          <SliderOverlay a={a} b={b} />
        )
      ) : (
        <div class="m-auto max-w-[360px] px-6 text-center">
          <p class="text-ui font-medium text-(--ds-gray-1000)">Two versions of a page, side by side.</p>
          <p class="text-ui mt-1 text-(--ds-gray-900)">
            Paste the live page and the changed one. They scroll together, and the slider wipes one over the other.
          </p>
        </div>
      )}
    </div>
  );
}
