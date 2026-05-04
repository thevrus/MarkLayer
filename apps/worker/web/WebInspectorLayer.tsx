import {
  HoverHighlight,
  type HoverState,
  InspectorStackPanel,
  SelectedHighlight,
  SelectedPanel,
} from '@ext/components/InspectorLayer';
import { getSelector, type SelectedInfo, snapshotElement } from '@ext/lib/selector';
import { activeTool } from '@ext/lib/state';
import { useComputed, useSignal, useSignalEffect } from '@preact/signals';
import { createPortal } from 'preact/compat';
import { useCallback, useRef } from 'preact/hooks';
import { isElementNode, rectsEqual, toViewportRect, useIframeOverlay, useIframeRectSync } from './iframeOverlay';

export function WebInspectorLayer({ frameRef }: { frameRef: { current: HTMLIFrameElement | null } }) {
  const selected = useSignal<SelectedInfo | null>(null);
  // Boolean projection so rect writes don't retrigger the rect-sync effect setup.
  const hasSelected = useComputed(() => selected.value !== null);
  const hover = useSignal<HoverState | null>(null);
  const selectedSelectorRef = useRef<string | null>(null);
  const selectedElRef = useRef<Element | null>(null);
  const selectorTimer = useRef(0);
  const lastEl = useRef<Element | null>(null);

  const clearHover = useCallback(() => {
    hover.value = null;
    lastEl.current = null;
    clearTimeout(selectorTimer.current);
  }, [hover]);

  useIframeOverlay(frameRef, ({ win, doc, frame }) => {
    const onMove = (e: MouseEvent) => {
      if (activeTool.value !== 'inspect') return;
      if (selectedElRef.current) return;
      const el = isElementNode(e.target) ? e.target : null;
      if (!el || el === doc.documentElement || el === doc.body) {
        hover.value = null;
        return;
      }
      if (el === lastEl.current) return;
      lastEl.current = el;

      const rect = toViewportRect(frame, el);
      hover.value = { el, rect, selector: null, component: null };

      clearTimeout(selectorTimer.current);
      selectorTimer.current = window.setTimeout(() => {
        if (lastEl.current !== el) return;
        hover.value = { el, rect, selector: getSelector(el), component: null };
      }, 80);
    };

    const onClick = (e: MouseEvent) => {
      if (activeTool.value !== 'inspect') return;
      const el = isElementNode(e.target) ? e.target : null;
      if (!el || el === doc.documentElement || el === doc.body) return;
      e.preventDefault();
      e.stopPropagation();
      clearHover();
      const selector = getSelector(el);
      const rect = toViewportRect(frame, el);
      selectedSelectorRef.current = selector;
      selectedElRef.current = el;
      selected.value = snapshotElement(el, selector, rect);
    };

    win.addEventListener('mousemove', onMove, true);
    win.addEventListener('click', onClick, true);
    return () => {
      try {
        win.removeEventListener('mousemove', onMove, true);
        win.removeEventListener('click', onClick, true);
      } catch {
        /* iframe may have navigated */
      }
    };
  });

  useSignalEffect(() => {
    if (activeTool.value === 'inspect') return;
    clearHover();
    selected.value = null;
  });

  // Clear element refs when selection closes so onMove resumes hovering.
  useSignalEffect(() => {
    if (selected.value) return;
    selectedSelectorRef.current = null;
    selectedElRef.current = null;
  });

  useIframeRectSync(
    () => hasSelected.value,
    () => {
      const frame = frameRef.current;
      if (!frame) return;
      let el = selectedElRef.current;
      if (el && !el.isConnected) {
        const doc = frame.contentDocument;
        const sel = selectedSelectorRef.current;
        el = doc && sel ? (doc.querySelector(sel) ?? null) : null;
        selectedElRef.current = el;
      }
      if (!el) {
        selected.value = null;
        return;
      }
      const rect = toViewportRect(frame, el);
      const cur = selected.peek();
      if (!cur) return;
      if (rectsEqual(rect, cur.rect)) return;
      selected.value = { ...cur, rect };
    },
  );

  // !important wins against arbitrary page CSS that targets links/buttons/inputs.
  useSignalEffect(() => {
    if (activeTool.value !== 'inspect') return;
    const doc = frameRef.current?.contentDocument;
    if (!doc?.head) return;
    const style = doc.createElement('style');
    style.textContent = '*, *::before, *::after { cursor: crosshair !important; }';
    doc.head.appendChild(style);
    return () => style.remove();
  });

  if (activeTool.value !== 'inspect') return null;

  return createPortal(
    <>
      {hover.value && !selected.value && <HoverHighlight state={hover.value} />}
      {selected.value && (
        <>
          <SelectedHighlight rect={selected.value.rect} />
          <SelectedPanel
            state={selected.value}
            onClose={() => {
              selected.value = null;
            }}
          />
        </>
      )}
      <InspectorStackPanel />
    </>,
    document.body,
  );
}
