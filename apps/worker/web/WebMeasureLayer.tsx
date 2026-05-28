import { MeasureOverlayContent, type MeasureState } from '@ext/components/MeasureLayer';
import { injectCrosshairCursor } from '@ext/lib/dom';
import { nextAnchorElement, type TraverseDir } from '@ext/lib/measure';
import { activeTool } from '@ext/lib/state';
import { useSignal, useSignalEffect } from '@preact/signals';
import { nanoid } from 'nanoid';
import { createPortal } from 'preact/compat';
import { tinykeys } from 'tinykeys';
import { isElementNode, rectsEqual, toViewportRect, useIframeOverlay, useIframeRectSync } from './iframeOverlay';

export function WebMeasureLayer({ frameRef }: { frameRef: { current: HTMLIFrameElement | null } }) {
  const anchors = useSignal<MeasureState[]>([]);
  const hover = useSignal<MeasureState | null>(null);
  const altPressed = useSignal(false);

  useIframeOverlay(frameRef, ({ win, doc, frame }) => {
    const isHost = (el: Element) => el === doc.documentElement || el === doc.body;
    const isAnchored = (el: Element) => anchors.peek().some((a) => a.el === el);

    const onMove = (e: MouseEvent) => {
      if (activeTool.value !== 'measure') return;
      const el = isElementNode(e.target) ? e.target : null;
      if (!el || isHost(el) || isAnchored(el)) {
        hover.value = null;
        return;
      }
      if (el === hover.peek()?.el) return;
      hover.value = { id: 'hover', el, rect: toViewportRect(frame, el) };
    };

    const onClick = (e: MouseEvent) => {
      if (activeTool.value !== 'measure') return;
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
        hover.value = null;
      }
    };

    const traverse = (dir: TraverseDir) => {
      const cur = anchors.peek();
      const primary = cur[cur.length - 1];
      if (!primary) return false;
      const next = nextAnchorElement(primary.el, dir, isHost);
      if (!next) return false;
      anchors.value = [...cur.slice(0, -1), { id: primary.id, el: next, rect: toViewportRect(frame, next) }];
      hover.value = null;
      return true;
    };

    const tryTraverse = (e: KeyboardEvent, dir: TraverseDir) => {
      if (activeTool.value !== 'measure') return;
      if (!traverse(dir)) return;
      e.preventDefault();
      e.stopPropagation();
    };

    const popPrimary = (e: KeyboardEvent) => {
      if (activeTool.value !== 'measure' || !anchors.peek().length) return;
      e.preventDefault();
      e.stopPropagation();
      anchors.value = anchors.peek().slice(0, -1);
    };
    const keyBindings = {
      Alt: () => {
        if (activeTool.value === 'measure') altPressed.value = true;
      },
      Escape: (e: KeyboardEvent) => {
        if (activeTool.value !== 'measure' || !anchors.peek().length) return;
        e.preventDefault();
        e.stopPropagation();
        anchors.value = [];
      },
      Backspace: popPrimary,
      Delete: popPrimary,
      Tab: (e: KeyboardEvent) => tryTraverse(e, 'parent'),
      'Shift+Tab': (e: KeyboardEvent) => tryTraverse(e, 'child'),
      ArrowDown: (e: KeyboardEvent) => tryTraverse(e, 'next'),
      ArrowRight: (e: KeyboardEvent) => tryTraverse(e, 'next'),
      ArrowUp: (e: KeyboardEvent) => tryTraverse(e, 'prev'),
      ArrowLeft: (e: KeyboardEvent) => tryTraverse(e, 'prev'),
    };
    const keyBindingsUp = {
      Alt: () => {
        altPressed.value = false;
      },
    };

    win.addEventListener('mousemove', onMove, true);
    win.addEventListener('click', onClick, true);
    const unbindWinDown = tinykeys(win as Window, keyBindings);
    const unbindWinUp = tinykeys(win as Window, keyBindingsUp, { event: 'keyup' });
    const unbindHostDown = tinykeys(window, keyBindings);
    const unbindHostUp = tinykeys(window, keyBindingsUp, { event: 'keyup' });
    return () => {
      try {
        win.removeEventListener('mousemove', onMove, true);
        win.removeEventListener('click', onClick, true);
        unbindWinDown();
        unbindWinUp();
      } catch {
        /* iframe may have navigated cross-origin */
      }
      unbindHostDown();
      unbindHostUp();
    };
  });

  useSignalEffect(() => {
    if (activeTool.value === 'measure') return;
    hover.value = null;
    anchors.value = [];
    altPressed.value = false;
  });

  useIframeRectSync(
    () => activeTool.value === 'measure',
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

  useSignalEffect(() => {
    if (activeTool.value !== 'measure') return;
    return injectCrosshairCursor(frameRef.current?.contentDocument);
  });

  if (activeTool.value !== 'measure') return null;

  const frame = frameRef.current;
  return createPortal(
    <MeasureOverlayContent
      anchors={anchors.value}
      hover={hover.value}
      altPressed={altPressed.value}
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
