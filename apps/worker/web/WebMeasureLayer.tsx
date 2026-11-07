import { MeasureOverlayContent, type MeasureState, measureKeys } from '@ext/components/MeasureLayer';
import { injectCrosshairCursor } from '@ext/lib/dom';
import { useDismissible } from '@ext/lib/keymap';
import { measureActive, measureToolActive } from '@ext/lib/tool-state';
import { useComputed, useSignal, useSignalEffect } from '@preact/signals';
import { nanoid } from 'nanoid';
import { createPortal } from 'preact/compat';
import { tinykeys } from 'tinykeys';
import { capture } from './analytics';
import { isElementNode, rectsEqual, toViewportRect, useIframeOverlay, useIframeRectSync } from './iframeOverlay';

/** The keys that walk the element tree, which scroll the page or move its focus if nothing stops them. */
const WALK_KEYS = new Set(['Tab', 'ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft']);

export function WebMeasureLayer({ frameRef }: { frameRef: { current: HTMLIFrameElement | null } }) {
  const anchors = useSignal<MeasureState[]>([]);
  const hover = useSignal<MeasureState | null>(null);

  useIframeOverlay(frameRef, ({ win, doc, frame }) => {
    const isHost = (el: Element) => el === doc.documentElement || el === doc.body;
    const isAnchored = (el: Element) => anchors.peek().some((a) => a.el === el);

    const onMove = (e: MouseEvent) => {
      if (!measureActive.value) return;
      const el = isElementNode(e.target) ? e.target : null;
      if (!el || isHost(el) || isAnchored(el)) {
        hover.value = null;
        return;
      }
      if (el === hover.peek()?.el) return;
      hover.value = { id: 'hover', el, rect: toViewportRect(frame, el) };
    };

    const onClick = (e: MouseEvent) => {
      if (!measureToolActive.value) return;
      const el = isElementNode(e.target) ? e.target : null;
      if (!el || isHost(el)) return;
      e.preventDefault();
      e.stopPropagation();
      const cur = anchors.peek();
      const existing = cur.findIndex((a) => a.el === el);
      if (existing >= 0) {
        anchors.value = cur.filter((_, i) => i !== existing);
      } else {
        anchors.value = [...cur, { id: nanoid(), el, rect: toViewportRect(frame, el) }];
        capture('measure_anchor_pinned', { anchors: cur.length + 1 });
        hover.value = null;
      }
    };

    // The walk runs on the host, where a replayed key cannot stop the frame's real one from scrolling.
    const onKeyDown = (e: KeyboardEvent) => {
      if (!WALK_KEYS.has(e.key) || !measureToolActive.value || !anchors.peek().length) return;
      // By tag, not `editableTarget`: an element in the frame fails the host realm's instanceof.
      const typing = isElementNode(e.target) && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
      if (!typing && !doc.activeElement?.closest('[contenteditable]')) e.preventDefault();
    };

    // Escape goes through the dismisser stack below, so one press does one thing.
    const { Escape: _, ...keyBindings } = measureKeys({
      anchors,
      hover,
      skip: isHost,
      rectOf: (el) => toViewportRect(frame, el),
    });

    win.addEventListener('mousemove', onMove, true);
    win.addEventListener('click', onClick, true);
    win.addEventListener('keydown', onKeyDown, true);
    // Keys in the frame reach the host window as `ml-key`, so this hears both sides.
    const unbindKeys = tinykeys(window, keyBindings);
    return () => {
      try {
        win.removeEventListener('mousemove', onMove, true);
        win.removeEventListener('click', onClick, true);
        win.removeEventListener('keydown', onKeyDown, true);
      } catch {
        /* iframe may have navigated cross-origin */
      }
      unbindKeys();
    };
  });

  useDismissible({
    open: useComputed(() => measureToolActive.value && anchors.value.length > 0),
    close: () => {
      capture('measure_cleared', { anchors: anchors.peek().length });
      anchors.value = [];
    },
  });

  // Pinned anchors belong to the tool; the hover readout also runs on a held Alt.
  useSignalEffect(() => {
    if (measureToolActive.value) return;
    anchors.value = [];
  });

  useSignalEffect(() => {
    if (measureActive.value) return;
    hover.value = null;
  });

  useIframeRectSync(
    () => measureActive.value,
    () => {
      const frame = frameRef.current;
      if (!frame) return;
      const refresh = (cur: MeasureState | null): MeasureState | null => {
        if (!cur) return null;
        if (!cur.el.isConnected) return null;
        const next = toViewportRect(frame, cur.el);
        if (rectsEqual(next, cur.rect)) return cur;
        return { ...cur, rect: next };
      };
      const curAnchors = anchors.peek();
      let changed = false;
      const nextAnchors: MeasureState[] = [];
      for (const a of curAnchors) {
        const r = refresh(a);
        if (!r) {
          changed = true;
          continue;
        }
        if (r !== a) changed = true;
        nextAnchors.push(r);
      }
      if (changed) anchors.value = nextAnchors;
      const h = refresh(hover.peek());
      if (h !== hover.peek()) hover.value = h;
    },
  );

  // Only the real tool takes the cursor — a held Alt must not restyle the framed
  // page out from under whatever tool is actually selected.
  useSignalEffect(() => {
    if (!measureToolActive.value) return;
    return injectCrosshairCursor(frameRef.current?.contentDocument);
  });

  if (!measureActive.value) return null;

  const frame = frameRef.current;
  return createPortal(
    <MeasureOverlayContent
      anchors={anchors.value}
      hover={hover.value}
      viewport={{ left: 0, top: 0, width: window.innerWidth, height: window.innerHeight }}
      getContainerRect={(el) => {
        if (!frame) return null;
        const doc = frame.contentDocument;
        const p = el.parentElement;
        if (!p || !doc || p === doc.body || p === doc.documentElement) return null;
        return toViewportRect(frame, p);
      }}
    />,
    document.body,
  );
}
