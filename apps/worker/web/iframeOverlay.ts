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
