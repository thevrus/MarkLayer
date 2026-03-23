import { Toolbar } from '@ext/components/Toolbar';
import { glass } from '@ext/lib/glass';
import { hexToRgba, inView, opBounds, renderOp, simplify } from '@ext/lib/renderer';
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
import type { DrawOp, FreehandOp, Point, TextOp } from '@ext/lib/types';
import { useSignalEffect } from '@preact/signals';
import clsx from 'clsx';
import { ArrowRight, ChevronDown, Monitor, Search } from 'lucide-preact';
import { nanoid } from 'nanoid';
import { useCallback, useEffect, useRef } from 'preact/hooks';
import { FakeCursors } from './FakeCursors';
import { FEATURES, GithubLink, Logo, TextInputOverlay } from './shared';
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
          tool: tool as FreehandOp['tool'],
          points: [pos],
          color: tool === 'highlight' ? hexToRgba(color.value, 0.4) : color.value,
          lineWidth: ctx.lineWidth,
          compositeOperation: ctx.globalCompositeOperation as GlobalCompositeOperation,
        };
      } else if (SHAPES.has(tool)) {
        const canvas = canvasRef.current!;
        snapshotRef.current = ctx.getImageData(0, 0, canvas.width, canvas.height);
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
          if (r > 0) pushDeviceOp({ ...base, tool: 'circle', centerX: sp.x, centerY: sp.y, radius: r } as DrawOp);
        } else if (tool === 'rectangle') {
          if (sp.x !== pos.x && sp.y !== pos.y)
            pushDeviceOp({
              ...base,
              tool: 'rectangle',
              startX: sp.x,
              startY: sp.y,
              endX: pos.x,
              endY: pos.y,
            } as DrawOp);
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
            } as DrawOp);
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
    let timer: number;
    const onResize = () => {
      clearTimeout(timer);
      timer = setTimeout(renderAll, 100) as unknown as number;
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
    window.addEventListener('mousemove', onMove as EventListener);
    window.addEventListener('mouseup', onUp as EventListener);
    return () => {
      window.removeEventListener('mousemove', onMove as EventListener);
      window.removeEventListener('mouseup', onUp as EventListener);
    };
  }, [onMove, onUp]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
        if (e.key === 'Escape') (e.target as HTMLElement).blur();
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
        const last = lastCr[lastCr.length - 1];
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

  const CWS_URL = 'https://chromewebstore.google.com/detail/marklayer/fnfobegjifomgobgilaemihpcpidjamc';

  const ChromeIcon = () => (
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

  const CWS_LINK = (cls: string) => (
    <a
      href={CWS_URL}
      target="_blank"
      rel="noopener"
      class={`lp-shine inline-flex items-center gap-2 h-12 px-8 rounded-[14px] bg-neutral-950 text-white text-base font-medium no-underline hover:bg-neutral-800 transition-all select-none ${cls}`}
    >
      <ChromeIcon />
      Add to Chrome
    </a>
  );

  return (
    <>
      {/* Gradient page background */}
      <div
        class="ml-force-light relative min-h-screen font-['Inter',system-ui,sans-serif] overflow-x-hidden"
        style={{
          background: 'linear-gradient(180deg, #f5e6f0 0%, #f0e8ee 25%, #f5f2f4 50%, #faf9fa 75%, #fff 100%)',
        }}
      >
        {/* Centered white container with shadow */}
        <div class="max-w-[800px] mx-auto my-0 sm:my-8 bg-white sm:rounded-3xl shadow-[0_0_0_1px_rgba(0,0,0,0.04),0_8px_40px_rgba(0,0,0,0.06)] min-h-screen sm:min-h-0">
          {/* Nav */}
          <nav class="lp-fade-up flex items-center justify-between px-8 sm:px-10 pt-6 pb-2">
            <div class="flex items-center gap-2.5">
              <Logo size={28} />
              <span class="text-[18px] font-bold tracking-[-0.02em] bg-clip-text text-transparent" style={{ backgroundImage: 'linear-gradient(180deg, #333 0%, #0a0a0a 100%)' }}>MarkLayer</span>
            </div>
            <div class="flex items-center gap-4">
              <GithubLink dark />
            </div>
          </nav>

          {/* Hero */}
          <section class="text-center pt-16 sm:pt-20 pb-6 px-8">
            {/* CWS badge with stars */}
            <a
              href={CWS_URL}
              target="_blank"
              rel="noopener"
              class="lp-fade-up inline-flex items-center gap-2 rounded-lg bg-ml-fg/[0.04] p-1.5 pr-3 no-underline mb-6 hover:bg-ml-fg/[0.07] transition-colors"
            >
              <img src="/cws-icon.svg" width="24" height="20" alt="" class="shrink-0" />
              <div class="flex gap-0.5 text-ml-fg/60">
                {Array.from({ length: 5 }, (_, i) => (
                  <svg key={i} width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                    <path
                      d="M7.8 1.085c-.322-.67-1.279-.67-1.601 0L4.822 3.953l-3.174.416c-.736.096-1.042 1.005-.494 1.522l2.319 2.187-.582 3.122c-.138.742.647 1.291 1.295.942L7 10.624l2.815 1.517c.648.35 1.433-.2 1.295-.941l-.582-3.123 2.32-2.187c.547-.516.24-1.425-.495-1.522l-3.174-.415L7.8 1.085z"
                      fill="currentColor"
                    />
                  </svg>
                ))}
              </div>
            </a>

            <h1
              class="lp-fade-up text-[clamp(38px,7vw,64px)] font-normal tracking-[-0.02em] leading-[1.1] text-ml-fg mb-4 font-['Imbue',serif]"
              style={{ animationDelay: '0.1s' }}
            >
              Annotate Any Webpage.
              <br />
              Share in One Link.
            </h1>

            <p
              class="lp-fade-up text-[15px] text-ml-fg/45 mb-8 max-w-[400px] mx-auto leading-relaxed"
              style={{ animationDelay: '0.2s' }}
            >
              Draw, comment, and mark up any live website — then share a link for instant visual feedback. No account
              required.
            </p>

            {isMobileDevice ? (
              <div
                class="lp-fade-up max-w-[400px] mx-auto mb-12 px-6 py-5 rounded-2xl bg-ml-fg/[0.02] border border-ml-fg/[0.06] text-center"
                style={{ animationDelay: '0.3s' }}
              >
                <Monitor size={24} class="text-ml-fg/30 mx-auto mb-3" aria-hidden="true" />
                <p class="text-[14px] font-semibold text-ml-fg/70 m-0 mb-1">Desktop only</p>
                <p class="text-[13px] text-ml-fg/40 m-0">Open this page on your computer to get started.</p>
              </div>
            ) : (
              <>
                {/* CTA */}
                <div class="lp-fade-up flex flex-col items-center gap-3 mb-2" style={{ animationDelay: '0.3s' }}>
                  <a
                    href={CWS_URL}
                    target="_blank"
                    rel="noopener"
                    class="lp-shine inline-flex items-center justify-center h-12 px-8 rounded-[14px] bg-neutral-950 text-white text-base font-medium no-underline hover:bg-neutral-800 transition-all select-none"
                  >
                    Add to Chrome — It's Free
                  </a>
                </div>

                <p class="lp-fade-up text-[12px] text-ml-fg/30 mb-12" style={{ animationDelay: '0.35s' }}>
                  No sign-up required
                </p>

                {/* URL input */}
                <form
                  class="lp-fade-up max-w-[460px] mx-auto mb-3"
                  style={{ animationDelay: '0.4s' }}
                  onSubmit={(e) => {
                    e.preventDefault();
                    const input = (e.currentTarget.elements.namedItem('url') as HTMLInputElement).value.trim();
                    if (!input) return;
                    let url = input;
                    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
                    navigateTo(url);
                  }}
                >
                  <div class="flex items-center gap-3 px-5 py-3.5 rounded-xl bg-ml-fg/[0.02] border border-ml-fg/[0.08]">
                    <Search size={16} class="text-ml-fg/20 shrink-0" aria-hidden="true" />
                    <input
                      name="url"
                      type="url"
                      inputMode="url"
                      placeholder="Paste any URL to annotate..."
                      autocomplete="url"
                      class="flex-1 bg-transparent border-none text-ml-fg text-[14px] placeholder:text-ml-fg/25 outline-none"
                      onInput={(e) => {
                        const v = (e.target as HTMLInputElement).value.trim();
                        urlReady.value = v.length > 0 && /^(https?:\/\/)?[\w.-]+\.[a-z]{2,}/i.test(v);
                      }}
                    />
                    <button
                      type="submit"
                      class={clsx(
                        'shrink-0 w-8 h-8 rounded-lg grid place-items-center border-none cursor-pointer transition-all duration-200',
                        urlReady.value
                          ? 'text-ml-btn-fg bg-ml-btn shadow-sm'
                          : 'text-ml-fg/20 bg-ml-fg/[0.04] hover:bg-ml-fg/[0.08]',
                      )}
                    >
                      <ArrowRight size={16} aria-hidden="true" />
                    </button>
                  </div>
                </form>

                <div
                  class="lp-fade-up flex items-center justify-center gap-4 text-[12px] text-ml-fg/30 mb-16"
                  style={{ animationDelay: '0.45s' }}
                >
                  <span>Try:</span>
                  {['Wikipedia', 'Hacker News', 'GitHub'].map((name) => (
                    <button
                      key={name}
                      type="button"
                      onClick={() =>
                        navigateTo(
                          name === 'Wikipedia'
                            ? 'https://en.wikipedia.org/wiki/Web_annotation'
                            : name === 'Hacker News'
                              ? 'https://news.ycombinator.com'
                              : 'https://github.com',
                        )
                      }
                      class="text-ml-fg/35 hover:text-ml-fg/60 transition-colors cursor-pointer bg-transparent border-none text-[12px] p-0 underline underline-offset-2 decoration-ml-fg/15"
                    >
                      {name}
                    </button>
                  ))}
                </div>
              </>
            )}
          </section>

          {/* Features grid */}
          <section class="pb-16">
            <div class="grid grid-cols-1 sm:grid-cols-2">
              {FEATURES.map((f, i) => (
                <div
                  key={f.label}
                  class="lp-fade-up flex flex-col gap-2 p-8 ring-[0.5px] ring-ml-fg/[0.08]"
                  style={{ animationDelay: `${i * 0.1}s` }}
                >
                  <div class="flex items-start gap-3">
                    <div class="flex flex-col gap-1 flex-1 min-w-0">
                      <h3 class="text-base flex items-start gap-3 font-medium text-ml-fg">
                        <span class={`size-4 h-[1lh] text-ml-fg/50 ${f.anim}`}>
                          <f.icon size={16} strokeWidth={2} class="size-4" aria-hidden="true" />
                        </span>
                        <span>{f.label}</span>
                      </h3>
                      <p class="text-sm pl-7 text-ml-fg/70 leading-relaxed m-0">{f.desc}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* FAQ */}
          <section class="px-8 sm:px-10 pb-16">
            <div class="flex flex-col">
              {[
                {
                  q: 'Does the other person need the extension installed?',
                  a: 'No. Anyone can view your annotations via the share link — no install required.',
                },
                { q: 'Is it really free?', a: 'Yes. No account, no paywall, no trial period.' },
                { q: 'Does it work on any website?', a: 'Yes, MarkLayer works on any webpage.' },
                {
                  q: 'Can multiple people annotate at the same time?',
                  a: 'Yes — real-time cursors let you collaborate live on any page.',
                },
              ].map((item) => (
                <details key={item.q} class="group border-t border-ml-fg/[0.06] py-5">
                  <summary class="flex items-center justify-between cursor-pointer list-none text-[15px] font-semibold text-ml-fg">
                    {item.q}
                    <ChevronDown
                      size={16}
                      class="text-ml-fg/25 shrink-0 ml-4 transition-transform duration-200 group-open:rotate-180"
                      aria-hidden="true"
                    />
                  </summary>
                  <p class="text-[14px] text-ml-fg/45 leading-relaxed mt-3 mb-0">{item.a}</p>
                </details>
              ))}
            </div>
          </section>

          {/* Bottom CTA */}
          <section class="px-8 pt-8 pb-10 text-center">
            <h2 class="text-[clamp(28px,5vw,40px)] font-normal tracking-[0.01em] font-['Imbue',serif] text-ml-fg mb-5">
              Start annotating what matters.
            </h2>
            {CWS_LINK('')}
            <p class="text-[12px] text-ml-fg/30 mt-3">Free to use &middot; No sign-up required</p>
          </section>

          {/* Footer */}
          <footer class="px-8 sm:px-10 pt-8 pb-8 border-t border-ml-fg/[0.06]">
            <div class="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[13px] text-ml-fg/30 mb-4">
              <a href="/privacy" class="hover:text-ml-fg/60 transition-colors no-underline text-ml-fg/30">
                Privacy
              </a>
              <a
                href="https://github.com/thevrus/MarkLayer"
                target="_blank"
                rel="noopener"
                class="hover:text-ml-fg/60 transition-colors no-underline text-ml-fg/30"
              >
                GitHub
              </a>
              <a
                href="mailto:rusinvadym@gmail.com"
                class="hover:text-ml-fg/60 transition-colors no-underline text-ml-fg/30"
              >
                Contact
              </a>
            </div>
            <div class="flex items-center justify-center gap-2 text-[12px] text-ml-fg/20">
              <Logo size={14} />
              <span>MarkLayer &copy; {new Date().getFullYear()}</span>
            </div>
          </footer>
        </div>

        {/* Comment overlay */}
        <div
          class="fixed inset-0 z-[2147483646] overflow-hidden"
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
        <div class="fixed inset-0 z-[2147483645] pointer-events-none overflow-hidden">
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
          class="fixed inset-0 z-[2147483646]"
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
                pushDeviceOp({
                  id: nanoid(),
                  tool: 'text',
                  text,
                  x: textInput.value.x,
                  y: textInput.value.y,
                  fontSize: Math.max(14, lineWidth.value * 6),
                  color: color.value,
                  lineWidth: lineWidth.value,
                } as TextOp);
              }
              textInput.value = null;
            }}
          />
        )}

        <canvas
          ref={canvasRef}
          onMouseDown={onDown}
          class="absolute inset-x-0 top-0 z-[2147483645]"
          style={{
            height: '100%',
            pointerEvents: showCanvas ? 'auto' : 'none',
            cursor: showCanvas ? 'crosshair' : 'default',
          }}
        />

        <div class="lp-toolbar-in hidden sm:block z-[2147483647]">
          <Toolbar />
        </div>

        {toasts.value.length > 0 && (
          <div class="fixed top-12 left-1/2 -translate-x-1/2 z-[2147483647] flex flex-col gap-2 items-center">
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
      <FakeCursors />
    </>
  );
}
