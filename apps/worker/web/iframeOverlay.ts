import { captureTarget, pickElementAtPoint } from '@ext/lib/selector';
import type { CaptureViewport, Point, TargetElement } from '@marklayer/types';
import { useSignalEffect } from '@preact/signals';
import { useEffect, useRef } from 'preact/hooks';
import { cssScale, iframeScrollY } from './signals';

// Cross-realm: iframe DOM nodes are instances of the iframe's Element, not the host's,
// so `e.target instanceof Element` always returns false. Check nodeType instead.
export function isElementNode(v: EventTarget | null): v is Element {
  return v !== null && 'nodeType' in v && v.nodeType === 1;
}

/** Translate an iframe-local element rect to host viewport coords (accounts for cssScale). */
export function toViewportRect(frame: HTMLIFrameElement, el: Element): DOMRect {
  const fr = frame.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  const s = cssScale.value;
  return new DOMRect(fr.left + r.left * s, fr.top + r.top * s, r.width * s, r.height * s);
}

/**
 * The viewport an annotation was captured in. That is the framed page's own
 * viewport, not the host window's — the host chrome and the CSS zoom are ours,
 * not the annotated page's, so recording them would misdescribe the capture.
 */
export function frameViewport(frame: HTMLIFrameElement | null): CaptureViewport {
  const win = frame?.contentWindow;
  return win
    ? { width: win.innerWidth, height: win.innerHeight }
    : { width: window.innerWidth, height: window.innerHeight };
}

/**
 * Bind a point in the framed page's document space to the element under it, so
 * the op re-anchors on reflow. `anchor` defaults to the same point; pass it when
 * the op's anchor differs from the point worth hit-testing (an area rect is
 * picked at its centre but anchored to its top-left).
 */
export function pickFrameTarget({
  frame,
  x,
  y,
  anchor,
}: {
  frame: HTMLIFrameElement | null;
  x: number;
  y: number;
  anchor?: Point;
}): TargetElement | undefined {
  const win = frame?.contentWindow;
  const doc = frame?.contentDocument;
  if (!win || !doc) return undefined;
  const el = pickElementAtPoint(x - win.scrollX, y - win.scrollY, doc);
  return el ? captureTarget({ el, anchor: anchor ?? { x, y } }) : undefined;
}

interface RectLike {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Translate iframe-local rects (e.g. from `Range.getClientRects`) to host viewport coords. */
export function toViewportRects(frame: HTMLIFrameElement, rects: ArrayLike<RectLike>): RectLike[] {
  const fr = frame.getBoundingClientRect();
  const s = cssScale.value;
  const out: RectLike[] = [];
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    out.push({ x: fr.left + r.x * s, y: fr.top + r.y * s, width: r.width * s, height: r.height * s });
  }
  return out;
}

export function rectsEqual(a: DOMRectReadOnly, b: DOMRectReadOnly): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

export interface IframeOverlayCtx {
  win: Window;
  doc: Document;
  frame: HTMLIFrameElement;
}

/**
 * Attach event listeners to the iframe's contentWindow. Reattaches on iframe navigation.
 * The `attach` callback owns its own listener registration and returns a cleanup function.
 */
export function useIframeOverlay(
  frameRef: { current: HTMLIFrameElement | null },
  attach: (ctx: IframeOverlayCtx) => () => void,
) {
  const attachRef = useRef(attach);
  attachRef.current = attach;

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;

    let detach: (() => void) | undefined;

    const setup = () => {
      const win = frame.contentWindow;
      const doc = frame.contentDocument;
      if (!win || !doc) return;
      detach = attachRef.current({ win, doc, frame });
    };

    setup();
    const onLoad = () => {
      detach?.();
      setup();
    };
    frame.addEventListener('load', onLoad);
    return () => {
      detach?.();
      frame.removeEventListener('load', onLoad);
    };
  }, [frameRef]);
}

/**
 * rAF-batch a refresh callback whenever the iframe scrolls, content rescales, or the window resizes.
 * Subscription is gated on `active()` so tools only listen while engaged.
 */
export function useIframeRectSync(active: () => boolean, refresh: () => void) {
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useSignalEffect(() => {
    if (!active()) return;
    let raf = 0;
    const sync = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => refreshRef.current());
    };
    const unsubScroll = iframeScrollY.subscribe(sync);
    const unsubScale = cssScale.subscribe(sync);
    window.addEventListener('resize', sync);
    return () => {
      cancelAnimationFrame(raf);
      unsubScroll();
      unsubScale();
      window.removeEventListener('resize', sync);
    };
  });
}
