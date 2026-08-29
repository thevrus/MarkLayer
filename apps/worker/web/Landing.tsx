import { InspectorLayer } from '@ext/components/InspectorLayer';
import { Toasts } from '@ext/components/Toasts';
import { Toolbar } from '@ext/components/Toolbar';
import { hexToRgba, inView, opBounds, renderOp, simplify, strokeArrowHead } from '@ext/lib/renderer';
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
  selections,
  showAnnotationPanel,
  showShareDialog,
  toolForKeyEvent,
  undo,
  undoRedoFlash,
} from '@ext/lib/state';
import type { FreehandOp, Point, TextOp } from '@ext/lib/types';
import { cn } from '@marklayer/types';
import { useSignalEffect } from '@preact/signals';
import copy from '@site/data/home-copy.json';
import { ASK_AI, ASK_AI_LABEL, COLOPHON, FOOTER_COLUMNS, TRADEMARK_NOTICE } from '@site/lib/footer';
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
  seedDeviceOp,
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

/**
 * The nav's links. The page shipped with a logo, two icon links and no
 * navigation at all, while the footer carried twenty — so the only way into the
 * comparison and use-case pages was to scroll past everything first.
 */
const NAV_LINKS: { label: string; href: string }[] = [
  { label: 'How it works', href: HOW_IT_WORKS_PATH },
  { label: 'Compare', href: '/compare' },
  { label: 'Use cases', href: '/use-cases' },
  { label: 'Pricing', href: '/pricing' },
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

/**
 * The one seeded annotation on the board.
 *
 * A fixed id rather than a nanoid, so a re-mount can never stack a second copy
 * of it. The landing never calls `restoreDraft`, so every load starts from an
 * empty op list and this is the only thing on the board until a visitor draws.
 *
 * It is a real CommentOp on the real op stream: the pin it renders is
 * WebCommentPin, clicking it opens the actual thread, and replying, resolving
 * or deleting it all work exactly as they do on a shared page. The page claims
 * to be a live board one line above the toolbar; this is the claim being true
 * rather than asserted.
 */
const HERO_PIN_ID = 'ml-hero-pin';

const CTA_CLS =
  'lp-cta inline-flex items-center gap-2 h-12 px-7 rounded-full text-white text-body font-medium no-underline transition-colors select-none';

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
  const heroFormRef = useRef<HTMLFormElement>(null);
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
              strokeArrowHead(ctx, { start: sp, end: pos, lineWidth: ctx.lineWidth });
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
      const m = toolForKeyEvent(e);
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

  /* Put one real annotation on the board.

     Measured off the URL field rather than hard-coded, so the pin sits on it at
     every width instead of drifting into the copy on a narrow screen. It waits
     for `document.fonts.ready` and then a frame: the hero's height depends on
     Geist's metrics and on ChannelCycle measuring its word slot, and both land
     after first paint — measuring in a plain mount effect put the pin ~300px
     high, above the headline instead of on the field. */
  useEffect(() => {
    let cancelled = false;

    const place = () => {
      const form = heroFormRef.current;
      if (cancelled || !form) return;
      const r = form.getBoundingClientRect();
      // A zero-width rect means layout still has not settled; placing the pin
      // off that would park it against the left edge of the page.
      if (r.width === 0) return;
      // Just off the field's right edge, level with its centre.
      //
      // It sat on the field's top-right corner until a click test showed it
      // covering a 16x12px bite out of the submit button — the pin layer
      // re-enables pointer events for the pin itself, so `elementFromPoint` on
      // the button's own corner returned the pin and that corner was dead. It
      // still reads as attached to the field at this distance, and it no longer
      // sits on top of the page's primary action.
      const x = r.right + window.scrollX + 30;
      const y = r.top + r.height / 2 + window.scrollY;
      const seeded = operations.peek().find((op) => op.id === HERO_PIN_ID);
      if (seeded) {
        if (seeded.tool !== 'comment' || (seeded.x === x && seeded.y === y)) return;
        operations.value = operations.peek().map((op) => (op.id === HERO_PIN_ID ? { ...op, x, y } : op));
        return;
      }
      seedDeviceOp({
        id: HERO_PIN_ID,
        tool: 'comment',
        num: 1,
        text: 'This pin is real. Open it, reply to it, resolve it, then drop your own anywhere on the page.',
        x,
        y,
        // From the peer-cursor palette, so the mark belongs to the same
        // vocabulary as the people already on the board.
        color: '#8b5cf6',
        lineWidth: lineWidth.peek(),
        ts: Date.now(),
        author: 'Yuki',
      });
    };

    let timer: ReturnType<typeof setTimeout>;
    // Only the viewport changing moves the field. Watching the document instead
    // would re-place the pin every time a FAQ row opened.
    const onResize = () => {
      clearTimeout(timer);
      timer = setTimeout(place, 120);
    };
    document.fonts.ready.then(() => {
      requestAnimationFrame(place);
    });
    window.addEventListener('resize', onResize);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      window.removeEventListener('resize', onResize);
    };
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
        selectionPopover.value = { text, rects, screenX: last.right, screenY: last.bottom, auto: false };
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
      {/* The board.

          The page is not a page *about* an annotation tool; it is a page that
          has been annotated. Every mark on this first screen is real — the
          canvas is the product's canvas, the toolbar is the product's toolbar,
          the strokes are real ops and the highlight under the headline is the
          highlighter tool's own 40%-alpha swipe. Nothing here is a drawing of
          the product pretending to be the product. */}
      <div class="ml-force-light lp-voice relative min-h-screen overflow-x-hidden lp-board">
        {/* No page-wide column. The content column used to be 800px wide on any
            viewport, which read as a narrow tube down the middle of a dead white
            field — packed inside, empty outside. Each section now owns its own
            width, and the live annotation layer gets the outer margins. */}
        <main class="min-h-screen sm:min-h-0">
          {/* The first screen is composed as one frame: nav, hero and the board
              line share a 100svh column, so the fold ends where the composition
              ends instead of letting the next section peek in 151px high and
              unaligned. */}
          <div class="relative flex flex-col sm:min-h-[100svh]">
            {/* The demo cursors belong to this frame and scroll away with it. */}
            <FakeCursors />

            {/* Nav. It carries real navigation now — the page previously had a
                logo, two icons and no links at all, while the footer carried
                twenty. Contained to the same column the hero sits in, so the
                wordmark and the headline share one left margin. */}
            <nav class="lp-fade-up relative z-1 mx-auto flex w-full max-w-280 items-center justify-between gap-6 px-6 pt-6 sm:px-10">
              <a href="/" class="flex items-center gap-2.5 no-underline">
                <Logo size={34} />
                {/* Solid ink. A gradient clipped into the wordmark is decoration
                  the eye reads as a rendering artifact at this size. The
                  wordmark tracks the mark's size so the lockup keeps its
                  proportion instead of the glyph outgrowing the name. */}
                <span class="text-heading font-medium tracking-brand text-ml-fg">MarkLayer</span>
              </a>
              <div class="flex items-center gap-0.5 sm:gap-1">
                {/* From 640, not 768. Below that the links existed only in the
                    footer, which put every comparison and use-case page behind a
                    full-page scroll on the widths most likely to be a small
                    laptop. */}
                <div class="mr-1 hidden items-center sm:flex">
                  {NAV_LINKS.map(({ label, href }) => (
                    <a
                      key={href}
                      href={href}
                      class="rounded-full px-3 py-1.5 text-ui-lg text-ml-fg/70 no-underline transition-colors hover:bg-ml-fg/[0.05] hover:text-ml-fg"
                    >
                      {label}
                    </a>
                  ))}
                </div>
                <a
                  href="https://www.producthunt.com/posts/marklayer"
                  target="_blank"
                  rel="noopener"
                  class="inline-flex items-center justify-center size-11 sm:size-9 rounded-full text-ml-fg/60 hover:text-ml-fg hover:bg-ml-fg/[0.05] transition-colors"
                >
                  <span class="sr-only">Product Hunt</span>
                  <svg class="size-[18px] fill-current" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M13.604 8.4h-3.405V12h3.405a1.8 1.8 0 0 0 0-3.6ZM12 0C5.372 0 0 5.372 0 12s5.372 12 12 12 12-5.372 12-12S18.628 0 12 0Zm1.604 14.4h-3.405V18H7.801V6h5.804a4.2 4.2 0 0 1 0 8.4Z" />
                  </svg>
                </a>
                <GithubLink dark />
              </div>
            </nav>

            {/* Hero. Left-anchored on the same margin as the wordmark, not
                centred: seven stacked centre-aligned rows floating in an empty
                field is the default hero stack, and it left the whole right of
                the screen reading as dead space rather than as board. The copy
                holds the left; the board's working area — where the marks and
                the other people's cursors are — holds the right. */}
            <section class="relative mx-auto flex w-full max-w-280 flex-1 flex-col justify-center px-6 pb-28 pt-14 sm:px-10 sm:pb-36 sm:pt-8">
              <div class="max-w-[1080px]">
                {/* Two lines, never three — the measure is set wide enough that
                  the longest channel word ("WhatsApp") still lands on line two
                  rather than starting a third. The display statement spans the
                  column while the action block below it stays on a reading
                  measure, so the fold is a wide headline over a left-anchored
                  column rather than a text block with dead space beside it.

                  The cycling word carries a live highlighter mark (see
                  ChannelCycle) which holds the slot through the ~300ms the
                  glyphs spend at zero opacity — before, the headline showed a
                  hole mid-swap. */}
                {/* The two lines are explicit, and `text-balance` is
                  deliberately absent.

                  Left to wrap on its own the headline re-broke every time the
                  channel word swapped — "WhatsApp" is far wider than "Email", so
                  the line count changed under it and the entire page below
                  jumped on a 2.6s loop. Balancing made it worse, because
                  `text-wrap: balance` recomputes the break points on every width
                  change rather than holding them.

                  Splitting the lines by hand means only line two contains the
                  cycling slot, and that line is measured to hold the longest
                  channel name at the largest step of the clamp, so the block's
                  height is constant and the only thing that ever moves is
                  "Thread." sliding sideways — which is the intended effect.

                  Line one still wraps below ~430px, so the phone rendering is
                  three lines rather than two. That is fine and it is not the
                  bug this fixes: the wrap there is the same on every tick,
                  because it depends on the fixed prefix and not on which
                  channel word happens to be in the slot. */}
                <h1 class="lp-display lp-fade-up text-hero text-ml-fg" style={{ animationDelay: '0.05s' }}>
                  <span class="block">{copy.headlinePrefix}</span>
                  <span class="block">
                    {copy.headlineJoiner} <ChannelCycle /> {copy.headlineSuffix}
                  </span>
                </h1>
              </div>

              <p
                class="lp-fade-up mt-6 max-w-[44ch] text-lede leading-body text-ml-fg/70"
                style={{ animationDelay: '0.1s' }}
              >
                Send your client one link. They comment straight on the live page in their own browser, without signing
                up or installing anything.
              </p>

              {isMobileDevice ? (
                <div
                  class="lp-fade-up lp-panel mt-9 max-w-[400px] rounded-xl px-5 py-5"
                  style={{ animationDelay: '0.3s' }}
                >
                  <Monitor size={22} class="text-ml-fg/60 mb-3" aria-hidden="true" />
                  <p class="text-ui-lg font-semibold text-ml-fg m-0 mb-1">Desktop only</p>
                  <p class="text-ui text-ml-fg/60 m-0">Open this page on your computer to get started.</p>
                </div>
              ) : (
                <>
                  {/* The URL box leads, the extension follows. Installing is the
                    high-friction ask — a store visit and a permissions prompt —
                    while pasting a URL delivers the product in one step with
                    nothing to install. Leading with the install asked cold
                    traffic to commit before anything had been demonstrated. */}
                  <form
                    ref={heroFormRef}
                    class="lp-fade-up mt-9 max-w-[520px]"
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
                    {/* Pill, on the page's one elevation primitive: a hairline
                      ring and a 2px contact shadow, the same treatment every
                      other object on the board gets. The focus state tightens
                      the ring rather than adding a second one outside it. */}
                    <div class="lp-panel lp-field flex items-center gap-3 rounded-full py-2 pl-5 pr-2">
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
                        class="h-10 flex-1 bg-transparent border-none text-ml-fg text-base sm:text-body placeholder:text-ml-fg/60 outline-none"
                        onInput={(e) => {
                          const v = e.currentTarget.value.trim();
                          urlReady.value = v.length > 0 && /^(https?:\/\/)?[\w.-]+\.[a-z]{2,}/i.test(v);
                        }}
                      />
                      <button
                        type="submit"
                        aria-label="Go"
                        class={cn(
                          'shrink-0 w-11 h-11 sm:w-10 sm:h-10 rounded-full grid place-items-center border-none cursor-pointer transition-colors duration-200',
                          urlReady.value
                            ? 'text-ml-btn-fg bg-ml-btn hover:bg-[#383838]'
                            : 'text-ml-fg/60 bg-ml-fg/[0.05] hover:bg-ml-fg/[0.09]',
                        )}
                      >
                        <ArrowRight size={16} aria-hidden="true" />
                      </button>
                    </div>
                  </form>

                  <div
                    class="lp-fade-up mt-3.5 flex flex-wrap items-center gap-x-4 gap-y-2 text-ui-lg text-ml-fg/60"
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
                        class="-my-3 inline-flex min-h-11 cursor-pointer items-center rounded border-none bg-transparent py-3 text-ui-lg text-ml-fg/70 underline underline-offset-2 decoration-ml-fg/30 transition-colors hover:text-ml-fg"
                      >
                        {name}
                      </button>
                    ))}
                  </div>

                  {/* One quiet line, not a second filled button. A filled
                    primary next to an outlined secondary is a preset, and the
                    fold already has its one clear action above. The install ask
                    is real but secondary here; it gets the filled treatment
                    once, in the closing section. Verifiable claims only — the
                    licence link goes to the repo. */}
                  <p
                    class="lp-fade-up mt-9 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-ui text-ml-fg/60"
                    style={{ animationDelay: '0.25s' }}
                  >
                    <a
                      href={CHROME_STORE_URL}
                      target="_blank"
                      rel="noopener"
                      class="inline-flex items-center gap-1.5 text-ml-fg/70 no-underline transition-colors hover:text-ml-fg"
                    >
                      <ChromeIcon />
                      Add to Chrome
                    </a>
                    <span aria-hidden="true">·</span>
                    <span>No account, ever</span>
                    <span aria-hidden="true">·</span>
                    <a
                      href="https://github.com/thevrus/MarkLayer"
                      target="_blank"
                      rel="noopener"
                      class="text-ml-fg/60 hover:text-ml-fg transition-colors underline underline-offset-2 decoration-ml-fg/30"
                    >
                      Apache-2.0
                    </a>
                    <span aria-hidden="true">·</span>
                    <span>Self-hostable</span>
                  </p>
                </>
              )}
            </section>

            {/* The fold's floor, and the one line that makes the whole first
                screen legible: the toolbar docked below is the extension's own,
                and the strokes it draws are real ops on this page. Without it,
                three strangers' cursors drifting over the copy read as a
                rendering fault instead of as the product demonstrating itself.
                Sits above the docked toolbar and shares its centre line. */}
            <div
              class="lp-fade-up pointer-events-none absolute inset-x-0 bottom-6 hidden justify-center px-6 sm:flex sm:bottom-27"
              style={{ animationDelay: '0.3s' }}
            >
              <p class="m-0 text-ui text-ml-fg/60">
                This page is a live MarkLayer board. <span class="text-ml-fg">Pick a tool below and draw on it.</span>
              </p>
            </div>
          </div>

          {/* The proof. One real session, shown large, with the three claims
              named underneath it on a shared grid.

              This replaced an eight-cell grid of icon + label + sentence, each
              cell ringed in a hairline — eight things at identical weight is no
              hierarchy at all — and then a left-spine version whose artifacts
              were small objects parked beside the copy, which was tidy and
              completely inert. The page under review is the point; the copy
              names what you are already looking at.

              Opens left, on the same spine as the hero and the wordmark. The
              sections below it each open differently on purpose: one with a
              bare sentence, one as a two-column split, one centred. A page
              where every section starts with a heading in the same place at the
              same size reads as a template. */}
          <section class="mx-auto w-full max-w-280 px-6 pt-24 pb-20 sm:px-10 sm:pt-32 sm:pb-28">
            <h2 class="lp-display max-w-[840px] text-statement text-balance text-ml-fg">
              Three things it does that a screenshot in a thread cannot.
            </h2>
            <p class="mt-5 max-w-[52ch] text-lede leading-body text-ml-fg/70 text-pretty">
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
                MarkLayer open on a real article, with real ops on it.

                The frame is the page's one elevation primitive — a hairline
                ring and a 2px contact shadow — rather than the wide soft bloom
                it used to float on. */}
            <figure class="mx-auto mt-14 mb-0 max-w-[1040px] sm:mt-16">
              <div class="lp-panel overflow-hidden rounded-xl p-1.5">
                <img
                  src="/product-review-wikipedia.webp"
                  width={1440}
                  height={900}
                  alt="MarkLayer open on the Wikipedia article for Web annotation. The opening sentence is highlighted in pink, an arrow is drawn from the text toward the language switcher, and a numbered comment pin sits on the title. The MarkLayer toolbar floats over the page and the share bar shows one other person online."
                  loading="lazy"
                  decoding="async"
                  class="block w-full rounded-lg"
                />
              </div>
              <figcaption class="mt-4 text-ui text-ml-fg/60">
                A live Wikipedia article, opened from a share link and marked up in the browser.
              </figcaption>
            </figure>

            {/* Equal columns on one grid: every title sits on the same line
                and every description starts on the same line, whatever the
                copy length, so a longer sentence in one column can never push
                its neighbours out of step. */}
            <div class="mt-20 grid grid-cols-1 gap-x-12 gap-y-10 sm:mt-24 sm:grid-cols-3 sm:grid-rows-[auto_auto]">
              {MOMENTS.map((m) => (
                <div key={m.title} class="grid gap-y-2.5 sm:row-span-2 sm:grid-rows-subgrid">
                  <h3 class="text-lede font-semibold tracking-display text-ml-fg">{m.title}</h3>
                  <p class="m-0 text-body leading-prose text-ml-fg/70 text-pretty">{m.desc}</p>
                </div>
              ))}
            </div>
          </section>

          {/* Switching from another tool. Opens with the sentence itself — no
              heading above it, no tracked-caps kicker. The claim is the whole
              section, so wrapping it in a section head would just be a label
              restating the line underneath it. */}
          <section class="mx-auto w-full max-w-280 px-6 py-20 sm:px-10 sm:py-28">
            <h2 class="lp-display max-w-[800px] text-section text-balance text-ml-fg">
              Free alternative to BugHerd, Marker.io, Pastel, and Markup.io.
            </h2>
            {/* The durability argument, not just the price. The pricing claims
                live in home-copy.json, shared with HomeContent.astro. */}
            <div class="mt-8 grid max-w-[1000px] gap-x-14 gap-y-5 md:grid-cols-2">
              <p class="m-0 text-body leading-prose text-ml-fg/70 text-pretty">{copy.pricingFacts}</p>
              <p class="m-0 text-body leading-prose text-ml-fg/70 text-pretty">
                MarkLayer is free by licence rather than by current pricing policy, so it cannot be withdrawn from under
                a client workflow: the code is Apache-2.0 and you can self-host it.{' '}
                <a
                  href="/guides/free-website-annotation-tools"
                  class="underline underline-offset-2 decoration-ml-fg/30"
                >
                  See the full audit
                </a>
                , checked against each vendor&rsquo;s live pricing page.
              </p>
            </div>
            <p class="mt-8 max-w-[62ch] text-ui leading-prose text-ml-fg/60">
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

          {/* FAQ. A two-column split — the heading holds the left, the answers
              the right — so this section opens differently again from the two
              above it. Rows are separated by a surface step, not by the
              hairline rule that used to sit on top of each one: a bare
              unrounded line used to fake structure is the cheapest divider
              there is, and four of them stacked read as a table. */}
          <section class="mx-auto w-full max-w-280 px-6 pb-20 sm:px-10 sm:pb-28">
            <div class="grid gap-x-16 gap-y-8 md:grid-cols-[minmax(0,300px)_minmax(0,1fr)]">
              <h2 class="lp-display text-subsection text-balance text-ml-fg">Questions people ask first.</h2>
              <div class="flex flex-col gap-2">
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
                  <details key={item.q} class="lp-panel lp-panel-i group rounded-xl px-5 py-4">
                    <summary class="-my-2 flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 rounded-lg py-2 text-body font-medium text-ml-fg">
                      {item.q}
                      <ChevronDown
                        size={16}
                        class="shrink-0 text-ml-fg/60 transition-transform duration-200 group-open:rotate-180"
                        aria-hidden="true"
                      />
                    </summary>
                    <p class="mt-3 mb-0 text-ui-lg leading-relaxed text-ml-fg/70">{item.a}</p>
                  </details>
                ))}
              </div>
            </div>
          </section>

          {/* The close. The one centred moment on the page, and the only place
              the install ask gets the filled treatment — the fold carries it as
              a quiet inline link instead, so a filled primary never sits beside
              an outlined secondary anywhere here. */}
          <section class="px-6 pt-24 pb-20 text-center sm:px-10 sm:pt-32 sm:pb-24">
            <h2 class="lp-display mx-auto mb-8 max-w-[720px] text-closing text-balance text-ml-fg">
              Start annotating any page on the web.
            </h2>
            <ChromeStoreLink label="Add to Chrome" />
            <p class="mt-4 text-ui text-ml-fg/60">Free to use &middot; No sign-up required</p>
          </section>

          {/* The floor.

              The same footer the marketing pages close with
              (apps/site/src/components/SiteFooter.astro): same columns, same
              copy, same spacing, all of it read from `@site/lib/footer`. The
              two renderers differ only in the width of the column they sit in
              — this page's sections run to 1120px, an article's to 760 — and
              each footer stays on its own page's spine rather than one of them
              being flung wider than everything above it.

              It used to carry eleven hand-picked comparison and use-case links
              and no trademark line, so the footer changed shape the moment you
              clicked out of `/`. Those pages are one click away through the
              hubs that replace them, and the prerendered `/`
              (HomeContent.astro) still links them all inline for the crawlers
              that never run this bundle.

              This is the one place a hard surface break is meant: the page
              steps onto its own floor instead of being ruled off with a
              hairline.

              The gutter sits inside the capped box here, exactly as it does in
              every section above. It used to live on the <footer> itself with
              the cap on the inner div, which centred that cap 40px further out
              — so at 1440 the page's content spine was at 200px and the
              footer's at 160px, and the whole block read as slipped. */}
          <footer class="relative overflow-hidden bg-ml-board-deep pt-16 pb-7">
            <div class="mx-auto w-full max-w-280 px-6 sm:px-10">
              {/* A grid, not `flex-wrap`: wrapping drops the fourth column onto
                  its own row as soon as the links grow, leaving three columns
                  and an orphan off the shared baseline. */}
              <div class="grid grid-cols-2 gap-x-8 gap-y-9 text-ui sm:grid-cols-4">
                {FOOTER_COLUMNS.map((col) => (
                  <div key={col.heading}>
                    <p class="m-0 mb-3 text-ui font-semibold tracking-label text-ml-fg">{col.heading}</p>
                    <ul class="m-0 list-none space-y-0.5 p-0">
                      {col.links.map((l) => (
                        <li key={l.href} class="m-0 p-0">
                          <a
                            href={l.href}
                            target={l.external ? '_blank' : undefined}
                            rel={l.external ? 'noopener noreferrer' : undefined}
                            class="inline-flex min-h-9 items-center text-ml-fg/70 no-underline transition-colors duration-150 pointer-coarse:min-h-11 hover:text-ml-fg"
                          >
                            {l.label}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>

              {/* The assistant marks, laid out as a fifth column turned on its
                  side — the label takes the same quiet step as the four
                  headings above, so it reads as part of the footer rather than
                  a widget bolted under it. `-mx-2` cancels the first and last
                  marks' hit-area padding, so the row's optical gaps match the
                  gap utility instead of running 8px wide at each end. */}
              <div class="mt-10 flex flex-wrap items-center gap-x-4 gap-y-1">
                <p class="m-0 text-ui text-ml-fg/65">{ASK_AI_LABEL}</p>
                <ul class="-mx-2 m-0 flex list-none flex-wrap items-center p-0">
                  {ASK_AI.map((a) => (
                    <li key={a.label} class="m-0 p-0">
                      <a
                        href={a.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={`Ask ${a.label} about MarkLayer`}
                        class="inline-flex items-center justify-center rounded-md p-2 text-ml-fg/60 no-underline transition-colors duration-150 pointer-coarse:size-11 pointer-coarse:p-0 hover:text-ml-fg"
                      >
                        {/* An sr-only label rather than `aria-label`, the same
                            way every other bare mark on the site is named: it
                            survives translation and a stripped attribute, and
                            it is what the header's GitHub mark already does. */}
                        <span class="sr-only">Ask {a.label} about MarkLayer</span>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                          <path d={a.path} />
                        </svg>
                      </a>
                    </li>
                  ))}
                </ul>
              </div>

              {/* The two closing lines are one tier of fine print: a step
                  smaller and quieter than the link columns, so the legal
                  boilerplate is not the heaviest text on the floor. */}
              <p class="mt-10 mb-0 text-fine text-ml-fg/65">{TRADEMARK_NOTICE}</p>
              <p class="mt-5 mb-0 flex items-start gap-2 text-fine text-ml-fg/65">
                {/* Aligned to the FIRST line, not to the block: the line wraps
                    on a phone, and a centred mark then floats between the two
                    rows. */}
                <Logo size={14} class="mt-[3px] shrink-0" />
                <span>
                  &copy; {new Date().getFullYear()} MarkLayer &middot; {COLOPHON}
                </span>
              </p>
            </div>

            {/* The signature wordmark: full-bleed, cut at roughly half the cap
                height, dissolving into the floor.

                It sits outside the page's capped container on purpose — this is
                the one element that is meant to touch both edges, so it takes
                no gutter and no max-width. Sized so the word spans the viewport
                exactly at any width (see .lp-wordmark), clipped to a fraction of
                its own cap height, and faded out with a long multi-stop mask so
                the cut is never a visible line. Nothing sits beneath it.

                It is lifted a little clear of the page's bottom edge rather
                than welded to it, which is a deliberate departure from the
                usual rule for this move — flush with no gap beneath — because
                the product's own toolbar floats at the bottom of the viewport
                and swallowed the band entirely when it sat right on the edge.

                `aria-hidden` because the accessible wordmark is the one in the
                nav; this is texture, not a second heading. */}
            <div class="lp-wordmark-clip mt-12 select-none" aria-hidden="true">
              <span class="lp-wordmark">MarkLayer</span>
            </div>
          </footer>
        </main>

        {/* Comment overlay.

            Absolute, spanning the document, with `scrollY` held at 0 — the same
            way the canvas below positions its ops. These layers used to be
            `fixed` and were handed `window.scrollY` read once during render;
            nothing re-renders them on scroll, so the subtraction went stale the
            moment the page moved and every pin sat frozen at a viewport offset,
            drifting across the sections below it. Document coordinates on a
            document-height layer need no scroll arithmetic at all, so there is
            nothing left to go stale. */}
        <div
          class="absolute inset-0 z-2147483646 overflow-hidden"
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
            <WebCommentPin key={c.id} op={c} scale={1} scrollY={0} />
          ))}
          {commentPopover.value && (
            <WebCommentPopover
              x={commentPopover.value.x}
              y={commentPopover.value.y}
              scale={1}
              scrollY={0}
              onClose={() => {
                commentPopover.value = null;
              }}
            />
          )}
        </div>

        {/* Selection highlights */}
        <div class="absolute inset-0 z-2147483645 pointer-events-none overflow-hidden">
          {selections.value.map((op) => (
            <WebSelectionHighlight key={op.id} op={op} scale={1} scrollY={0} />
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
          class="absolute inset-0 z-2147483646"
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
            scrollY={0}
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

        <Toasts offset="below-bar" />
      </div>
      <SelfCursor />
    </>
  );
}
