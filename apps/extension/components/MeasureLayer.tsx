import { useSignal, useSignalEffect } from '@preact/signals';
import { nanoid } from 'nanoid';
import { Fragment, type JSX } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { tinykeys } from 'tinykeys';
import { injectCrosshairCursor } from '../lib/dom';
import {
  type ContainerLines,
  type DistanceOverlay,
  getContainerLines,
  getDistanceOverlay,
  nextAnchorElement,
  type RectLike,
  type TraverseDir,
} from '../lib/measure';
import { isExtensionElement } from '../lib/selector';
import { altHeld, measureActive, measureToolActive } from '../lib/state';

const HUE = 200;
const FG = `oklch(0.78 0.13 ${HUE})`;
const BG = `oklch(0.65 0.16 ${HUE} / 0.10)`;
const BORDER = `oklch(0.65 0.16 ${HUE} / 0.85)`;
const GLOW = `oklch(0.65 0.16 ${HUE} / 0.18)`;
const PANEL = `oklch(0.22 0.015 ${HUE} / 0.96)`;
const ALT_BORDER = `oklch(0.7 0.19 30 / 0.9)`;

export interface MeasureState {
  id: string;
  el: Element;
  rect: DOMRect;
}

export function ElementOutline({
  rect,
  dashed,
  variant = 'primary',
}: {
  rect: RectLike;
  dashed?: boolean;
  variant?: 'primary' | 'alt';
}) {
  const stroke = variant === 'alt' ? ALT_BORDER : BORDER;
  return (
    <div
      class="fixed z-2147483646 pointer-events-none rounded-xs animate-[fadeIn_120ms_ease-out]"
      style={{
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        background: dashed ? 'transparent' : BG,
        outline: `1.5px ${dashed ? 'dashed' : 'solid'} ${stroke}`,
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
  variant = 'primary',
}: {
  x: number;
  y: number;
  text: string;
  anchor?: 'center' | 'start' | 'end';
  variant?: 'primary' | 'alt';
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
        color: variant === 'alt' ? 'oklch(0.88 0.12 30)' : FG,
        border: `1px solid ${variant === 'alt' ? ALT_BORDER : BORDER}`,
        boxShadow: '0 2px 8px oklch(0 0 0 / 0.3)',
      }}
    >
      {text}
    </div>
  );
}

export function SizeRuler({ rect }: { rect: RectLike }) {
  const w = Math.round(rect.width);
  const h = Math.round(rect.height);
  return (
    <>
      <Label x={rect.left + rect.width / 2} y={rect.top + rect.height + 14} text={`width: ${w}px`} />
      <Label x={rect.left + rect.width + 12} y={rect.top + rect.height / 2} text={`height: ${h}px`} anchor="start" />
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

export function GapMeasurements({ a, b }: { a: RectLike; b: RectLike }) {
  const aRight = a.left + a.width;
  const aBottom = a.top + a.height;
  const bRight = b.left + b.width;
  const bBottom = b.top + b.height;

  // Midpoint of the vertical-overlap region (or of the gap, if rects don't overlap vertically).
  // (max(top), min(bottom)) describes the overlap; when rects are disjoint vertically, the same
  // formula lands inside the gap, which is exactly where a horizontal connector should sit.
  const midY = (Math.max(a.top, b.top) + Math.min(aBottom, bBottom)) / 2;
  const midX = (Math.max(a.left, b.left) + Math.min(aRight, bRight)) / 2;

  const out: JSX.Element[] = [];

  if (b.left > aRight) {
    const dx = Math.round(b.left - aRight);
    out.push(<GapLine key="hr" x1={aRight} y1={midY} x2={b.left} y2={midY} />);
    out.push(<Label key="hr-l" x={(aRight + b.left) / 2} y={midY - 12} text={`${dx}px`} />);
  } else if (a.left > bRight) {
    const dx = Math.round(a.left - bRight);
    out.push(<GapLine key="hl" x1={bRight} y1={midY} x2={a.left} y2={midY} />);
    out.push(<Label key="hl-l" x={(bRight + a.left) / 2} y={midY - 12} text={`${dx}px`} />);
  }

  if (b.top > aBottom) {
    const dy = Math.round(b.top - aBottom);
    out.push(<GapLine key="vd" x1={midX} y1={aBottom} x2={midX} y2={b.top} />);
    out.push(<Label key="vd-l" x={midX} y={(aBottom + b.top) / 2} text={`${dy}px`} />);
  } else if (a.top > bBottom) {
    const dy = Math.round(a.top - bBottom);
    out.push(<GapLine key="vu" x1={midX} y1={bBottom} x2={midX} y2={a.top} />);
    out.push(<Label key="vu-l" x={midX} y={(bBottom + a.top) / 2} text={`${dy}px`} />);
  }

  return <>{out}</>;
}

export function AltDistanceOverlay({ overlay }: { overlay: DistanceOverlay }) {
  const out: JSX.Element[] = [];

  if (overlay.horizontal && overlay.horizontal.value > 0.5) {
    const h = overlay.horizontal;
    out.push(
      <div
        key="h-line"
        class="fixed z-2147483646 pointer-events-none"
        style={{
          left: Math.min(h.x1, h.x2),
          top: h.y,
          width: Math.abs(h.x2 - h.x1),
          height: 0,
          borderTop: `1.5px solid ${ALT_BORDER}`,
        }}
      />,
    );
    out.push(
      <Label key="h-label" x={(h.x1 + h.x2) / 2} y={h.y - 12} text={`${Math.round(h.value)}px`} variant="alt" />,
    );
  }

  if (overlay.vertical && overlay.vertical.value > 0.5) {
    const v = overlay.vertical;
    out.push(
      <div
        key="v-line"
        class="fixed z-2147483646 pointer-events-none"
        style={{
          left: v.x,
          top: Math.min(v.y1, v.y2),
          width: 0,
          height: Math.abs(v.y2 - v.y1),
          borderLeft: `1.5px solid ${ALT_BORDER}`,
        }}
      />,
    );
    out.push(
      <Label
        key="v-label"
        x={v.x + 14}
        y={(v.y1 + v.y2) / 2}
        text={`${Math.round(v.value)}px`}
        anchor="start"
        variant="alt"
      />,
    );
  }

  for (const [i, c] of overlay.connectors.entries()) {
    const horizontal = Math.abs(c.y1 - c.y2) < 0.5;
    out.push(
      <div
        key={`c-${i}`}
        class="fixed z-2147483646 pointer-events-none"
        style={{
          left: Math.min(c.x1, c.x2),
          top: Math.min(c.y1, c.y2),
          width: horizontal ? Math.abs(c.x2 - c.x1) : 0,
          height: horizontal ? 0 : Math.abs(c.y2 - c.y1),
          borderTop: horizontal ? `1px dashed ${ALT_BORDER}` : 'none',
          borderLeft: horizontal ? 'none' : `1px dashed ${ALT_BORDER}`,
        }}
      />,
    );
  }

  return <>{out}</>;
}

/** Dashed lines from a rect to its container's four edges (Alt + no hover). */
export function ContainerLinesOverlay({ lines }: { lines: ContainerLines }) {
  const items: JSX.Element[] = [];
  const vSides = ['top', 'bottom'] as const;
  const hSides = ['left', 'right'] as const;
  for (const side of vSides) {
    const v = lines[side];
    if (v.value < 0.5) continue;
    items.push(
      <div
        key={`cl-${side}`}
        class="fixed z-2147483646 pointer-events-none"
        style={{
          left: v.x,
          top: Math.min(v.y1, v.y2),
          width: 0,
          height: Math.abs(v.y2 - v.y1),
          borderLeft: `1px dashed ${ALT_BORDER}`,
        }}
      />,
    );
    items.push(
      <Label
        key={`cl-${side}-l`}
        x={v.x + 10}
        y={(v.y1 + v.y2) / 2}
        text={`${Math.round(v.value)}px`}
        anchor="start"
        variant="alt"
      />,
    );
  }
  for (const side of hSides) {
    const h = lines[side];
    if (h.value < 0.5) continue;
    items.push(
      <div
        key={`cl-${side}`}
        class="fixed z-2147483646 pointer-events-none"
        style={{
          left: Math.min(h.x1, h.x2),
          top: h.y,
          width: Math.abs(h.x2 - h.x1),
          height: 0,
          borderTop: `1px dashed ${ALT_BORDER}`,
        }}
      />,
    );
    items.push(
      <Label key={`cl-${side}-l`} x={(h.x1 + h.x2) / 2} y={h.y - 10} text={`${Math.round(h.value)}px`} variant="alt" />,
    );
  }
  return <>{items}</>;
}

export function HintBadge({ text }: { text?: string } = {}) {
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
      {text ?? 'Click to pin · hold Alt for distances · Tab walks the DOM'}
    </div>
  );
}

/** Shared rendering for any number of pinned anchors + alt/hover overlay. */
export function MeasureOverlayContent({
  anchors,
  hover,
  altPressed,
  viewport,
  getContainerRect,
  showHint = true,
}: {
  anchors: MeasureState[];
  hover: MeasureState | null;
  altPressed: boolean;
  viewport: RectLike;
  /** Returns the rect of `el`'s relevant container in the same coord system as anchor rects. */
  getContainerRect?: (el: Element) => RectLike | null;
  /** False for the momentary Alt-hover readout, which has no pinning to explain. */
  showHint?: boolean;
}) {
  const primary = anchors[anchors.length - 1] ?? null;
  const showAlt = altPressed && !!primary;
  const altOverlay = showAlt && hover && hover.el !== primary.el ? getDistanceOverlay(primary.rect, hover.rect) : null;
  const containerLines =
    showAlt && !hover ? getContainerLines(primary.rect, getContainerRect?.(primary.el) ?? viewport) : null;

  return (
    <>
      {showHint && !anchors.length && !hover && <HintBadge />}
      {anchors.map((a) => (
        <Fragment key={a.id}>
          <ElementOutline rect={a.rect} />
          <SizeRuler rect={a.rect} />
        </Fragment>
      ))}
      {!showAlt && hover && <ElementOutline rect={hover.rect} dashed={!!primary} />}
      {!showAlt && hover && <SizeRuler rect={hover.rect} />}
      {!showAlt && primary && hover && hover.el !== primary.el && <GapMeasurements a={primary.rect} b={hover.rect} />}
      {altOverlay && hover && (
        <>
          <ElementOutline rect={hover.rect} variant="alt" dashed />
          <AltDistanceOverlay overlay={altOverlay} />
        </>
      )}
      {containerLines && <ContainerLinesOverlay lines={containerLines} />}
    </>
  );
}

export function MeasureLayer() {
  const anchors = useSignal<MeasureState[]>([]);
  const hover = useSignal<MeasureState | null>(null);
  const lastEl = useRef<Element | null>(null);

  useEffect(() => {
    const isAnchored = (el: Element) => anchors.peek().some((a) => a.el === el);

    const onMove = (e: MouseEvent) => {
      if (!measureActive.value) return;
      const el = e.target instanceof Element ? e.target : null;
      // Identity first: it settles the overwhelming majority of moves without the
      // ancestor walk in isExtensionElement. Safe because every path that makes an
      // element extension-owned or anchored also clears lastEl.
      if (el && el === lastEl.current) return;
      if (!el || isExtensionElement(el) || isAnchored(el)) {
        hover.value = null;
        lastEl.current = null;
        return;
      }
      lastEl.current = el;
      hover.value = { id: 'hover', el, rect: el.getBoundingClientRect() };
    };

    const onClick = (e: MouseEvent) => {
      if (!measureToolActive.value) return;
      const el = e.target instanceof Element ? e.target : null;
      if (!el || isExtensionElement(el)) return;
      e.preventDefault();
      e.stopPropagation();
      const cur = anchors.peek();
      const existing = cur.findIndex((a) => a.el === el);
      if (existing >= 0) {
        anchors.value = cur.filter((_, i) => i !== existing);
      } else {
        anchors.value = [...cur, { id: nanoid(), el, rect: el.getBoundingClientRect() }];
        hover.value = null;
        lastEl.current = null;
      }
    };

    const traverse = (dir: TraverseDir) => {
      const cur = anchors.peek();
      const primary = cur[cur.length - 1];
      if (!primary) return false;
      const next = nextAnchorElement(primary.el, dir, isExtensionElement);
      if (!next) return false;
      anchors.value = [...cur.slice(0, -1), { id: primary.id, el: next, rect: next.getBoundingClientRect() }];
      hover.value = null;
      lastEl.current = null;
      return true;
    };

    const tryTraverse = (e: KeyboardEvent, dir: TraverseDir) => {
      if (!measureToolActive.value) return;
      if (!traverse(dir)) return;
      e.preventDefault();
      e.stopPropagation();
    };

    const popPrimary = (e: KeyboardEvent) => {
      if (!measureToolActive.value || !anchors.peek().length) return;
      e.preventDefault();
      e.stopPropagation();
      anchors.value = anchors.peek().slice(0, -1);
    };
    const unbindDown = tinykeys(window, {
      Escape: (e) => {
        if (!measureToolActive.value || !anchors.peek().length) return;
        e.preventDefault();
        e.stopPropagation();
        anchors.value = [];
      },
      Backspace: popPrimary,
      Delete: popPrimary,
      Tab: (e) => tryTraverse(e, 'parent'),
      'Shift+Tab': (e) => tryTraverse(e, 'child'),
      ArrowDown: (e) => tryTraverse(e, 'next'),
      ArrowRight: (e) => tryTraverse(e, 'next'),
      ArrowUp: (e) => tryTraverse(e, 'prev'),
      ArrowLeft: (e) => tryTraverse(e, 'prev'),
    });

    window.addEventListener('mousemove', onMove, true);
    window.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('mousemove', onMove, true);
      window.removeEventListener('click', onClick, true);
      unbindDown();
    };
  }, []);

  // Pinned anchors belong to the tool; the hover readout also runs on a held Alt.
  useSignalEffect(() => {
    if (measureToolActive.value) return;
    anchors.value = [];
  });

  useSignalEffect(() => {
    if (measureActive.value) return;
    hover.value = null;
    lastEl.current = null;
  });

  useSignalEffect(() => {
    if (!measureActive.value) return;
    let raf = 0;
    const refresh = <T extends MeasureState>(cur: T | null): T | null => {
      if (!cur) return null;
      if (!cur.el.isConnected) return null;
      const r = cur.el.getBoundingClientRect();
      const p = cur.rect;
      if (r.x === p.x && r.y === p.y && r.width === p.width && r.height === p.height) return cur;
      return { ...cur, rect: r };
    };
    const sync = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const curAnchors = anchors.peek();
        let changed = false;
        const next: MeasureState[] = [];
        for (const a of curAnchors) {
          const refreshed = refresh(a);
          if (!refreshed) {
            changed = true;
            continue;
          }
          if (refreshed !== a) changed = true;
          next.push(refreshed);
        }
        if (changed) anchors.value = next;
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

  // Only the real tool takes the cursor — a held Alt must not restyle the page
  // out from under whatever tool is actually selected.
  useSignalEffect(() => {
    if (!measureToolActive.value) return;
    return injectCrosshairCursor(document);
  });

  if (!measureActive.value) return null;

  return (
    <MeasureOverlayContent
      anchors={anchors.value}
      hover={hover.value}
      altPressed={altHeld.value}
      showHint={measureToolActive.value}
      viewport={{ left: 0, top: 0, width: window.innerWidth, height: window.innerHeight }}
      getContainerRect={(el) => {
        const p = el.parentElement;
        if (!p || p === document.body || p === document.documentElement) return null;
        return p.getBoundingClientRect();
      }}
    />
  );
}
