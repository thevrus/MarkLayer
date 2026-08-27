import { useCallback, useLayoutEffect, useRef, useState } from 'preact/hooks';

/**
 * Keep a floating panel inside the viewport as its own height changes.
 *
 * Callers position a popover from the thing it points at, which is fine until the
 * panel grows — a field opening, a long quote wrapping — and its actions fall off
 * the bottom edge. The ResizeObserver is the point: a fixed offset guessed at
 * mount goes stale the moment the content changes. Clamping runs in a layout
 * effect so the corrected position is painted, never a jump.
 */
const EDGE_MARGIN = 8;

export function useEdgeClamp({ top }: { top: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [clampedTop, setClampedTop] = useState(top);
  // The requested position is read through a ref so moving the anchor does not
  // tear down and rebuild the observer below.
  const topRef = useRef(top);

  const fit = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setClampedTop(Math.max(EDGE_MARGIN, Math.min(topRef.current, window.innerHeight - el.offsetHeight - EDGE_MARGIN)));
  }, []);

  // Both triggers outlive any single position: the observer catches the panel's
  // own growth, the listener catches a viewport that shrank under a panel whose
  // box never changed — which the observer alone would miss.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    window.addEventListener('resize', fit);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', fit);
    };
  }, [fit]);

  useLayoutEffect(() => {
    topRef.current = top;
    fit();
  }, [top, fit]);

  return { ref, top: clampedTop };
}
