import { useSignal, useSignalEffect } from '@preact/signals';
import type { JSX } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { activeTool } from '../lib/state';

const HUE = 200;
const FG = `oklch(0.78 0.13 ${HUE})`;
const BG = `oklch(0.65 0.16 ${HUE} / 0.10)`;
const BORDER = `oklch(0.65 0.16 ${HUE} / 0.85)`;
const GLOW = `oklch(0.65 0.16 ${HUE} / 0.18)`;
const PANEL = `oklch(0.22 0.015 ${HUE} / 0.96)`;

interface MeasureState {
  el: Element;
  rect: DOMRect;
}

function isExtensionElement(el: Element | null): boolean {
  if (!el) return true;
  if (el.tagName === 'MARK-LAYER') return true;
  return !!el.closest('mark-layer');
}

function ElementOutline({ rect, dashed }: { rect: DOMRect; dashed?: boolean }) {
  return (
    <div
      class="fixed z-2147483646 pointer-events-none rounded-xs animate-[fadeIn_120ms_ease-out]"
      style={{
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        background: dashed ? 'transparent' : BG,
        outline: `1.5px ${dashed ? 'dashed' : 'solid'} ${BORDER}`,
        boxShadow: dashed ? 'none' : `0 0 0 4px ${GLOW}`,
        transition: 'left 80ms ease, top 80ms ease, width 80ms ease, height 80ms ease',
      }}
    />
  );
}

function Label({
  x,
  y,
  text,
  anchor = 'center',
}: {
  x: number;
  y: number;
  text: string;
  anchor?: 'center' | 'start' | 'end';
}) {
  const tx = anchor === 'start' ? '0%' : anchor === 'end' ? '-100%' : '-50%';
  return (
    <div
      class="fixed z-2147483647 pointer-events-none font-mono text-[10.5px] tabular-nums whitespace-nowrap"
      style={{
        left: x,
        top: y,
        transform: `translate(${tx}, -50%)`,
        padding: '2px 6px',
        borderRadius: 4,
        background: PANEL,
        color: FG,
        border: `1px solid ${BORDER}`,
        boxShadow: '0 2px 8px oklch(0 0 0 / 0.3)',
      }}
    >
      {text}
    </div>
  );
}

/** Width label below the rect, height label to the right. */
function SizeRuler({ rect }: { rect: DOMRect }) {
  const w = Math.round(rect.width);
  const h = Math.round(rect.height);
  return (
    <>
      <Label x={rect.left + rect.width / 2} y={rect.bottom + 14} text={`width: ${w}px`} />
      <Label x={rect.right + 12} y={rect.top + rect.height / 2} text={`height: ${h}px`} anchor="start" />
    </>
  );
}

function GapLine({ x1, y1, x2, y2 }: { x1: number; y1: number; x2: number; y2: number }) {
  const horizontal = Math.abs(y2 - y1) < 0.5;
  const left = Math.min(x1, x2);
  const top = Math.min(y1, y2);
  return (
    <div
      class="fixed z-2147483646 pointer-events-none"
      style={{
        left,
        top,
        width: horizontal ? Math.max(1, Math.abs(x2 - x1)) : 0,
        height: horizontal ? 0 : Math.max(1, Math.abs(y2 - y1)),
        borderTop: horizontal ? `1.5px dashed ${BORDER}` : 'none',
        borderLeft: horizontal ? 'none' : `1.5px dashed ${BORDER}`,
      }}
    />
  );
}

/** Edge-to-edge gap on each axis where the rects don't overlap. */
function GapMeasurements({ a, b }: { a: DOMRect; b: DOMRect }) {
  // Midpoint of the vertical-overlap region (or of the gap, if rects don't overlap vertically).
  // (max(top), min(bottom)) describes the overlap; when rects are disjoint vertically, the same
  // formula lands inside the gap, which is exactly where a horizontal connector should sit.
  const midY = (Math.max(a.top, b.top) + Math.min(a.bottom, b.bottom)) / 2;
  const midX = (Math.max(a.left, b.left) + Math.min(a.right, b.right)) / 2;

  const out: JSX.Element[] = [];

  if (b.left > a.right) {
    const dx = Math.round(b.left - a.right);
    out.push(<GapLine key="hr" x1={a.right} y1={midY} x2={b.left} y2={midY} />);
    out.push(<Label key="hr-l" x={(a.right + b.left) / 2} y={midY - 12} text={`${dx}px`} />);
  } else if (a.left > b.right) {
    const dx = Math.round(a.left - b.right);
    out.push(<GapLine key="hl" x1={b.right} y1={midY} x2={a.left} y2={midY} />);
    out.push(<Label key="hl-l" x={(b.right + a.left) / 2} y={midY - 12} text={`${dx}px`} />);
  }

  if (b.top > a.bottom) {
    const dy = Math.round(b.top - a.bottom);
    out.push(<GapLine key="vd" x1={midX} y1={a.bottom} x2={midX} y2={b.top} />);
    out.push(<Label key="vd-l" x={midX} y={(a.bottom + b.top) / 2} text={`${dy}px`} />);
  } else if (a.top > b.bottom) {
    const dy = Math.round(a.top - b.bottom);
    out.push(<GapLine key="vu" x1={midX} y1={b.bottom} x2={midX} y2={a.top} />);
    out.push(<Label key="vu-l" x={midX} y={(b.bottom + a.top) / 2} text={`${dy}px`} />);
  }

  return <>{out}</>;
}

function HintBadge() {
  return (
    <div
      class="fixed left-1/2 -translate-x-1/2 z-2147483647 pointer-events-none top-5
             px-3 py-1.5 text-[11.5px] font-medium tracking-[0.01em] rounded-lg
             animate-[fadeInDown_180ms_ease-out] font-mono whitespace-nowrap"
      style={{
        background: PANEL,
        color: FG,
        border: `1px solid ${BORDER}`,
        boxShadow: '0 6px 20px oklch(0 0 0 / 0.35)',
      }}
    >
      Click an element to anchor, then hover another to measure
    </div>
  );
}

export function MeasureLayer() {
  const hover = useSignal<MeasureState | null>(null);
  const anchor = useSignal<MeasureState | null>(null);
  const lastEl = useRef<Element | null>(null);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (activeTool.value !== 'measure') return;
      const el = e.target instanceof Element ? e.target : null;
      if (!el || isExtensionElement(el)) {
        hover.value = null;
        lastEl.current = null;
        return;
      }
      if (anchor.value && el === anchor.value.el) {
        hover.value = null;
        lastEl.current = null;
        return;
      }
      if (el === lastEl.current) return;
      lastEl.current = el;
      hover.value = { el, rect: el.getBoundingClientRect() };
    };

    const onClick = (e: MouseEvent) => {
      if (activeTool.value !== 'measure') return;
      const el = e.target instanceof Element ? e.target : null;
      if (!el || isExtensionElement(el)) return;
      e.preventDefault();
      e.stopPropagation();
      if (anchor.value && el === anchor.value.el) {
        anchor.value = null;
      } else {
        anchor.value = { el, rect: el.getBoundingClientRect() };
        hover.value = null;
        lastEl.current = null;
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (activeTool.value !== 'measure') return;
      if (e.key === 'Escape' && anchor.value) {
        e.preventDefault();
        e.stopPropagation();
        anchor.value = null;
      }
    };

    window.addEventListener('mousemove', onMove, true);
    window.addEventListener('click', onClick, true);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('mousemove', onMove, true);
      window.removeEventListener('click', onClick, true);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, []);

  // Reset when leaving the tool
  useSignalEffect(() => {
    if (activeTool.value === 'measure') return;
    hover.value = null;
    anchor.value = null;
    lastEl.current = null;
  });

  useSignalEffect(() => {
    if (activeTool.value !== 'measure') return;
    let raf = 0;
    const refresh = (cur: MeasureState | null): MeasureState | null => {
      if (!cur) return null;
      if (!cur.el.isConnected) return null;
      const r = cur.el.getBoundingClientRect();
      const p = cur.rect;
      if (r.x === p.x && r.y === p.y && r.width === p.width && r.height === p.height) return cur;
      return { el: cur.el, rect: r };
    };
    const sync = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const a = refresh(anchor.peek());
        if (a !== anchor.peek()) anchor.value = a;
        const h = refresh(hover.peek());
        if (h !== hover.peek()) hover.value = h;
      });
    };
    window.addEventListener('scroll', sync, true);
    window.addEventListener('resize', sync);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', sync, true);
      window.removeEventListener('resize', sync);
    };
  });

  useSignalEffect(() => {
    if (activeTool.value !== 'measure') return;
    document.body.style.cursor = 'crosshair';
    return () => {
      document.body.style.cursor = '';
    };
  });

  if (activeTool.value !== 'measure') return null;

  const a = anchor.value;
  const h = hover.value;

  return (
    <>
      {!a && <HintBadge />}
      {a && <ElementOutline rect={a.rect} />}
      {a && <SizeRuler rect={a.rect} />}
      {h && <ElementOutline rect={h.rect} dashed={!!a} />}
      {h && <SizeRuler rect={h.rect} />}
      {a && h && <GapMeasurements a={a.rect} b={h.rect} />}
    </>
  );
}
