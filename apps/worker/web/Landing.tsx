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
import { ArrowRight, Monitor, Search } from 'lucide-preact';
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
    return () => window.removeEventListener('resize', onResize);
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

  return (
    <>
      <div
        class="ml-force-light relative min-h-screen font-['Inter',system-ui,sans-serif] overflow-x-hidden"
        style={{ background: 'var(--color-ml-bg)' }}
      >
        {/* Nav */}
        <nav class="lp-fade-up flex items-center justify-between px-6 sm:px-10 py-5 max-w-[1100px] mx-auto">
          <div class="flex items-center gap-2.5">
            <Logo size={32} />
            <span class="text-[20px] font-bold tracking-[-0.02em] text-ml-fg">MarkLayer</span>
            <span class="text-[12px] font-medium text-ml-fg/40 bg-ml-fg/[0.06] rounded-full px-2 py-0.5 select-none">
              v0.1
            </span>
          </div>
          <div class="flex items-center gap-4">
            <a
              href="https://chromewebstore.google.com"
              target="_blank"
              rel="noopener"
              class="flex items-center gap-2 px-4 py-2 rounded-xl bg-ml-btn text-ml-btn-fg text-[14px] font-semibold no-underline hover:bg-ml-btn-hover transition-colors"
            >
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
              <span class="hidden sm:inline">Chrome Extension</span>
            </a>
            <GithubLink dark />
          </div>
        </nav>

        {/* Hero */}
        <section class="text-center pt-16 sm:pt-24 pb-10 px-6">
          <h1
            class="lp-fade-up text-[clamp(44px,7.5vw,80px)] font-extrabold tracking-[-0.04em] leading-[1.05] text-ml-fg mb-8"
            style={{ animationDelay: '0.1s' }}
          >
            <span class="relative inline-block">
              Annotate
              <span
                class="lp-underline-grow absolute -bottom-1 left-0 right-0 h-[0.18em] rounded-full opacity-50"
                style={{ background: '#F953C6' }}
              />
            </span>{' '}
            any webpage,
            <br />
            together.
          </h1>

          <p
            class="lp-fade-up text-[22px] text-ml-fg/40 mb-12 max-w-[520px] mx-auto leading-relaxed"
            style={{ animationDelay: '0.2s' }}
          >
            Draw, highlight, comment and collaborate on any site in real-time. No sign-up required.
          </p>

          {isMobileDevice ? (
            <div
              class="lp-fade-up max-w-[520px] mx-auto mb-16 px-6 py-5 rounded-2xl bg-ml-input backdrop-blur-xl border border-ml-input-border shadow-[0_4px_24px_rgba(0,0,0,0.06)] text-center"
              style={{ animationDelay: '0.3s' }}
            >
              <Monitor size={28} class="text-ml-fg/30 mx-auto mb-3" aria-hidden="true" />
              <p class="text-[15px] font-semibold text-ml-fg/70 m-0 mb-1">Desktop only</p>
              <p class="text-[13px] text-ml-fg/40 m-0">
                Drawing tools and annotation require a desktop browser. Open this page on your computer to get started.
              </p>
            </div>
          ) : (
            <>
              <form
                class="lp-fade-up max-w-[520px] mx-auto mb-4"
                style={{ animationDelay: '0.3s' }}
                onSubmit={(e) => {
                  e.preventDefault();
                  const input = (e.currentTarget.elements.namedItem('url') as HTMLInputElement).value.trim();
                  if (!input) return;
                  let url = input;
                  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
                  navigateTo(url);
                }}
              >
                <div class="lp-input-glow flex items-center gap-3 px-6 py-5 rounded-2xl bg-ml-input backdrop-blur-xl border border-ml-input-border shadow-[0_4px_24px_rgba(0,0,0,0.06),inset_0_1px_0_rgba(255,255,255,0.08)]">
                  <Search size={18} class="text-ml-fg/20 shrink-0" aria-hidden="true" />
                  <input
                    name="url"
                    type="text"
                    placeholder="Paste any URL to annotate..."
                    autocomplete="off"
                    autofocus
                    class="flex-1 bg-transparent border-none text-ml-fg text-[18px] placeholder:text-ml-fg/20 outline-none"
                    onInput={(e) => {
                      const v = (e.target as HTMLInputElement).value.trim();
                      urlReady.value = v.length > 0 && /^(https?:\/\/)?[\w.-]+\.[a-z]{2,}/i.test(v);
                    }}
                  />
                  <button
                    type="submit"
                    class={clsx(
                      'shrink-0 w-10 h-10 rounded-xl grid place-items-center border-none cursor-pointer transition-all duration-200',
                      urlReady.value
                        ? 'text-ml-btn-fg bg-ml-btn shadow-[0_2px_8px_rgba(0,0,0,0.2)] scale-105 hover:scale-110 hover:shadow-[0_4px_16px_rgba(0,0,0,0.25)]'
                        : 'text-ml-fg/20 bg-ml-fg/[0.04] hover:bg-ml-fg/[0.08]',
                    )}
                  >
                    <ArrowRight size={20} aria-hidden="true" />
                  </button>
                </div>
              </form>

              <div
                class="lp-fade-up flex items-center justify-center gap-5 text-[16px] text-ml-fg/30 mb-16"
                style={{ animationDelay: '0.4s' }}
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
                    class="text-ml-fg/35 hover:text-ml-fg/70 transition-colors cursor-pointer bg-transparent border-none text-[16px] p-0 underline underline-offset-2 decoration-ml-fg/10 hover:decoration-ml-fg/30"
                  >
                    {name}
                  </button>
                ))}
              </div>
            </>
          )}
        </section>

        {/* Features grid */}
        <section class="max-w-[900px] mx-auto px-6 pb-28">
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-y-6 sm:gap-y-16 gap-x-4 sm:gap-x-10 group/features">
            {FEATURES.map((f, i) => (
              <div
                key={i}
                class="lp-fade-up flex flex-col items-center text-center transition-opacity duration-200 group-hover/features:opacity-40 hover:!opacity-100"
                style={{ animationDelay: `${0.5 + i * 0.07}s` }}
              >
                <div
                  class={`flex items-center justify-center w-12 h-12 sm:w-28 sm:h-28 rounded-xl sm:rounded-3xl mb-2 sm:mb-5 transition-all duration-200 hover:bg-ml-btn/[0.06] text-ml-fg group/icon ${f.anim}`}
                >
                  <f.icon
                    size={84}
                    strokeWidth={2.25}
                    aria-hidden="true"
                    class="w-7 h-7 sm:w-[84px] sm:h-[84px] transition-transform duration-500 ease-out"
                  />
                </div>
                <span class="text-[13px] sm:text-[30px] font-semibold text-ml-fg leading-tight tracking-[-0.02em] sm:tracking-[-0.04em] whitespace-pre-line">
                  {f.label}
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* Contact */}
        <section class="max-w-[520px] mx-auto px-6 pb-12 text-center">
          <h3 class="text-[20px] font-bold text-ml-fg mb-2">Have more questions?</h3>
          <p class="text-[16px] text-ml-fg/50 leading-relaxed mb-4">
            If you have any additional questions, do not hesitate to contact us at{' '}
            <a
              href="mailto:rusinvadym@gmail.com"
              class="font-medium text-ml-fg/70 underline underline-offset-4 decoration-ml-fg/20 hover:text-ml-fg transition-colors"
            >
              rusinvadym@gmail.com
            </a>
          </p>
          <div class="flex items-center justify-center gap-3 mt-6">
            <a
              class="inline-flex items-center justify-center size-10 rounded-xl bg-ml-fg/[0.05] text-ml-fg/50 hover:text-ml-fg hover:bg-ml-fg/[0.08] transition-colors"
              href="https://x.com/rusin_vadim"
              rel="noopener noreferrer"
              target="_blank"
            >
              <svg
                class="size-[18px] fill-current"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                role="img"
                aria-label="X (Twitter)"
              >
                <path d="M21.2391 3H18.6854L12.9921 9.61784L14.1261 11.2682L21.2391 3Z" />
                <path d="M11.2104 14.6575L10.0764 13.0071L3.2002 21H5.75403L11.2104 14.6575Z" />
                <path d="M8.44486 3H3.2002L15.5685 21H20.8131L8.44486 3ZM5.31391 4.16971H7.70053L18.6861 19.8835H16.2995L5.31391 4.16971Z" />
              </svg>
            </a>
            <a
              class="inline-flex items-center justify-center size-10 rounded-xl bg-ml-fg/[0.05] text-ml-fg/50 hover:text-ml-fg hover:bg-ml-fg/[0.08] transition-colors"
              href="https://github.com/thevrus"
              rel="noopener noreferrer"
              target="_blank"
            >
              <svg
                class="size-[20px] fill-current"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                role="img"
                aria-label="GitHub"
              >
                <path
                  fill-rule="evenodd"
                  d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
                  clip-rule="evenodd"
                />
              </svg>
            </a>
          </div>
        </section>

        <footer class="max-w-[520px] mx-auto px-6 pb-16 text-center">
          <p class="text-[16px] text-ml-fg/25 leading-relaxed">
            MarkLayer is a free, open-source web annotation tool. Annotate any webpage with drawings, highlights, and
            comments — then share a link for real-time collaboration. No account needed.
          </p>
        </footer>

        <div class="relative overflow-hidden h-[clamp(80px,16vw,180px)]">
          <p
            class="text-center text-[clamp(60px,18vw,340px)] font-black tracking-tight leading-none select-none absolute inset-x-0 top-0"
            style={{
              background:
                'linear-gradient(180deg, color-mix(in srgb, var(--color-ml-fg) 12%, transparent) 0%, transparent 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}
            aria-hidden="true"
          >
            MarkLayer
          </p>
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

        <div class="lp-toolbar-in hidden sm:block">
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
