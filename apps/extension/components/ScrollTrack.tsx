import { cn } from '@marklayer/types';
import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';

/**
 * A row of controls wider than the panel holding it. Two problems it solves,
 * both of which read as broken rather than designed:
 *
 * - the last control sliced flat by the container edge, with nothing saying the
 *   row continues. The overflowing side is feathered instead, and only while it
 *   actually overflows, so a row that fits keeps its final item at full ink.
 * - a selection left half outside the band. When `activeKey` changes the pressed
 *   child is brought fully inside it by moving this element's own `scrollLeft`,
 *   not by `scrollIntoView`, which would pan every scrollable ancestor too.
 *   The child is found by `[data-pressed]`, which `geist.segment*` already
 *   requires for its selected styling — a track whose children don't set it
 *   still feathers, it just never scrolls itself.
 */
const FADE = 24;
const FADE_PX = `${FADE}px`;
const FEATHER =
  'linear-gradient(to right, transparent 0, #000 var(--fade-start, 0px), #000 calc(100% - var(--fade-end, 0px)), transparent 100%)';

export function ScrollTrack({
  activeKey,
  children,
  class: cls,
}: {
  activeKey?: string;
  children: ComponentChildren;
  class?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // The scroller's own box does not change when a label or a count widens the
  // row inside it, so the content is observed too — otherwise a stale feather
  // lands as a hard edge on live content. Custom properties are written straight
  // to the node, and only when they change, so scrolling never renders.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let max = 0;
    let painted = '';
    const paint = () => {
      // 1px of slack: fractional layout widths leave a sub-pixel remainder that
      // would otherwise feather a row with nothing left to reveal.
      const start = el.scrollLeft > 1 ? FADE_PX : '0px';
      const end = el.scrollLeft < max - 1 ? FADE_PX : '0px';
      if (painted === `${start} ${end}`) return;
      painted = `${start} ${end}`;
      el.style.setProperty('--fade-start', start);
      el.style.setProperty('--fade-end', end);
    };
    const measure = () => {
      max = el.scrollWidth - el.clientWidth;
      paint();
    };
    measure();
    el.addEventListener('scroll', paint, { passive: true });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    for (const child of Array.from(el.children)) ro.observe(child);
    return () => {
      el.removeEventListener('scroll', paint);
      ro.disconnect();
    };
  }, []);

  // The tab you just clicked can be the one clipped by the feather, so the
  // selection is pulled clear of both edges rather than left half-faded.
  useEffect(() => {
    const el = ref.current;
    const active = el?.querySelector('[data-pressed]');
    if (!el || !(active instanceof HTMLElement)) return;
    const start = active.offsetLeft - FADE;
    const end = active.offsetLeft + active.offsetWidth + FADE - el.clientWidth;
    if (start < el.scrollLeft) el.scrollTo({ left: start, behavior: 'smooth' });
    else if (end > el.scrollLeft) el.scrollTo({ left: end, behavior: 'smooth' });
  }, [activeKey]);

  // The gradient carries commas, spaces and a calc(), none of which survive
  // Tailwind's arbitrary-value syntax, so it is set as a style.
  return (
    <div
      ref={ref}
      class={cn('overflow-x-auto overscroll-x-contain scrollbar-none [&::-webkit-scrollbar]:hidden', cls)}
      style={{ maskImage: FEATHER, WebkitMaskImage: FEATHER }}
    >
      {children}
    </div>
  );
}
