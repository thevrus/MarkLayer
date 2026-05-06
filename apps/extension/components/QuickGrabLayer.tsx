import { useSignal } from '@preact/signals';
import { useEffect, useRef } from 'preact/hooks';
import { detectFrameworkComponent } from '../lib/fiber-bridge';
import { getSelector, isExtensionElement, snapshotElement } from '../lib/selector';
import { activeTool, copyText, outputDetail, visible } from '../lib/state';
import { HoverHighlight, type HoverState } from './InspectorLayer';

// Suppressed when inspect tools are active so their overlays own the input.
export function QuickGrabLayer() {
  const armed = useSignal(false);
  const hover = useSignal<HoverState | null>(null);
  const lastEl = useRef<Element | null>(null);
  const debounce = useRef(0);

  useEffect(() => {
    const disarm = () => {
      armed.value = false;
      hover.value = null;
      lastEl.current = null;
      clearTimeout(debounce.current);
    };

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
      const snap = snapshotElement(h.el, getSelector(h.el), h.el.getBoundingClientRect(), outputDetail.value);
      copyText(snap.markdown, 'Element copied — paste into your AI');
      return true;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (!visible.value || inspectorOwnsInput() || isTypingTarget(e)) return;

      // stopPropagation prevents App.tsx's SHORTCUT_MAP from also reading "C" as the comment shortcut.
      if (e.altKey && !e.metaKey && !e.ctrlKey && e.key.toLowerCase() === 'c') {
        if (armed.value && grabHovered()) {
          e.preventDefault();
          e.stopPropagation();
          disarm();
        }
        return;
      }

      // Modifier mixes (Cmd+Alt, Shift+Alt) pass through so native shortcuts still work.
      if (e.key === 'Alt' && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
        if (!armed.value) armed.value = true;
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Alt' || !e.altKey) disarm();
    };

    const onMove = (e: MouseEvent) => {
      if (!armed.value) return;
      const el = e.target instanceof Element ? e.target : null;
      if (isExtensionElement(el)) {
        hover.value = null;
        lastEl.current = null;
        return;
      }
      if (!el || el === lastEl.current) return;
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
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('mousemove', onMove, true);
    window.addEventListener('blur', disarm);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('mousemove', onMove, true);
      window.removeEventListener('blur', disarm);
      clearTimeout(debounce.current);
    };
  }, []);

  if (!armed.value || !hover.value) return null;
  return <HoverHighlight state={hover.value} />;
}
