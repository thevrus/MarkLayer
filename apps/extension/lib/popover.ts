import type { RefObject } from 'preact';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { tinykeys } from 'tinykeys';

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

/**
 * Escape-anywhere and let-go-of-the-selection dismissal for a popover that opened
 * on its own off a text selection.
 *
 * A popover the user summoned focuses a field, so Escape reaches it and clicking
 * away is a deliberate act. One that opened by itself must leave focus and the
 * page selection alone — otherwise merely highlighting a sentence to read or copy
 * it steals both — which costs it exactly those two exits. This owns both halves
 * of that rule, focus included, so the two popovers cannot disagree about it.
 */
export function useSelectionDismiss({
  auto,
  doc,
  focusRef,
  onDismiss,
}: {
  /** Opened by the selection alone rather than by arming the selection tool. */
  auto: boolean;
  /** Document holding the watched selection — an iframe's, when the page is proxied. */
  doc?: Document | null;
  /** The field a summoned popover takes the caret with. */
  focusRef: RefObject<HTMLTextAreaElement>;
  onDismiss: () => void;
}) {
  const engaged = useRef(false);
  // Read through a ref so a new closure each render doesn't rebind the listeners.
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;

  // Only a popover the user asked for takes the caret. Opened off a bare
  // highlight, focusing would collapse the selection and swallow the Cmd+C of
  // someone who was only copying a line.
  useEffect(() => {
    if (!auto) focusRef.current?.focus();
  }, [auto, focusRef]);

  useEffect(() => {
    if (!auto) return;
    engaged.current = false;
    const target = doc ?? document;

    // `isCollapsed` alone: this fires on every tick of a drag-select, and
    // serializing a growing selection each time is work for an answer the
    // collapse flag already gives.
    const onSelectionChange = () => {
      if (engaged.current) return;
      const sel = target.getSelection();
      if (!sel || sel.isCollapsed) dismiss.current();
    };

    // Both windows: with focus still in the proxied frame the keystroke never
    // reaches the host, and with focus in our chrome it never reaches the frame.
    const view = target.defaultView;
    const wins = view && view !== window ? [window, view] : [window];

    target.addEventListener('selectionchange', onSelectionChange);
    const unbind = wins.map((w) =>
      tinykeys(w, {
        Escape: (e) => {
          e.preventDefault();
          dismiss.current();
        },
      }),
    );
    return () => {
      target.removeEventListener('selectionchange', onSelectionChange);
      for (const off of unbind) off();
    };
  }, [auto, doc]);

  return {
    /**
     * Spread onto the panel. The moment the user commits to it, its own fields
     * take focus and collapse the very selection being watched, so the collapse
     * rule has to stop applying rather than close the panel under them.
     */
    panelProps: {
      onPointerDown: () => {
        engaged.current = true;
      },
      onFocusIn: () => {
        engaged.current = true;
      },
    },
  };
}
