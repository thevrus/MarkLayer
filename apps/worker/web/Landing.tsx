import { InspectorLayer } from '@ext/components/InspectorLayer';
import { Toolbar } from '@ext/components/Toolbar';
import { glass } from '@ext/lib/glass';
import { hexToRgba, inView, opBounds, renderOp, simplify } from '@ext/lib/renderer';
import { HOW_IT_WORKS_PATH } from '@ext/lib/share';
import {
  activeTool,
  color,
  comments as commentsComputed,
  FREEHAND,
  isDrawingActive,
  isDrawingTool,
  lineWidth,
  onCursorMove,
  operations,
  redo,
  SHAPES,
  SHORTCUT_MAP,
  selections,
  showAnnotationPanel,
  showShareDialog,
  toasts,
  undo,
  undoRedoFlash,
} from '@ext/lib/state';
import type { FreehandOp, Point, TextOp } from '@ext/lib/types';
import { cn } from '@marklayer/types';
import { useSignalEffect } from '@preact/signals';
import copy from '@site/data/home-copy.json';
import { CHROME_STORE_URL } from '@site/lib/site';
import { ArrowRight, ChevronDown, Monitor, Search } from 'lucide-preact';
import { nanoid } from 'nanoid';
import { useCallback, useEffect, useRef } from 'preact/hooks';
import { ChannelCycle } from './ChannelCycle';
import { FakeCursors } from './FakeCursors';
import { SelfCursor } from './SelfCursor';
import { GithubLink, Logo, TextInputOverlay } from './shared';
import {
  commentPopover,
  isMobileDevice,
  navigateTo,
  pushDeviceOp,
  selectionPopover,
  textInput,
  urlReady,
} from './signals';
import { WebCommentPin } from './WebCommentPin';
import { WebCommentPopover } from './WebCommentPopover';
import { WebSelectionHighlight } from './WebSelectionHighlight';
import { WebSelectionPopover } from './WebSelectionPopover';

/**
 * The three claims named under the review board.
 *
 * Text only: the visuals all live in one artifact now (see ReviewBoard) rather
 * than being restated as three small objects beside three paragraphs.
 */
const MOMENTS: { title: string; desc: string }[] = [
  {
    title: 'Send one link.',
    desc: 'Whoever opens it can read the page and comment on it in their own browser. No account, nothing to install.',
  },
  {
    title: 'Watch it happen.',
    desc: 'Cursors, strokes and replies land for everyone at once, so a review is a conversation, not a queue of screenshots.',
  },
  {
    title: 'It stays put.',
    desc: 'Threads anchor to the element they were left on, so they survive a deploy, a reflow and a different screen size.',
  },
];

/* Declared at module scope, not in the render body. Landing re-renders on every
   signal read it makes — the active tool, the op list, the toast queue — and a
   component declared inside it is a new type each time, so Preact would unmount
   and remount this SVG on all of them. */
function ChromeIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="4" />
      <line x1="21.17" y1="8" x2="12" y2="8" />
      <line x1="3.95" y1="6.06" x2="8.54" y2="14" />
      <line x1="10.88" y1="21.94" x2="15.46" y2="14" />
    </svg>
  );
}

const CTA_CLS =
  'lp-cta inline-flex items-center gap-2 h-12 px-7 rounded-full text-white text-[15px] font-medium no-underline transition-colors select-none';

/** The one install call to action, used at the fold and again above the footer. */
function ChromeStoreLink({ label, class: cls }: { label: string; class?: string }) {
  return (
    <a href={CHROME_STORE_URL} target="_blank" rel="noopener" class={cn(CTA_CLS, cls)}>
      <ChromeIcon />
      {label}
    </a>
  );
}

export function Landing() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const startPtRef = useRef<Point>({ x: 0, y: 0 });
  const currentPathRef = useRef<FreehandOp | null>(null);
  const snapshotRef = useRef<ImageData | null>(null);

  const applyTool = useCallback((ctx: CanvasRenderingContext2D) => {
    ctx.lineCap = ctx.lineJoin = 'round';
    const tool = activeTool.value;
    const c = color.value;
    const lw = lineWidth.value;
    switch (tool) {
      case 'eraser':
        ctx.globalCompositeOperation = 'destination-out';
        ctx.lineWidth = Math.max(5, lw * 1.5);
        ctx.strokeStyle = 'black';
        break;
      case 'highlight':
        ctx.globalCompositeOperation = 'source-over';
        ctx.lineWidth = Math.max(8, lw * 2);
        ctx.strokeStyle = ctx.fillStyle = hexToRgba(c, 0.4);
        break;
      default:
        ctx.globalCompositeOperation = 'source-over';
        ctx.lineWidth = lw;
        ctx.strokeStyle = ctx.fillStyle = c;
    }
  }, []);

  const renderAll = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const canvasW = window.innerWidth;
    const canvasH = document.documentElement.scrollHeight;
    if (canvas.width !== canvasW) canvas.width = canvasW;
    if (canvas.height !== canvasH) canvas.height = canvasH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvasW, canvasH);
    for (const op of operations.value) {
      if (op.tool === 'comment' || op.tool === 'selection') continue;
      if (!inView(opBounds(op), 0, 0, canvasW, canvasH)) continue;
      renderOp(ctx, op, 0, 0);
    }
  }, []);

  const canvasCoords = useCallback((e: MouseEvent): Point => {
    return { x: e.clientX + window.scrollX, y: e.clientY + window.scrollY };
  }, []);

  const onDown = useCallback(
    (e: MouseEvent) => {
      const tool = activeTool.value;
      if (tool === 'navigate' || tool === 'comment' || tool === 'selection') return;
      if (tool === 'text') {
        textInput.value = canvasCoords(e);
        return;
      }
      drawingRef.current = true;
      isDrawingActive.value = true;
      const pos = canvasCoords(e);
      startPtRef.current = pos;
      const ctx = canvasRef.current?.getContext('2d');
      if (!ctx) return;
      applyTool(ctx);
      if (FREEHAND.has(tool)) {
        ctx.beginPath();
        ctx.moveTo(pos.x, pos.y);
        currentPathRef.current = {
          id: nanoid(),
          tool,
          points: [pos],
          color: tool === 'highlight' ? hexToRgba(color.value, 0.4) : color.value,
          lineWidth: ctx.lineWidth,
          compositeOperation: ctx.globalCompositeOperation,
        };
      } else if (SHAPES.has(tool)) {
        snapshotRef.current = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
      }
    },
    [canvasCoords, applyTool],
  );

  const onMove = useCallback(
    (e: MouseEvent) => {
      if (!drawingRef.current) return;
      const tool = activeTool.value;
      const pos = canvasCoords(e);
      const ctx = canvasRef.current?.getContext('2d');
      if (!ctx) return;
      if (FREEHAND.has(tool)) {
        currentPathRef.current?.points.push(pos);
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
      } else if (snapshotRef.current && SHAPES.has(tool)) {
        ctx.putImageData(snapshotRef.current, 0, 0);
        ctx.beginPath();
        const sp = startPtRef.current;
        applyTool(ctx);
        switch (tool) {
          case 'rectangle':
            ctx.strokeRect(sp.x, sp.y, pos.x - sp.x, pos.y - sp.y);
            break;
          case 'circle': {
            const r = Math.hypot(pos.x - sp.x, pos.y - sp.y);
            ctx.arc(sp.x, sp.y, r, 0, Math.PI * 2);
            ctx.stroke();
            break;
          }
          case 'line':
          case 'arrow':
            ctx.moveTo(sp.x, sp.y);
            ctx.lineTo(pos.x, pos.y);
            ctx.stroke();
            if (tool === 'arrow') {
              const angle = Math.atan2(pos.y - sp.y, pos.x - sp.x);
              const headLen = Math.max(10, ctx.lineWidth * 4);
              ctx.beginPath();
              ctx.moveTo(pos.x, pos.y);
              ctx.lineTo(
                pos.x - headLen * Math.cos(angle - Math.PI / 6),
                pos.y - headLen * Math.sin(angle - Math.PI / 6),
              );
              ctx.moveTo(pos.x, pos.y);
              ctx.lineTo(
                pos.x - headLen * Math.cos(angle + Math.PI / 6),
                pos.y - headLen * Math.sin(angle + Math.PI / 6),
              );
              ctx.stroke();
            }
            break;
        }
      }
    },
    [canvasCoords, applyTool],
  );

  const onUp = useCallback(
    (e: MouseEvent) => {
      if (!drawingRef.current) return;
      drawingRef.current = false;
      isDrawingActive.value = false;
      const tool = activeTool.value;
      const pos = canvasCoords(e);
      const sp = startPtRef.current;
      if (FREEHAND.has(tool) && currentPathRef.current) {
        currentPathRef.current.points.push(pos);
        if (currentPathRef.current.points.length > 1) {
          currentPathRef.current.points = simplify(currentPathRef.current.points, 1.5);
          pushDeviceOp(currentPathRef.current);
        }
        currentPathRef.current = null;
      } else if (SHAPES.has(tool)) {
        snapshotRef.current = null;
        const base = { id: nanoid(), color: color.value, lineWidth: lineWidth.value };
        if (tool === 'circle') {
          const r = Math.hypot(pos.x - sp.x, pos.y - sp.y);
          if (r > 0) pushDeviceOp({ ...base, tool: 'circle', centerX: sp.x, centerY: sp.y, radius: r });
        } else if (tool === 'rectangle') {
          if (sp.x !== pos.x && sp.y !== pos.y)
            pushDeviceOp({
              ...base,
              tool: 'rectangle',
              startX: sp.x,
              startY: sp.y,
              endX: pos.x,
              endY: pos.y,
            });
        } else if (tool === 'line' || tool === 'arrow') {
          if (sp.x !== pos.x || sp.y !== pos.y)
            pushDeviceOp({
              ...base,
              tool: 'line',
              arrow: tool === 'arrow',
              startX: sp.x,
              startY: sp.y,
              endX: pos.x,
              endY: pos.y,
            });
        }
      }
    },
    [canvasCoords],
  );

  // Re-render canvas when operations change
  useSignalEffect(() => {
    operations.value;
    renderAll();
  });

  useSignalEffect(() => {
    const v = undoRedoFlash.value;
    if (v > 0) canvasRef.current?.animate([{ opacity: 0.3 }, { opacity: 1 }], { duration: 400, easing: 'ease-out' });
  });

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const onResize = () => {
      clearTimeout(timer);
      timer = setTimeout(renderAll, 100);
    };
    window.addEventListener('resize', onResize);
    const ro = new ResizeObserver(() => renderAll());
    ro.observe(document.body);
    return () => {
      window.removeEventListener('resize', onResize);
      ro.disconnect();
    };
  }, [renderAll]);

  useEffect(() => {
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [onMove, onUp]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;
      const tag = target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
        if (e.key === 'Escape') target.blur();
        return;
      }
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'z' && !e.shiftKey) {
          e.preventDefault();
          undo();
          return;
        }
        if (e.key === 'y' || (e.shiftKey && (e.key === 'z' || e.key === 'Z'))) {
          e.preventDefault();
          redo();
          return;
        }
      }
      const m = SHORTCUT_MAP[e.key.toUpperCase()];
      if (m) {
        activeTool.value = m;
        e.preventDefault();
        return;
      }
      if (e.key === 'Escape') {
        if (showShareDialog.value) {
          showShareDialog.value = false;
          e.preventDefault();
          return;
        }
        if (showAnnotationPanel.value) {
          showAnnotationPanel.value = false;
          e.preventDefault();
          return;
        }
        activeTool.value = 'navigate';
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Cursor broadcast
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const pos = canvasCoords(e);
      onCursorMove.value?.(pos.x, pos.y, activeTool.value);
    };
    window.addEventListener('mousemove', handler);
    return () => window.removeEventListener('mousemove', handler);
  }, [canvasCoords]);

  // Selection tool
  useEffect(() => {
    const onMouseUp = () => {
      if (activeTool.value !== 'selection') return;
      requestAnimationFrame(() => {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed || !sel.toString().trim()) return;
        const text = sel.toString();
        const rects: import('@ext/lib/types').SelectionRect[] = [];
        for (let i = 0; i < sel.rangeCount; i++) {
          for (const cr of sel.getRangeAt(i).getClientRects()) {
            rects.push({ x: cr.x + window.scrollX, y: cr.y + window.scrollY, width: cr.width, height: cr.height });
          }
        }
        if (rects.length === 0) return;
        const lastCr = sel.getRangeAt(sel.rangeCount - 1).getClientRects();
        // A range can contribute no client rects (a collapsed boundary inside a
        // multi-range selection). `rects` is in document space and these anchor
        // the popover in viewport space, so there is nothing here to fall back
        // to — without a rect there is no place to put it.
        const last = lastCr[lastCr.length - 1];
        if (!last) return;
        selectionPopover.value = { text, rects, screenX: last.right, screenY: last.bottom };
      });
    };
    window.addEventListener('mouseup', onMouseUp);
    return () => window.removeEventListener('mouseup', onMouseUp);
  }, []);

  const tool = activeTool.value;
  const showCanvas = isDrawingTool(tool) && tool !== 'comment' && tool !== 'text' && tool !== 'selection';
  const showTextCursor = tool === 'text';
  const showCommentCursor = tool === 'comment';
  const comments = commentsComputed.value;

  return (
    <>
      {/* Gradient page background */}
      <div class="ml-force-light relative min-h-screen font-['Geist',system-ui,sans-serif] overflow-x-hidden lp-board">
        {/* No page-wide column. The content column used to be 800px wide on any
            viewport, which read as a narrow tube down the middle of a dead white
            field — packed inside, empty outside. Each section now owns its own
            width, and the live annotation layer gets the outer margins. */}
        <main class="min-h-screen sm:min-h-0">
          {/* The first screen is composed as one frame: nav, hero and the
              install line share a 100svh column, so the fold ends where the
              composition ends instead of letting the next section peek in
              151px high and unaligned. */}
          <div class="relative flex flex-col sm:min-h-[100svh]">
            {/* The demo cursors belong to this frame and scroll away with it. */}
            <FakeCursors />
            {/* Nav */}
            <nav class="lp-fade-up mx-auto flex w-full max-w-280 items-center justify-between px-6 pt-6 pb-2 sm:px-10">
              <a href="/" class="flex items-center gap-2.5 no-underline">
                <Logo size={28} />
                {/* Solid ink. A gradient clipped into the wordmark is decoration
                  the eye reads as a rendering artifact at this size. */}
                <span class="text-[18px] font-semibold tracking-[-0.02em] text-ml-fg">MarkLayer</span>
              </a>
              <div class="flex items-center gap-3">
                <a
                  href="https://www.producthunt.com/posts/marklayer"
                  target="_blank"
                  rel="noopener"
                  class="inline-flex items-center justify-center size-11 sm:size-9 rounded-lg text-ml-fg/60 hover:text-ml-fg hover:bg-ml-fg/[0.04] transition-colors"
                >
                  <span class="sr-only">Product Hunt</span>
                  <svg class="size-5 fill-current" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M13.604 8.4h-3.405V12h3.405a1.8 1.8 0 0 0 0-3.6ZM12 0C5.372 0 0 5.372 0 12s5.372 12 12 12 12-5.372 12-12S18.628 0 12 0Zm1.604 14.4h-3.405V18H7.801V6h5.804a4.2 4.2 0 0 1 0 8.4Z" />
                  </svg>
                </a>
                <GithubLink dark />
              </div>
            </nav>

            {/* Hero */}
            <section class="mx-auto flex w-full max-w-280 flex-1 flex-col justify-center px-6 pt-14 pb-16 text-center sm:px-10 sm:pt-6 sm:pb-36">
              {/* The eyebrow badge (Chrome Web Store icon plus five stars in a
                tinted pill) is gone: a rating chip above the headline is the
                stock hero decoration, and the stars claimed a rating the store
                page has to back up. */}
              <h1
                class="lp-fade-up mx-auto mb-5 max-w-[21ch] text-[clamp(38px,6vw,62px)] font-semibold leading-[1.04] tracking-[-0.035em] text-balance text-ml-fg"
                style={{ animationDelay: '0.05s' }}
              >
                {copy.headlinePrefix} {copy.headlineJoiner} <ChannelCycle /> {copy.headlineSuffix}
              </h1>

              <p
                class="lp-fade-up text-[17px] text-ml-fg/60 mb-9 max-w-[460px] mx-auto leading-[1.6]"
                style={{ animationDelay: '0.1s' }}
              >
                Send your client one link. They comment straight on the live page in their own browser, without signing
                up or installing anything.
              </p>

              {isMobileDevice ? (
                <div
                  class="lp-fade-up max-w-[400px] mx-auto mb-12 px-6 py-5 rounded-2xl bg-white border border-ml-fg/[0.06] text-center"
                  style={{ animationDelay: '0.3s' }}
                >
                  <Monitor size={24} class="text-ml-fg/60 mx-auto mb-3" aria-hidden="true" />
                  <p class="text-[14px] font-semibold text-ml-fg/70 m-0 mb-1">Desktop only</p>
                  <p class="text-[13px] text-ml-fg/60 m-0">Open this page on your computer to get started.</p>
                </div>
              ) : (
                <>
                  {/* The URL box leads, the extension follows. Installing is the
                    high-friction ask — a store visit and a permissions prompt —
                    while pasting a URL delivers the product in one step with
                    nothing to install. Leading with the install asked cold
                    traffic to commit before anything had been demonstrated. */}
                  <form
                    class="lp-fade-up max-w-[520px] mx-auto mb-3"
                    style={{ animationDelay: '0.15s' }}
                    onSubmit={(e) => {
                      e.preventDefault();
                      const el = e.currentTarget.elements.namedItem('url');
                      if (!(el instanceof HTMLInputElement)) return;
                      const input = el.value.trim();
                      if (!input) return;
                      let url = input;
                      if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
                      navigateTo(url);
                    }}
                  >
                    {/* Pill, to match the CTA: every interactive affordance on the
                      page uses one radius, so the shape language reads as a
                      system rather than a pile of components. */}
                    <div class="flex items-center gap-3 pl-5 pr-2 py-3 rounded-full bg-white border border-ml-fg/[0.16] focus-within:border-ml-fg/40 transition-colors">
                      <Search size={17} class="text-ml-fg/60 shrink-0" aria-hidden="true" />
                      {/* 16px under `sm`: iOS Safari zooms the whole page when a
                        focused field's text is under 16px, and this is the first
                        thing anyone taps on the homepage. */}
                      {/* A placeholder is not a label — it is the only thing
                        naming this field, and it disappears the moment anyone
                        types. The hero composition has no room for a visible
                        label above the pill, so the name is carried for screen
                        readers instead of being left unsaid. */}
                      <input
                        name="url"
                        type="text"
                        inputMode="url"
                        aria-label="Page URL to annotate"
                        placeholder="Paste any URL to annotate…"
                        autocomplete="url"
                        class="flex-1 bg-transparent border-none text-ml-fg text-[16px] sm:text-[15px] placeholder:text-ml-fg/60 outline-none"
                        onInput={(e) => {
                          const v = e.currentTarget.value.trim();
                          urlReady.value = v.length > 0 && /^(https?:\/\/)?[\w.-]+\.[a-z]{2,}/i.test(v);
                        }}
                      />
                      <button
                        type="submit"
                        aria-label="Go"
                        class={cn(
                          'shrink-0 w-9 h-9 rounded-full grid place-items-center border-none cursor-pointer transition-colors duration-200',
                          urlReady.value
                            ? 'text-ml-btn-fg bg-ml-btn shadow-sm'
                            : 'text-ml-fg/60 bg-ml-fg/[0.04] hover:bg-ml-fg/[0.08]',
                        )}
                      >
                        <ArrowRight size={16} aria-hidden="true" />
                      </button>
                    </div>
                  </form>

                  <div
                    class="lp-fade-up flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-[14px] text-ml-fg/60 mb-8"
                    style={{ animationDelay: '0.2s' }}
                  >
                    <span>Or try one:</span>
                    {[
                      { name: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Web_annotation' },
                      { name: 'Hacker News', url: 'https://news.ycombinator.com' },
                      { name: 'Product Hunt', url: 'https://www.producthunt.com/products/marklayer' },
                    ].map(({ name, url }) => (
                      <button
                        key={name}
                        type="button"
                        onClick={() => navigateTo(url)}
                        class="text-ml-fg/70 hover:text-ml-fg transition-colors cursor-pointer bg-transparent border-none text-[14px] p-0 underline underline-offset-2 decoration-ml-fg/30"
                      >
                        {name}
                      </button>
                    ))}
                  </div>

                  {/* The signature, said out loud. The demo cursors, the canvas
                    and the toolbar were always real and always running here, but
                    nothing told anyone — so three strangers' cursors drifting
                    over the copy read as a rendering fault rather than as the
                    product demonstrating itself. This one line is checkable: the
                    toolbar it points at is the extension's own, and the strokes
                    it draws are real ops. */}
                  <p class="lp-fade-up mb-12 text-[15px] text-ml-fg/60" style={{ animationDelay: '0.22s' }}>
                    This page is a live MarkLayer board.{' '}
                    <span class="font-medium text-ml-fg">Pick a tool below and draw on it.</span>
                  </p>

                  {/* The bottom edge of the first screen, composed rather than
                    wherever the stack happened to end: the second ask and the
                    three checkable claims sit together as the fold's floor. */}
                  <div class="lp-fade-up flex flex-col items-center gap-3" style={{ animationDelay: '0.25s' }}>
                    <ChromeStoreLink label="Add to Chrome · It's Free" class="justify-center" />
                    <p class="m-0 max-w-[52ch] text-[13px] text-ml-fg/60 text-pretty">
                      Optional. Everything above works without it; the extension adds pages behind a login, and sites
                      that block embedding.
                    </p>
                    {/* Verifiable claims only. The page previously carried a
                        five-star chip with no source; these three are checkable:
                        the licence is in the repo and the link goes to it. */}
                    <p class="m-0 flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1 text-[13px] text-ml-fg/60">
                      <span>No account, ever</span>
                      <span aria-hidden="true">·</span>
                      <a
                        href="https://github.com/thevrus/MarkLayer"
                        target="_blank"
                        rel="noopener"
                        class="text-ml-fg/60 hover:text-ml-fg transition-colors underline underline-offset-2 decoration-ml-fg/30"
                      >
                        Open source, Apache-2.0
                      </a>
                      <span aria-hidden="true">·</span>
                      <span>Self-hostable</span>
                    </p>
                  </div>
                </>
              )}
            </section>
          </div>

          {/* The signature section: one real session, shown large and centred,
              with the three claims named underneath it on a shared grid.

              This replaced an eight-cell grid of icon + label + sentence, each
              cell ringed in a hairline — eight things at identical weight is no
              hierarchy at all — and then a left-spine version whose artifacts
              were small objects parked beside the copy, which was tidy and
              completely inert. The page under review is the point; the copy
              names what you are already looking at. */}
          <section class="px-6 py-20 text-center sm:px-10 sm:py-28">
            <div class="mx-auto max-w-280">
              <h2 class="mx-auto max-w-[20ch] text-[clamp(28px,4.2vw,44px)] leading-[1.06] font-semibold tracking-[-0.03em] text-balance text-ml-fg">
                Three things it does that a screenshot in a thread cannot.
              </h2>
              <p class="mx-auto mt-5 max-w-[52ch] text-[17px] leading-[1.6] text-ml-fg/60 text-pretty">
                Somebody else&rsquo;s page, opened from a link and marked up in the browser. No install on either end.
              </p>

              {/* A real screenshot, not a mock.

                  This slot has been through two failed versions: three small
                  objects parked beside three paragraphs (inert), then a
                  hand-built "page under review" card (a heading, two grey nav
                  bars and a button on white — which reads as a wireframe,
                  because with no real imagery a four-element box is a wireframe).
                  The product is an annotation layer over somebody's live page,
                  so the only honest way to show it is a capture of exactly that:
                  MarkLayer open on a real article, with real ops on it. */}
              <figure class="mx-auto mt-16 mb-0 max-w-[1000px] sm:mt-20">
                <img
                  src="/product-review-wikipedia.webp"
                  width={1440}
                  height={900}
                  alt="MarkLayer open on the Wikipedia article for Web annotation. The opening sentence is highlighted in pink, an arrow is drawn from the text toward the language switcher, and a numbered comment pin sits on the title. The MarkLayer toolbar floats over the page and the share bar shows one other person online."
                  loading="lazy"
                  decoding="async"
                  class="block w-full rounded-2xl shadow-[0_1px_2px_rgba(26,26,26,0.05),0_18px_36px_-24px_rgba(26,26,26,0.28)]"
                />
                <figcaption class="mt-4 text-[13px] text-ml-fg/60">
                  A live Wikipedia article, opened from a share link and marked up in the browser.
                </figcaption>
              </figure>

              {/* Equal columns on one grid: every title sits on the same line
                  and every description starts on the same line, whatever the
                  copy length, so a longer sentence in one column can never push
                  its neighbours out of step. */}
              <div class="mx-auto mt-24 grid max-w-[960px] grid-cols-1 gap-x-12 gap-y-10 sm:mt-28 sm:grid-cols-3 sm:grid-rows-[auto_auto]">
                {MOMENTS.map((m) => (
                  <div key={m.title} class="grid gap-y-3 sm:row-span-2 sm:grid-rows-subgrid">
                    <h3 class="text-[19px] font-semibold tracking-[-0.02em] text-ml-fg">{m.title}</h3>
                    <p class="m-0 text-[15px] leading-[1.6] text-ml-fg/70 text-pretty">{m.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* Switching from another tool */}
          <section class="mx-auto w-full max-w-280 px-6 py-20 text-center sm:px-10 sm:py-28">
            {/* No tracked-caps kicker above the heading: the label added no
                information the heading did not already carry. */}
            <h2 class="mx-auto mb-5 max-w-[24ch] text-[clamp(26px,4vw,40px)] leading-[1.08] font-semibold tracking-[-0.03em] text-balance text-ml-fg">
              Free alternative to BugHerd, Marker.io, Pastel, and Markup.io.
            </h2>
            {/* The durability argument, not just the price. The pricing claims
                live in home-copy.json, shared with HomeContent.astro. */}
            <p class="mx-auto mb-5 max-w-[62ch] text-[16px] leading-[1.7] text-ml-fg/70 text-pretty">
              {copy.pricingFacts} MarkLayer is free by licence rather than by current pricing policy, so it cannot be
              withdrawn from under a client workflow: the code is Apache-2.0 and you can self-host it.{' '}
              <a href="/guides/free-website-annotation-tools" class="underline underline-offset-2 decoration-ml-fg/30">
                See the full audit
              </a>
              , checked against each vendor's live pricing page.
            </p>
            <p class="mx-auto max-w-[62ch] text-[13px] leading-[1.7] text-ml-fg/60">
              See{' '}
              <a href="/compare" class="text-ml-fg/60 underline hover:text-ml-fg/80">
                all 10 head-to-head comparisons
              </a>
              ,{' '}
              <a href="/alternatives" class="text-ml-fg/60 underline hover:text-ml-fg/80">
                free alternatives by tool
              </a>
              , or the no-extension flow for{' '}
              <a href="/for/staging-feedback-no-extension" class="text-ml-fg/60 underline hover:text-ml-fg/80">
                client feedback on a staging site
              </a>
              .
            </p>
          </section>

          {/* FAQ */}
          <section class="mx-auto w-full max-w-280 px-6 pb-20 sm:px-10 sm:pb-28">
            {/* Rows are separated by a surface step, not by the hairline rule
                that used to sit on top of each one. A bare unrounded line used
                to fake structure is the cheapest divider there is, and eight of
                them stacked read as a table. */}
            <div class="mx-auto flex max-w-[760px] flex-col gap-2">
              {[
                {
                  q: 'Does the other person need the extension installed?',
                  a: 'No. Anyone can view your annotations via the share link. No install required.',
                },
                { q: 'Is it really free?', a: 'Yes. No account, no paywall, no trial period.' },
                { q: 'Does it work on any website?', a: 'Yes, MarkLayer works on any webpage.' },
                {
                  q: 'Can multiple people annotate at the same time?',
                  a: 'Yes. Real-time cursors let you collaborate live on any page.',
                },
              ].map((item) => (
                <details key={item.q} class="group rounded-2xl bg-white px-5 py-4 sm:px-6 sm:py-5">
                  <summary class="flex items-center justify-between cursor-pointer list-none text-[15px] font-semibold text-ml-fg">
                    {item.q}
                    <ChevronDown
                      size={16}
                      class="text-ml-fg/60 shrink-0 ml-4 transition-transform duration-200 group-open:rotate-180"
                      aria-hidden="true"
                    />
                  </summary>
                  <p class="text-[14px] text-ml-fg/60 leading-relaxed mt-3 mb-0">{item.a}</p>
                </details>
              ))}
            </div>
          </section>

          {/* Bottom CTA */}
          <section class="px-6 pt-24 pb-16 text-center sm:px-10 sm:pt-32">
            <h2 class="mx-auto mb-6 max-w-[16ch] text-[clamp(30px,5vw,48px)] font-semibold leading-[1.05] tracking-[-0.03em] text-balance text-ml-fg">
              Start annotating any page on the web.
            </h2>
            <ChromeStoreLink label="Add to Chrome" />
            <p class="text-[12px] text-ml-fg/60 mt-3">Free to use &middot; No sign-up required</p>
          </section>

          {/* Footer — the one place a hard surface break is meant: the page
              steps onto its own floor instead of being ruled off with a
              hairline. */}
          <footer class="bg-ml-board-deep px-6 pt-14 pb-10 sm:px-10">
            <div class="mx-auto mb-12 grid max-w-[900px] grid-cols-2 gap-x-8 gap-y-10 text-[13px] md:grid-cols-4">
              <div>
                <div class="text-ml-fg font-semibold mb-3 text-[13px] tracking-[0.011em]">Product</div>
                <ul class="space-y-2">
                  <li>
                    <a href={HOW_IT_WORKS_PATH} class="hover:text-ml-fg transition-colors no-underline text-ml-fg/70">
                      How it works
                    </a>
                  </li>
                  <li>
                    <a href="/pricing" class="hover:text-ml-fg transition-colors no-underline text-ml-fg/70">
                      Pricing
                    </a>
                  </li>
                  <li>
                    <a href="/privacy" class="hover:text-ml-fg transition-colors no-underline text-ml-fg/70">
                      Privacy
                    </a>
                  </li>
                  <li>
                    <a
                      href="https://github.com/thevrus/MarkLayer"
                      target="_blank"
                      rel="noopener"
                      class="hover:text-ml-fg transition-colors no-underline text-ml-fg/70"
                    >
                      GitHub
                    </a>
                  </li>
                  <li>
                    <a
                      href="mailto:rusinvadym@gmail.com"
                      class="hover:text-ml-fg transition-colors no-underline text-ml-fg/70"
                    >
                      Contact
                    </a>
                  </li>
                </ul>
              </div>
              <div>
                <a
                  href="/compare"
                  class="block text-ml-fg font-semibold mb-3 text-[13px] tracking-[0.011em] no-underline hover:text-ml-fg/70 transition-colors"
                >
                  Compare
                </a>
                <ul class="space-y-2">
                  <li>
                    <a href="/vs/markup-io" class="hover:text-ml-fg transition-colors no-underline text-ml-fg/70">
                      MarkLayer vs Markup.io
                    </a>
                  </li>
                  <li>
                    <a href="/vs/pastel" class="hover:text-ml-fg transition-colors no-underline text-ml-fg/70">
                      MarkLayer vs Pastel
                    </a>
                  </li>
                  <li>
                    <a href="/vs/bugherd" class="hover:text-ml-fg transition-colors no-underline text-ml-fg/70">
                      MarkLayer vs BugHerd
                    </a>
                  </li>
                  <li>
                    <a href="/vs/hypothesis" class="hover:text-ml-fg transition-colors no-underline text-ml-fg/70">
                      MarkLayer vs Hypothesis
                    </a>
                  </li>
                </ul>
              </div>
              <div>
                <a
                  href="/alternatives"
                  class="block text-ml-fg font-semibold mb-3 text-[13px] tracking-[0.011em] no-underline hover:text-ml-fg/70 transition-colors"
                >
                  Free alternatives
                </a>
                <ul class="space-y-2">
                  <li>
                    <a
                      href="/alternatives/markup-io"
                      class="hover:text-ml-fg transition-colors no-underline text-ml-fg/70"
                    >
                      Markup.io alternatives
                    </a>
                  </li>
                  <li>
                    <a
                      href="/alternatives/pastel"
                      class="hover:text-ml-fg transition-colors no-underline text-ml-fg/70"
                    >
                      Pastel alternatives
                    </a>
                  </li>
                  <li>
                    <a
                      href="/alternatives/bugherd"
                      class="hover:text-ml-fg transition-colors no-underline text-ml-fg/70"
                    >
                      BugHerd alternatives
                    </a>
                  </li>
                </ul>
              </div>
              <div>
                <a
                  href="/use-cases"
                  class="block text-ml-fg font-semibold mb-3 text-[13px] tracking-[0.011em] no-underline hover:text-ml-fg/70 transition-colors"
                >
                  Use cases
                </a>
                <ul class="space-y-2">
                  <li>
                    <a href="/for/design-review" class="hover:text-ml-fg transition-colors no-underline text-ml-fg/70">
                      Design review
                    </a>
                  </li>
                  <li>
                    <a
                      href="/for/qa-bug-reporting"
                      class="hover:text-ml-fg transition-colors no-underline text-ml-fg/70"
                    >
                      QA & bug reporting
                    </a>
                  </li>
                  <li>
                    <a
                      href="/for/client-feedback"
                      class="hover:text-ml-fg transition-colors no-underline text-ml-fg/70"
                    >
                      Client feedback
                    </a>
                  </li>
                  <li>
                    <a href="/for/remote-teams" class="hover:text-ml-fg transition-colors no-underline text-ml-fg/70">
                      Remote teams
                    </a>
                  </li>
                </ul>
              </div>
            </div>
            <div class="flex justify-center mb-5">
              <a
                href="https://www.producthunt.com/products/marklayer?embed=true&utm_source=badge-featured&utm_medium=badge&utm_campaign=badge-marklayer"
                target="_blank"
                rel="noopener"
              >
                <img
                  src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=1105463&theme=light"
                  alt="MarkLayer - Draw & comment on any webpage. Share one live link | Product Hunt"
                  width="250"
                  height="54"
                  style={{ width: '250px', height: '54px' }}
                  loading="lazy"
                  decoding="async"
                />
              </a>
            </div>
            <div class="flex items-center justify-center gap-2 text-[12px] text-ml-fg/60">
              <Logo size={14} />
              <span>MarkLayer &copy; {new Date().getFullYear()}</span>
            </div>
          </footer>
        </main>

        {/* Comment overlay */}
        <div
          class="fixed inset-0 z-2147483646 overflow-hidden"
          style={{
            pointerEvents: showCommentCursor ? 'auto' : 'none',
            cursor: showCommentCursor ? 'crosshair' : 'default',
          }}
          onClick={(e) => {
            if (tool !== 'comment') return;
            commentPopover.value = { x: e.clientX, y: e.clientY + (window.scrollY || 0) };
          }}
        >
          {comments.map((c) => (
            <WebCommentPin key={c.id} op={c} scale={1} scrollY={window.scrollY || 0} />
          ))}
          {commentPopover.value && (
            <WebCommentPopover
              x={commentPopover.value.x}
              y={commentPopover.value.y}
              scale={1}
              scrollY={window.scrollY || 0}
              onClose={() => {
                commentPopover.value = null;
              }}
            />
          )}
        </div>

        {/* Selection highlights */}
        <div class="fixed inset-0 z-2147483645 pointer-events-none overflow-hidden">
          {selections.value.map((op) => (
            <WebSelectionHighlight key={op.id} op={op} scale={1} scrollY={window.scrollY || 0} />
          ))}
        </div>
        {selectionPopover.value && (
          <WebSelectionPopover
            {...selectionPopover.value}
            onClose={() => {
              selectionPopover.value = null;
            }}
          />
        )}

        {/* Text tool overlay */}
        <div
          class="fixed inset-0 z-2147483646"
          style={{ pointerEvents: showTextCursor ? 'auto' : 'none', cursor: showTextCursor ? 'text' : 'default' }}
          onClick={(e) => {
            if (tool !== 'text') return;
            textInput.value = { x: e.clientX, y: e.clientY + (window.scrollY || 0) };
          }}
        />
        {textInput.value && (
          <TextInputOverlay
            x={textInput.value.x}
            y={textInput.value.y}
            scale={1}
            scrollY={window.scrollY || 0}
            onCommit={(text) => {
              if (text && textInput.value) {
                const op: TextOp = {
                  id: nanoid(),
                  tool: 'text',
                  text,
                  x: textInput.value.x,
                  y: textInput.value.y,
                  fontSize: Math.max(14, lineWidth.value * 6),
                  color: color.value,
                  lineWidth: lineWidth.value,
                  captureViewport: { width: window.innerWidth, height: window.innerHeight },
                };
                pushDeviceOp(op);
              }
              textInput.value = null;
            }}
          />
        )}

        <canvas
          ref={canvasRef}
          onMouseDown={onDown}
          class="absolute inset-x-0 top-0 z-2147483645"
          style={{
            height: '100%',
            pointerEvents: showCanvas ? 'auto' : 'none',
            cursor: showCanvas ? 'crosshair' : 'default',
          }}
        />

        <InspectorLayer />

        <div class="lp-toolbar-in hidden sm:block z-2147483647">
          <Toolbar />
        </div>

        {toasts.value.length > 0 && (
          <div class="fixed top-12 left-1/2 -translate-x-1/2 z-2147483647 flex flex-col gap-2 items-center">
            {toasts.value.map((t) => (
              <div
                key={t.id}
                class={`${glass.surfaceSmall} ${glass.font} px-4 py-2.5 text-xs font-medium animate-[fadeInDown_0.2s_ease-out] ${t.type === 'error' ? 'text-red-500' : t.type === 'success' ? 'text-green-500' : 'text-ml-glass-fg/70'}`}
              >
                {t.message}
              </div>
            ))}
          </div>
        )}
      </div>
      <SelfCursor />
    </>
  );
}
