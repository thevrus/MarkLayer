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
import { useCallback, useEffect, useRef } from 'preact/hooks';
import { cssScale, iframeScrollY } from './signals';

// Cross-realm: iframe DOM nodes are instances of the iframe's Element, not the host's,
// so `e.target instanceof Element` always returns false here. Check nodeType instead.
function isElementNode(v: EventTarget | null): v is Element {
  return v !== null && 'nodeType' in v && v.nodeType === 1;
}

export function WebInspectorLayer({ frameRef }: { frameRef: { current: HTMLIFrameElement | null } }) {
  const selected = useSignal<SelectedInfo | null>(null);
  // Boolean projection so rect writes don't retrigger the rect-sync effect setup.
  const hasSelected = useComputed(() => selected.value !== null);
  const hover = useSignal<HoverState | null>(null);
  const selectedSelectorRef = useRef<string | null>(null);
  const selectedElRef = useRef<Element | null>(null);
  const selectorTimer = useRef(0);
  const lastEl = useRef<Element | null>(null);

  const toViewportRect = useCallback(
    (el: Element): DOMRect | null => {
      const frame = frameRef.current;
      if (!frame) return null;
      const frameRect = frame.getBoundingClientRect();
      const scale = cssScale.value;
      const elRect = el.getBoundingClientRect();
      return new DOMRect(
        frameRect.left + elRect.left * scale,
        frameRect.top + elRect.top * scale,
        elRect.width * scale,
        elRect.height * scale,
      );
    },
    [frameRef],
  );

  const clearHover = useCallback(() => {
    hover.value = null;
    lastEl.current = null;
    clearTimeout(selectorTimer.current);
  }, [hover]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;

    let detach: (() => void) | undefined;

    const attach = () => {
      const win = frame.contentWindow;
      const doc = frame.contentDocument;
      if (!win || !doc) return;

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

        const rect = toViewportRect(el);
        if (!rect) return;
        hover.value = { el, rect, selector: null };

        clearTimeout(selectorTimer.current);
        selectorTimer.current = window.setTimeout(() => {
          if (lastEl.current !== el) return;
          hover.value = { el, rect, selector: getSelector(el) };
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
        const rect = toViewportRect(el);
        if (!rect) return;
        selectedSelectorRef.current = selector;
        selectedElRef.current = el;
        selected.value = snapshotElement(el, selector, rect);
      };

      win.addEventListener('mousemove', onMove, true);
      win.addEventListener('click', onClick, true);

      detach = () => {
        try {
          win.removeEventListener('mousemove', onMove, true);
          win.removeEventListener('click', onClick, true);
        } catch {
          /* iframe may have navigated */
        }
      };
    };

    attach();
    const onLoad = () => {
      detach?.();
      attach();
    };
    frame.addEventListener('load', onLoad);
    return () => {
      detach?.();
      frame.removeEventListener('load', onLoad);
    };
  }, [frameRef, clearHover, toViewportRect, hover, selected]);

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

  useSignalEffect(() => {
    if (!hasSelected.value) return;

    let raf = 0;
    const sync = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        let el = selectedElRef.current;
        if (el && !el.isConnected) {
          const doc = frameRef.current?.contentDocument;
          const sel = selectedSelectorRef.current;
          el = doc && sel ? (doc.querySelector(sel) ?? null) : null;
          selectedElRef.current = el;
        }
        if (!el) {
          selected.value = null;
          return;
        }
        const rect = toViewportRect(el);
        const cur = selected.peek();
        if (!rect || !cur) return;
        if (
          cur.rect.x === rect.x &&
          cur.rect.y === rect.y &&
          cur.rect.width === rect.width &&
          cur.rect.height === rect.height
        ) {
          return;
        }
        selected.value = { ...cur, rect };
      });
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

  useSignalEffect(() => {
    if (activeTool.value !== 'inspect') return;
    const doc = frameRef.current?.contentDocument;
    if (!doc?.body) return;
    doc.body.style.cursor = 'crosshair';
    return () => {
      if (doc.body) doc.body.style.cursor = '';
    };
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
