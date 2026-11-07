import { pointerSampler } from '@ext/lib/pointer';
import { activeTool, isDrawingTool } from '@ext/lib/tool-state';
import { cn } from '@marklayer/ui/cn';
import { useSignal, useSignalEffect } from '@preact/signals';
import { useEffect, useRef } from 'preact/hooks';
import { DEMO_ROOM } from '../../shared/demo-room';
import { FRAME_MESSAGE, onFrameMessage } from '../../shared/frame-protocol';
import { embedInView, isMobileDevice } from './landing-state';

const POSTER_ALT =
  'MarkLayer open on the Wikipedia article for Web annotation. The opening sentence is highlighted in pink, an arrow is drawn from the text toward the language switcher, and a numbered comment pin sits on the title. The MarkLayer toolbar floats over the page and the share bar shows one other person online.';

/** The poster stays this long at most, so a page that never answers cannot hide the board. */
const REVEAL_CAP_MS = 10_000;

/**
 * The shared public board, embedded where the screenshot used to be: the real
 * viewer on the real Wikipedia page, so a visitor draws with the actual product
 * and sees everyone else who is on the landing page doing the same. The
 * screenshot stays as the poster until the page inside has painted.
 */
export function DemoWindow() {
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const revealCap = useRef<ReturnType<typeof setTimeout> | null>(null);
  const live = useSignal(false);
  const ready = useSignal(false);

  // Mount the room as it approaches; a visitor who never scrolls here pays nothing.
  useEffect(() => {
    const el = box.current;
    if (isMobileDevice() || !el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        live.value = true;
        io.disconnect();
      },
      { rootMargin: '600px 0px' },
    );
    io.observe(el);
    const half = new IntersectionObserver(
      (entries) => {
        for (const e of entries) embedInView.value = e.isIntersecting;
      },
      { threshold: 0.5 },
    );
    half.observe(el);
    return () => {
      io.disconnect();
      half.disconnect();
      embedInView.value = false;
    };
  }, [live]);

  // The landing's own overlays cover the whole document while a tool is held,
  // so the frame would never see the pointer. Crossing into the window drops
  // the tool, and the overlays go inert with it.
  useEffect(() => {
    // One rect read per frame, not per event — each forces layout on an idle page.
    let sampler: ReturnType<typeof pointerSampler> | null = null;
    const test = (x: number, y: number) => {
      const r = box.current?.getBoundingClientRect();
      if (!r) return;
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) activeTool.value = 'navigate';
    };
    const onMove = (e: PointerEvent) => {
      if (!live.value || !isDrawingTool(activeTool.peek())) return;
      sampler ??= pointerSampler({ event: e, onFrame: test });
      sampler.sample(e);
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      sampler?.cancel();
    };
  }, [live]);

  // `load` fires for the app shell, long before the page under review is on
  // screen; the room says when it has revealed one.
  useSignalEffect(() => {
    const stop = onFrameMessage({
      frames: () => [frame.current],
      handler: ({ message }) => {
        if (message.type === FRAME_MESSAGE.ready) ready.value = true;
      },
    });
    return () => {
      stop();
      if (revealCap.current) clearTimeout(revealCap.current);
    };
  });

  const onLoad = () => {
    revealCap.current = setTimeout(() => {
      ready.value = true;
    }, REVEAL_CAP_MS);
  };

  return (
    <div ref={box} class="relative min-h-0 flex-1 bg-white">
      <img
        src="/product-review-wikipedia.webp"
        width={1440}
        height={900}
        alt={ready.value ? '' : POSTER_ALT}
        aria-hidden={ready.value}
        loading="lazy"
        decoding="async"
        class="absolute inset-0 block h-full w-full object-cover object-top"
      />
      {live.value && (
        <iframe
          ref={frame}
          // `still`: the page inside does not scroll, so a wheel over the window
          // moves this page. Two scrollers nested in one screen was confusing.
          src={`/s/${DEMO_ROOM.id}?still=1`}
          title="Live MarkLayer board on the Wikipedia article for Web annotation. Draw on it; everyone on this page sees it."
          onLoad={onLoad}
          class={cn(
            'absolute inset-0 h-full w-full border-0 bg-transparent transition-opacity duration-300',
            ready.value ? 'opacity-100' : 'opacity-0',
          )}
        />
      )}
    </div>
  );
}
