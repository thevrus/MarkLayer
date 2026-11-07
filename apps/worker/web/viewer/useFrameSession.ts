import { animationsFrozen, freezeDocument, thawDocument } from '@ext/lib/freeze';
import { onCursorMove } from '@ext/lib/presence';
import { emitRipple } from '@ext/lib/realtime';
import { findPageScroller, notePageScroller, scrollOffset, scrollPageBy, scrollPageTo } from '@ext/lib/scroller';
import { activeTool, panScrollBy } from '@ext/lib/tool-state';
import { useSignalEffect } from '@preact/signals';
import { useRef } from 'preact/hooks';
import { sameOriginWindow, useIframeOverlay } from '../iframeOverlay';
import { followingPeer, onFollowScroll, presenting } from '../ui-state';
import { attachIframeMutationObserver, cssScale, iframeScrollY } from '../viewer-state';

/** Quiet time after which a programmatic scroll counts as finished. */
const SCROLL_SETTLE_MS = 150;

/** Everything that listens inside the framed page: scroll, follow, cursor, mutations, freeze. */
export function useFrameSession({ frameRef }: { frameRef: { current: HTMLIFrameElement | null } }) {
  // The settings panel's freeze only reaches the host document, so re-apply it inside the frame,
  // and again on `load` since navigating the proxied page swaps the document.
  useSignalEffect(() => {
    if (!animationsFrozen.value) return;
    const frame = frameRef.current;
    const doc = frame?.contentDocument;
    if (doc) freezeDocument(doc);
    const onLoad = () => {
      const next = frame?.contentDocument;
      if (next && animationsFrozen.peek()) freezeDocument(next);
    };
    frame?.addEventListener('load', onLoad);
    return () => {
      frame?.removeEventListener('load', onLoad);
      const cur = frame?.contentDocument;
      if (cur) thawDocument(cur);
    };
  });

  const programmaticScroll = useRef(false);
  /** Clears `programmaticScroll` once scrolling has actually stopped, not on a fixed timer. */
  const scrollSettle = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Last cursor X inside the frame, so a presenter's scroll-only update keeps a sane X. */
  const lastCursorX = useRef(0);

  useIframeOverlay(frameRef, ({ win, doc }) => {
    const detachMutations = attachIframeMutationObserver(doc);
    findPageScroller(doc);

    const onScroll = (e: Event) => {
      notePageScroller(doc, e.target);
      iframeScrollY.value = scrollOffset(win).y;
      // Break follow mode on user-initiated scroll. The programmatic flag is
      // held open until scrolling actually stops rather than for a fixed
      // window: a smooth scroll across a long page outlives any timer started
      // when it began, and the late events would read as the user taking over
      // and break the follow that caused them.
      if (programmaticScroll.current) {
        if (scrollSettle.current) clearTimeout(scrollSettle.current);
        scrollSettle.current = setTimeout(() => {
          programmaticScroll.current = false;
          scrollSettle.current = null;
        }, SCROLL_SETTLE_MS);
      } else if (followingPeer.value) {
        followingPeer.value = null;
      }
      // Followers ride the presenter's cursor Y, and the cursor only emits on
      // mousemove — so a presenter who scrolls without moving the mouse would
      // move nobody. Emit the viewport centre instead, which is where
      // `onFollowScroll` lands them, so the two viewports show the same content.
      if (presenting.value) {
        onCursorMove.value?.(lastCursorX.current, scrollOffset(win).y + win.innerHeight / 2, activeTool.value);
      }
    };
    const breakFollow = () => {
      if (followingPeer.value) followingPeer.value = null;
    };
    const onMouseDown = (e: MouseEvent) => {
      breakFollow();
      if (e.button !== 0) return;
      emitRipple.value?.(e.clientX, e.clientY + scrollOffset(win).y);
    };
    // Peers see the cursor even when the navigate tool leaves the page on top.
    const onMouseMove = (e: MouseEvent) => {
      lastCursorX.current = e.clientX;
      onCursorMove.value?.(e.clientX, e.clientY + scrollOffset(win).y, activeTool.value);
    };

    // Capture phase, because a page that scrolls an inner container instead
    // of its document fires `scroll` at that element and it never bubbles to
    // the window — the drawings then sat still while the content moved.
    const scrollOptions = { capture: true, passive: true };
    win.addEventListener('scroll', onScroll, scrollOptions);
    win.addEventListener('mousedown', onMouseDown);
    win.addEventListener('wheel', breakFollow, { passive: true });
    win.addEventListener('mousemove', onMouseMove);
    return () => {
      detachMutations();
      try {
        win.removeEventListener('scroll', onScroll, scrollOptions);
        win.removeEventListener('mousedown', onMouseDown);
        win.removeEventListener('wheel', breakFollow);
        win.removeEventListener('mousemove', onMouseMove);
      } catch {
        /* the frame has navigated out of the proxy */
      }
    };
  });

  // These outlive any one page in the frame, so they look its window up on each call.
  useSignalEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    // Hand tool: the framed page is its own scroller, and it sits behind a CSS
    // scale, so a screen-space drag delta has to be divided back out.
    panScrollBy.value = (dx: number, dy: number) => {
      const w = sameOriginWindow(frame);
      if (!w) return;
      const s = cssScale.peek() || 1;
      scrollPageBy(w, dx / s, dy / s);
    };
    // The flag is cleared by the scroll handler once the events stop, so a
    // scroll of any length stays recognised as ours for its whole duration.
    onFollowScroll.value = (y: number) => {
      const w = sameOriginWindow(frame);
      if (!w) return;
      programmaticScroll.current = true;
      if (scrollSettle.current) clearTimeout(scrollSettle.current);
      scrollPageTo(w, { top: Math.max(0, y - w.innerHeight / 2), behavior: 'smooth' });
    };
    return () => {
      onFollowScroll.value = null;
      panScrollBy.value = null;
      if (scrollSettle.current) clearTimeout(scrollSettle.current);
    };
  });
}
