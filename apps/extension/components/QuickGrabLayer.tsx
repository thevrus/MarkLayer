import { useSignal, useSignalEffect } from '@preact/signals';
import { useEffect, useRef } from 'preact/hooks';
import { copyElementShot } from '../lib/capture';
import { detectFrameworkComponent } from '../lib/fiber-bridge';
import { getSelector, isExtensionElement, snapshotElement } from '../lib/selector';
import { activeTool, altHeld, outputDetail } from '../lib/state';
import { type HoverState, HoverTooltip } from './InspectorLayer';

// Suppressed when inspect tools are active so their overlays own the input.
export function QuickGrabLayer() {
  const hover = useSignal<HoverState | null>(null);
  const lastEl = useRef<Element | null>(null);
  const debounce = useRef(0);

  useEffect(() => {
    const isTypingTarget = (e: Event): boolean => {
      const t = e.composedPath()[0];
      if (!(t instanceof HTMLElement)) return false;
      const tag = t.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
    };

    const inspectorOwnsInput = () => activeTool.value === 'inspect' || activeTool.value === 'multiInspect';

    const grabHovered = () => {
      const h = hover.value;
      if (!h) return false;
      const rect = h.el.getBoundingClientRect();
      const snap = snapshotElement(h.el, getSelector(h.el), rect, outputDetail.value);
      // Hide the highlight before capture so it doesn't appear in the shot.
      hover.value = null;
      void copyElementShot({ rect, markdown: snap.markdown });
      return true;
    };

    // stopPropagation prevents App.tsx's tool shortcuts from also reading "C" as comment.
    // This is a capture-phase listener on `window`, so it sees every keystroke on the
    // host page: the scalar modifier test comes first, because `isTypingTarget` walks
    // the whole composed path and would do it for every key typed anywhere.
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.altKey || e.metaKey || e.ctrlKey || e.key.toLowerCase() !== 'c') return;
      if (inspectorOwnsInput() || isTypingTarget(e)) return;
      if (!altHeld.value || !grabHovered()) return;
      e.preventDefault();
      e.stopPropagation();
      altHeld.value = false;
    };

    const onMove = (e: MouseEvent) => {
      if (!altHeld.value || inspectorOwnsInput()) return;
      const el = e.target instanceof Element ? e.target : null;
      // Identity first: it settles the overwhelming majority of moves without the
      // ancestor walk in isExtensionElement, which only ever runs for a new element.
      if (el && el === lastEl.current) return;
      if (!el || isExtensionElement(el)) {
        hover.value = null;
        lastEl.current = null;
        return;
      }
      lastEl.current = el;

      const rect = el.getBoundingClientRect();
      hover.value = { el, rect, selector: null, component: null };

      clearTimeout(debounce.current);
      debounce.current = window.setTimeout(() => {
        if (lastEl.current !== el) return;
        hover.value = { el, rect, selector: getSelector(el), component: detectFrameworkComponent(el) };
      }, 80);
    };

    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('mousemove', onMove, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('mousemove', onMove, true);
      clearTimeout(debounce.current);
    };
  }, []);

  // Alt is tracked once, in App.tsx, and shared with the measure overlays. Clear
  // the hover on release so the next Alt starts from a fresh element.
  useSignalEffect(() => {
    if (altHeld.value) return;
    hover.value = null;
    lastEl.current = null;
    clearTimeout(debounce.current);
  });

  if (!altHeld.value || !hover.value) return null;
  // MeasureLayer outlines and dimensions the hovered element for the same held Alt,
  // so this contributes only the selector/component readout it does not draw.
  return <HoverTooltip state={hover.value} />;
}
