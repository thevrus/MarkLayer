import { ElementOutline, GapMeasurements, HintBadge, type MeasureState, SizeRuler } from '@ext/components/MeasureLayer';
import { activeTool } from '@ext/lib/state';
import { useSignal, useSignalEffect } from '@preact/signals';
import { createPortal } from 'preact/compat';
import { isElementNode, rectsEqual, toViewportRect, useIframeOverlay, useIframeRectSync } from './iframeOverlay';

export function WebMeasureLayer({ frameRef }: { frameRef: { current: HTMLIFrameElement | null } }) {
  const hover = useSignal<MeasureState | null>(null);
  const anchor = useSignal<MeasureState | null>(null);

  useIframeOverlay(frameRef, ({ win, doc, frame }) => {
    const onMove = (e: MouseEvent) => {
      if (activeTool.value !== 'measure') return;
      const el = isElementNode(e.target) ? e.target : null;
      if (!el || el === doc.documentElement || el === doc.body || el === anchor.value?.el) {
        hover.value = null;
        return;
      }
      if (el === hover.peek()?.el) return;
      hover.value = { el, rect: toViewportRect(frame, el) };
    };

    const onClick = (e: MouseEvent) => {
      if (activeTool.value !== 'measure') return;
      const el = isElementNode(e.target) ? e.target : null;
      if (!el || el === doc.documentElement || el === doc.body) return;
      e.preventDefault();
      e.stopPropagation();
      if (anchor.value && el === anchor.value.el) {
        anchor.value = null;
        return;
      }
      anchor.value = { el, rect: toViewportRect(frame, el) };
      hover.value = null;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (activeTool.value !== 'measure') return;
      if (e.key === 'Escape' && anchor.value) {
        e.preventDefault();
        e.stopPropagation();
        anchor.value = null;
      }
    };

    win.addEventListener('mousemove', onMove, true);
    win.addEventListener('click', onClick, true);
    win.addEventListener('keydown', onKeyDown, true);
    return () => {
      try {
        win.removeEventListener('mousemove', onMove, true);
        win.removeEventListener('click', onClick, true);
        win.removeEventListener('keydown', onKeyDown, true);
      } catch {
        /* iframe may have navigated */
      }
    };
  });

  useSignalEffect(() => {
    if (activeTool.value === 'measure') return;
    hover.value = null;
    anchor.value = null;
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
        return { el: cur.el, rect: next };
      };
      const a = refresh(anchor.peek());
      if (a !== anchor.peek()) anchor.value = a;
      const h = refresh(hover.peek());
      if (h !== hover.peek()) hover.value = h;
    },
  );

  // !important wins against arbitrary page CSS that targets links/buttons/inputs.
  useSignalEffect(() => {
    if (activeTool.value !== 'measure') return;
    const doc = frameRef.current?.contentDocument;
    if (!doc?.head) return;
    const style = doc.createElement('style');
    style.textContent = '*, *::before, *::after { cursor: crosshair !important; }';
    doc.head.appendChild(style);
    return () => style.remove();
  });

  if (activeTool.value !== 'measure') return null;

  const a = anchor.value;
  const h = hover.value;

  return createPortal(
    <>
      {!a && <HintBadge />}
      {a && <ElementOutline rect={a.rect} />}
      {a && <SizeRuler rect={a.rect} />}
      {h && <ElementOutline rect={h.rect} dashed={!!a} />}
      {h && <SizeRuler rect={h.rect} />}
      {a && h && <GapMeasurements a={a.rect} b={h.rect} />}
    </>,
    document.body,
  );
}
