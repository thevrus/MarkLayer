import { Toolbar } from '@ext/components/Toolbar';
import { glass } from '@ext/lib/glass';
import { hexToRgba, renderOp, simplify } from '@ext/lib/renderer';
import {
  activeTool,
  color,
  comments as commentsComputed,
  FREEHAND,
  isDrawingTool,
  lineWidth,
  onCursorMove,
  onExportPng,
  operations,
  peerCount,
  peers,
  pushOp,
  redo,
  SHAPES,
  SHORTCUT_MAP,
  selections,
  showAnnotationPanel,
  showShareDialog,
  toast,
  toasts,
  undo,
} from '@ext/lib/state';
import type { DrawOp, FreehandOp, Point, TextOp } from '@ext/lib/types';
import { signal, useSignalEffect } from '@preact/signals';
import clsx from 'clsx';
import { nanoid } from 'nanoid';
import { useCallback, useEffect, useRef } from 'preact/hooks';
import { AnnotationPanel } from './AnnotationPanel';
import { CursorLayer } from './CursorLayer';
import { FakeCursors } from './FakeCursors';
import { connected, useRealtimeSync } from './useRealtimeSync';
import { WebCommentPin } from './WebCommentPin';
import { WebCommentPopover } from './WebCommentPopover';
import { WebSelectionHighlight } from './WebSelectionHighlight';
import { WebSelectionPopover } from './WebSelectionPopover';

const API_BASE = '/api/';

// Web-specific state
const iframeScrollY = signal(0);
const scale = signal(1);
const pageUrl = signal('');
const originalWidth = signal(0);
const annotationId = signal('');
const isLanding = signal(true);
const urlReady = signal(false);
const commentPopover = signal<{ x: number; y: number } | null>(null);
const textInput = signal<{ x: number; y: number } | null>(null);
const selectionPopover = signal<{
  text: string;
  rects: import('@ext/lib/types').SelectionRect[];
  screenX: number;
  screenY: number;
} | null>(null);
const isReadonly = signal(false);
const sharing = signal(false);

// Parse URL params (synchronous — called before first render)
function parseViewParam(): boolean {
  const params = new URLSearchParams(location.search);
  const viewParam = params.get('view');
  if (!viewParam) return false;
  try {
    const decoded = fromBase64(viewParam);
    const hashIdx = decoded.indexOf('#ant=');
    if (hashIdx === -1) return false;
    pageUrl.value = decoded.substring(0, hashIdx);
    const meta = decoded.substring(hashIdx + 5);
    const eqIdx = meta.indexOf('=');
    if (eqIdx === -1) return false;
    originalWidth.value = parseInt(meta.substring(0, eqIdx), 10);
    annotationId.value = meta.substring(eqIdx + 1);
    isReadonly.value = params.get('readonly') === '1';
    return !!(pageUrl.value && annotationId.value && !Number.isNaN(originalWidth.value));
  } catch {
    return false;
  }
}

if (parseViewParam()) {
  // Parse immediately
  isLanding.value = false;
}

import { fromBase64, toBase64 } from './encoding';

function navigateTo(url: string) {
  const w = window.innerWidth;
  const id = nanoid();
  const encoded = toBase64(`${url}#ant=${w}=${id}`);
  location.href = `/s/${id}?view=${encodeURIComponent(encoded)}`;
}

export function App() {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const startPtRef = useRef<Point>({ x: 0, y: 0 });
  const currentPathRef = useRef<FreehandOp | null>(null);
  const snapshotRef = useRef<ImageData | null>(null);
  const viewerRef = useRef<HTMLDivElement>(null);

  useRealtimeSync(annotationId.value);

  // Export PNG
  useEffect(() => {
    onExportPng.value = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `marklayer-${Date.now()}.png`;
        a.click();
        URL.revokeObjectURL(url);
        toast('PNG exported!', 'success');
      });
    };
    return () => {
      onExportPng.value = null;
    };
  }, []);

  // Warn before leaving page with unsaved annotations
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (operations.value.length > 0) {
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const setupFrame = () => {
      try {
        const win = frame.contentWindow;
        if (!win || !win.document.body) return;

        win.addEventListener('scroll', () => {
          iframeScrollY.value = win.scrollY || 0;
        });
        win.addEventListener('keydown', (e) => {
          window.dispatchEvent(
            new KeyboardEvent('keydown', {
              key: e.key,
              code: e.code,
              metaKey: e.metaKey,
              ctrlKey: e.ctrlKey,
              shiftKey: e.shiftKey,
              altKey: e.altKey,
            }),
          );
        });

        // Link interception is handled by the proxy-injected script via postMessage
      } catch {
        /* cross-origin */
      }
    };
    setupFrame();
    frame.addEventListener('load', setupFrame);
    return () => frame.removeEventListener('load', setupFrame);
  }, []);

  // Listen for link clicks forwarded from proxy-injected script
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type === 'ml-navigate' && typeof e.data.url === 'string') {
        navigateTo(e.data.url);
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isReadonly.value) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
        if (e.key === 'Escape') (e.target as HTMLElement).blur();
        return;
      }
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'r') {
          e.preventDefault();
          window.location.reload();
          return;
        }
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
        activeTool.value = 'navigate';
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useSignalEffect(() => {
    if (!showShareDialog.value) return;
    showShareDialog.value = false;
    doShare();
  });

  async function doShare(opts?: { readonly?: boolean; expiresIn?: number }) {
    if (sharing.value) return;
    sharing.value = true;
    toast('Saving...', 'info');
    const id = annotationId.value || nanoid();
    annotationId.value = id;
    const url_ = pageUrl.value || location.origin;
    const ow = originalWidth.value || window.innerWidth;
    try {
      const payload = opts?.expiresIn ? { ops: operations.value, expires_in: opts.expiresIn } : operations.value;
      const res = await fetch(`${API_BASE}${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error();
      const encoded = toBase64(`${url_}#ant=${ow}=${id}`);
      let shareUrl = `${location.origin}/s/${id}?view=${encodeURIComponent(encoded)}`;
      if (opts?.readonly) shareUrl += '&readonly=1';
      await navigator.clipboard.writeText(shareUrl);
      toast('Link copied to clipboard!', 'success');
    } catch {
      toast('Failed to save', 'error');
    } finally {
      sharing.value = false;
    }
  }

  const canvasCoords = useCallback((e: MouseEvent): Point => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const r = canvas.getBoundingClientRect();
    const s = scale.value;
    return {
      x: (e.clientX - r.left) / s,
      y: (e.clientY - r.top) / s + iframeScrollY.value / s,
    };
  }, []);

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
    const viewer = viewerRef.current;
    // On landing page, canvas is fixed fullscreen; in viewer mode, match viewer dims
    const w = viewer ? viewer.clientWidth : window.innerWidth;
    const h = viewer ? viewer.clientHeight : window.innerHeight;
    const s = originalWidth.value ? w / originalWidth.value : 1;
    if (scale.value !== s) scale.value = s;
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.scale(s, s);
    ctx.translate(0, -iframeScrollY.value / s);
    for (const op of operations.value) {
      if (op.tool === 'comment' || op.tool === 'selection') continue;
      renderOp(ctx, op, 0, 0);
    }
    ctx.restore();
  }, []);

  const onDown = useCallback(
    (e: MouseEvent) => {
      const tool = activeTool.value;
      if (tool === 'navigate' || tool === 'comment' || tool === 'selection') return;
      if (tool === 'text') {
        const pos = canvasCoords(e);
        textInput.value = pos;
        return;
      }
      drawingRef.current = true;
      const pos = canvasCoords(e);
      startPtRef.current = pos;
      const ctx = canvasRef.current?.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;
      applyTool(ctx);
      if (FREEHAND.has(tool)) {
        ctx.beginPath();
        const vx = pos.x * scale.value;
        const vy = pos.y * scale.value - iframeScrollY.value;
        ctx.moveTo(vx, vy);
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
      const ctx = canvasRef.current?.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;
      const s = scale.value;
      const scrollOff = iframeScrollY.value;
      if (FREEHAND.has(tool)) {
        currentPathRef.current?.points.push(pos);
        const vx = pos.x * s;
        const vy = pos.y * s - scrollOff;
        ctx.lineTo(vx, vy);
        ctx.stroke();
      } else if (snapshotRef.current && SHAPES.has(tool)) {
        ctx.putImageData(snapshotRef.current, 0, 0);
        ctx.beginPath();
        const sp = startPtRef.current;
        const vsx = sp.x * s,
          vsy = sp.y * s - scrollOff;
        const vex = pos.x * s,
          vey = pos.y * s - scrollOff;
        applyTool(ctx);
        switch (tool) {
          case 'rectangle':
            ctx.strokeRect(vsx, vsy, vex - vsx, vey - vsy);
            break;
          case 'circle': {
            const r = Math.hypot(vex - vsx, vey - vsy);
            ctx.arc(vsx, vsy, r, 0, Math.PI * 2);
            ctx.stroke();
            break;
          }
          case 'line':
          case 'arrow':
            ctx.moveTo(vsx, vsy);
            ctx.lineTo(vex, vey);
            ctx.stroke();
            if (tool === 'arrow') {
              const angle = Math.atan2(vey - vsy, vex - vsx);
              const headLen = Math.max(10, ctx.lineWidth * 4);
              ctx.beginPath();
              ctx.moveTo(vex, vey);
              ctx.lineTo(vex - headLen * Math.cos(angle - Math.PI / 6), vey - headLen * Math.sin(angle - Math.PI / 6));
              ctx.moveTo(vex, vey);
              ctx.lineTo(vex - headLen * Math.cos(angle + Math.PI / 6), vey - headLen * Math.sin(angle + Math.PI / 6));
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
      const tool = activeTool.value;
      const pos = canvasCoords(e);
      const sp = startPtRef.current;
      if (FREEHAND.has(tool) && currentPathRef.current) {
        currentPathRef.current.points.push(pos);
        if (currentPathRef.current.points.length > 1) {
          currentPathRef.current.points = simplify(currentPathRef.current.points, 1.5);
          pushOp(currentPathRef.current);
        }
        currentPathRef.current = null;
      } else if (SHAPES.has(tool)) {
        snapshotRef.current = null;
        const base = { id: nanoid(), color: color.value, lineWidth: lineWidth.value };
        if (tool === 'circle') {
          const r = Math.hypot(pos.x - sp.x, pos.y - sp.y);
          if (r > 0) pushOp({ ...base, tool: 'circle', centerX: sp.x, centerY: sp.y, radius: r } as DrawOp);
        } else if (tool === 'rectangle') {
          if (sp.x !== pos.x && sp.y !== pos.y)
            pushOp({ ...base, tool: 'rectangle', startX: sp.x, startY: sp.y, endX: pos.x, endY: pos.y } as DrawOp);
        } else if (tool === 'line' || tool === 'arrow') {
          if (sp.x !== pos.x || sp.y !== pos.y)
            pushOp({
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

  useSignalEffect(() => {
    operations.value;
    iframeScrollY.value;
    renderAll();
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

  // Send cursor position to peers
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const viewer = viewerRef.current;
      if (!viewer) return;
      const r = viewer.getBoundingClientRect();
      const s = scale.value;
      const x = (e.clientX - r.left) / s;
      const y = (e.clientY - r.top) / s + iframeScrollY.value / s;
      onCursorMove.value?.(x, y, activeTool.value);
    };
    window.addEventListener('mousemove', handler);
    return () => window.removeEventListener('mousemove', handler);
  }, []);

  // Selection tool: capture text selection on mouseup
  const captureSelection = useCallback((sel: Selection | null, fromIframe: boolean) => {
    if (!sel || sel.isCollapsed || !sel.toString().trim()) return;
    const text = sel.toString();
    const rects: import('@ext/lib/types').SelectionRect[] = [];
    const landing = isLanding.value;
    const s = landing ? 1 : scale.value;
    const sy = landing ? window.scrollY || 0 : iframeScrollY.value;
    const vr = viewerRef.current?.getBoundingClientRect();
    const fr = frameRef.current?.getBoundingClientRect();
    for (let i = 0; i < sel.rangeCount; i++) {
      for (const cr of sel.getRangeAt(i).getClientRects()) {
        if (landing) {
          rects.push({ x: cr.x + window.scrollX, y: cr.y + window.scrollY, width: cr.width, height: cr.height });
        } else if (fromIframe && fr && vr) {
          rects.push({
            x: (cr.x + fr.left - vr.left) / s,
            y: (cr.y + fr.top - vr.top + sy) / s,
            width: cr.width / s,
            height: cr.height / s,
          });
        } else if (vr) {
          rects.push({
            x: (cr.x - vr.left) / s,
            y: (cr.y - vr.top + sy) / s,
            width: cr.width / s,
            height: cr.height / s,
          });
        }
      }
    }
    if (rects.length === 0) return;
    const lastCr = sel.getRangeAt(sel.rangeCount - 1).getClientRects();
    const last = lastCr[lastCr.length - 1];
    selectionPopover.value = {
      text,
      rects,
      screenX: fromIframe && fr ? last.right + fr.left : last.right,
      screenY: fromIframe && fr ? last.bottom + fr.top : last.bottom,
    };
  }, []);

  // Parent frame mouseup
  useEffect(() => {
    const onMouseUp = () => {
      if (activeTool.value !== 'selection') return;
      requestAnimationFrame(() => captureSelection(window.getSelection(), false));
    };
    window.addEventListener('mouseup', onMouseUp);
    return () => window.removeEventListener('mouseup', onMouseUp);
  }, [captureSelection]);

  // Iframe mouseup (same-origin proxy)
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    let win: Window | null = null;
    const onMouseUp = () => {
      if (activeTool.value !== 'selection') return;
      requestAnimationFrame(() => {
        try {
          captureSelection(frame.contentWindow?.getSelection?.() ?? null, true);
        } catch {
          /* cross-origin */
        }
      });
    };
    const attach = () => {
      try {
        win = frame.contentWindow;
        win?.addEventListener('mouseup', onMouseUp);
      } catch {
        /* cross-origin */
      }
    };
    frame.addEventListener('load', attach);
    attach();
    return () => {
      frame.removeEventListener('load', attach);
      try {
        win?.removeEventListener('mouseup', onMouseUp);
      } catch {
        /* */
      }
    };
  }, [captureSelection]);

  const tool = activeTool.value;
  const readonly = isReadonly.value;
  const showCanvas = !readonly && isDrawingTool(tool) && tool !== 'comment' && tool !== 'text' && tool !== 'selection';
  const showTextCursor = !readonly && tool === 'text';
  const showCommentCursor = !readonly && tool === 'comment';
  const comments = commentsComputed.value;
  const landing = isLanding.value;

  if (landing) {
    return (
      <div class="min-h-screen font-['Inter',system-ui,sans-serif] overflow-x-hidden" style={{ background: '#f5f0e8' }}>
        {/* Nav */}
        <nav class="lp-fade-up flex items-center justify-between px-6 sm:px-10 py-5 max-w-[1100px] mx-auto">
          <div class="flex items-center gap-2.5">
            <Logo size={32} />
            <span class="text-[20px] font-bold tracking-[-0.02em] text-[#1a1a1a]">MarkLayer</span>
          </div>
          <div class="flex items-center gap-4">
            <a
              href="https://chromewebstore.google.com"
              target="_blank"
              rel="noopener"
              class="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#1a1a1a] text-white text-[14px] font-semibold no-underline hover:bg-[#333] transition-colors"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
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
            class="lp-fade-up text-[clamp(44px,7.5vw,80px)] font-extrabold tracking-[-0.04em] leading-[1.05] text-[#1a1a1a] mb-8"
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
            class="lp-fade-up text-[22px] text-[#1a1a1a]/40 mb-12 max-w-[520px] mx-auto leading-relaxed"
            style={{ animationDelay: '0.2s' }}
          >
            Draw, highlight, comment and collaborate on any site in real-time. No sign-up required.
          </p>

          {/* URL input — big, centered */}
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
            <div class="lp-input-glow flex items-center gap-3 px-6 py-5 rounded-2xl bg-white/70 backdrop-blur-xl border border-white/60 shadow-[0_4px_24px_rgba(0,0,0,0.06),inset_0_1px_0_rgba(255,255,255,0.8)]">
              <svg
                class="text-black/20 shrink-0"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.3-4.3" />
              </svg>
              <input
                name="url"
                type="text"
                placeholder="Paste any URL to annotate..."
                autocomplete="off"
                autofocus
                class="flex-1 bg-transparent border-none text-[#1a1a1a] text-[18px] placeholder:text-black/20 outline-none"
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
                    ? 'text-white bg-[#1a1a1a] shadow-[0_2px_8px_rgba(0,0,0,0.2)] scale-105 hover:scale-110 hover:shadow-[0_4px_16px_rgba(0,0,0,0.25)]'
                    : 'text-black/20 bg-black/[0.04] hover:bg-black/[0.08]',
                )}
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                >
                  <path d="M5 12h14" />
                  <path d="m12 5 7 7-7 7" />
                </svg>
              </button>
            </div>
          </form>

          {/* Quick try */}
          <div
            class="lp-fade-up flex items-center justify-center gap-5 text-[16px] text-[#1a1a1a]/30 mb-16"
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
                class="text-[#1a1a1a]/35 hover:text-[#1a1a1a]/70 transition-colors cursor-pointer bg-transparent border-none text-[16px] p-0 underline underline-offset-2 decoration-black/10 hover:decoration-black/30"
              >
                {name}
              </button>
            ))}
          </div>
        </section>

        {/* Features grid */}
        <section class="max-w-[900px] mx-auto px-6 pb-28">
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-y-12 sm:gap-y-16 gap-x-6 sm:gap-x-10 group/features">
            {FEATURES.map((f, i) => (
              <div
                key={i}
                class="lp-fade-up flex flex-col items-center text-center transition-opacity duration-200 group-hover/features:opacity-40 hover:!opacity-100"
                style={{ animationDelay: `${0.5 + i * 0.07}s` }}
              >
                <div class="flex items-center justify-center w-20 h-20 rounded-2xl mb-5 transition-all duration-200 hover:bg-[#1a1a1a]/[0.06] text-[#1a1a1a]">
                  <FeatureIcon d={f.d} />
                </div>
                <span class="text-[20px] font-extrabold text-[#1a1a1a] leading-tight tracking-[-0.02em] whitespace-pre-line">
                  {f.label}
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* SEO footer copy */}
        <footer class="max-w-[520px] mx-auto px-6 pb-16 text-center">
          <p class="text-[16px] text-[#1a1a1a]/25 leading-relaxed">
            MarkLayer is a free, open-source web annotation tool. Annotate any webpage with drawings, highlights, and
            comments — then share a link for real-time collaboration. No account needed.
          </p>
        </footer>

        {/* Half-hidden watermark with gradient fade */}
        <div class="relative overflow-hidden h-[clamp(80px,16vw,180px)]">
          <p
            class="text-center text-[clamp(140px,28vw,340px)] font-black tracking-[0.05em] leading-none select-none absolute inset-x-0 top-0"
            style={{
              background: 'linear-gradient(180deg, rgba(26,26,26,0.12) 0%, rgba(26,26,26,0) 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}
            aria-hidden="true"
          >
            MarkLayer
          </p>
        </div>

        {/* Animated collaboration cursors */}
        <div class="hidden sm:block">
          <FakeCursors />
        </div>

        {/* Comment overlay — click to place pins on LP */}
        <div
          class="fixed inset-0 z-[2147483646] overflow-hidden"
          style={{
            pointerEvents: showCommentCursor ? 'auto' : 'none',
            cursor: showCommentCursor ? 'crosshair' : 'default',
          }}
          onClick={(e) => {
            if (tool !== 'comment') return;
            const x = e.clientX;
            const y = e.clientY + (window.scrollY || 0);
            commentPopover.value = { x, y };
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

        {/* Selection highlights (landing) */}
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
          style={{
            pointerEvents: showTextCursor ? 'auto' : 'none',
            cursor: showTextCursor ? 'text' : 'default',
          }}
          onClick={(e) => {
            if (tool !== 'text') return;
            const x = e.clientX;
            const y = e.clientY + (window.scrollY || 0);
            textInput.value = { x, y };
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
                pushOp({
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

        {/* Drawing canvas overlay */}
        <canvas
          ref={canvasRef}
          onMouseDown={onDown}
          class="fixed inset-0 z-[2147483645]"
          style={{
            pointerEvents: showCanvas ? 'auto' : 'none',
            cursor: showCanvas ? 'crosshair' : 'default',
          }}
        />

        <div class="lp-toolbar-in hidden sm:block fixed bottom-5 left-1/2 z-[2147483646]">
          <Toolbar />
        </div>

        {toasts.value.length > 0 && (
          <div class="fixed top-12 left-1/2 -translate-x-1/2 z-[2147483647] flex flex-col gap-2 items-center">
            {toasts.value.map((t) => (
              <div
                key={t.id}
                class={clsx(
                  glass.surfaceSmall,
                  glass.font,
                  'px-4 py-2.5 text-xs font-medium animate-[fadeInDown_0.2s_ease-out]',
                  t.type === 'error' ? 'text-red-300' : t.type === 'success' ? 'text-green-300' : 'text-white/70',
                )}
              >
                {t.message}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div class={clsx('h-screen flex flex-col bg-[#f5f5f5]', glass.font)}>
      {/* Mobile gate — annotation tools need a desktop screen */}
      <div class="md:hidden fixed inset-0 z-[2147483647] bg-[#f5f0e8] flex flex-col items-center justify-center px-8 text-center font-['Inter',system-ui,sans-serif]">
        <Logo size={48} />
        <h2 class="text-[22px] font-bold text-[#1a1a1a] mt-6 mb-3 tracking-[-0.02em]">Desktop only</h2>
        <p class="text-[16px] text-[#1a1a1a]/40 leading-relaxed max-w-[300px] mb-8">
          MarkLayer's annotation tools are designed for desktop screens. Open this link on your computer.
        </p>
        <a href="/" class="px-5 py-2.5 rounded-xl bg-[#1a1a1a] text-white text-[14px] font-semibold no-underline">
          Back to home
        </a>
      </div>
      {/* Top bar — uses same glass surface as toolbar */}
      <div class={clsx('flex items-center gap-3 px-4 h-[48px] !rounded-none z-50 shrink-0', glass.surface)}>
        {/* Logo */}
        <a href="/" class="flex items-center gap-2 no-underline shrink-0 group">
          <Logo size={24} />
          <span class="text-[14px] font-bold tracking-[-0.02em] text-white/70 group-hover:text-white transition-colors">
            MarkLayer
          </span>
        </a>

        {/* Divider */}
        <div class={glass.sep} />

        {/* URL display */}
        <div class="flex-1 min-w-0 flex items-center gap-2 px-2">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="text-white/30 shrink-0"
            aria-hidden="true"
          >
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
          </svg>
          <span class="text-[13px] text-white/40 truncate">{pageUrl.value}</span>
        </div>

        {/* Divider */}
        <div class={glass.sep} />

        <div class="flex items-center gap-1.5 shrink-0">
          {/* Presence avatars */}
          {peers.value.size > 0 && (
            <div class="flex items-center -space-x-1.5 mr-1">
              {Array.from(peers.value.values())
                .slice(0, 5)
                .map((p) => (
                  <div
                    key={p.id}
                    class="w-6 h-6 rounded-full text-white text-[9px] font-bold grid place-items-center border-[2px] border-white/10 shadow-sm"
                    style={{ background: p.color }}
                    title={p.name}
                  >
                    {p.name
                      .split(' ')
                      .map((w) => w[0])
                      .join('')}
                  </div>
                ))}
              {peers.value.size > 5 && (
                <div class="w-6 h-6 rounded-full bg-white/[0.1] text-white/40 text-[9px] font-bold grid place-items-center border-[2px] border-white/10">
                  +{peers.value.size - 5}
                </div>
              )}
            </div>
          )}
          {/* Connection indicator */}
          <div class="flex items-center gap-1.5 mr-0.5">
            <span
              class={clsx(
                'w-2 h-2 rounded-full shrink-0',
                connected.value ? 'bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.5)]' : 'bg-white/20',
              )}
            />
            <span class="text-white/35 text-[11px] font-medium tabular-nums">
              {connected.value ? `${peerCount.value} online` : 'offline'}
            </span>
          </div>
          {/* Annotations panel toggle */}
          <button
            type="button"
            onClick={() => (showAnnotationPanel.value = !showAnnotationPanel.value)}
            class={clsx(
              'w-9 h-9 rounded-xl grid place-items-center cursor-pointer border-none transition-all duration-150 active:scale-[0.94]',
              showAnnotationPanel.value
                ? 'bg-white/[0.14] text-white shadow-[inset_0_0.5px_0_oklch(1_0_0/0.08)]'
                : 'bg-transparent text-white/45 hover:text-white hover:bg-white/[0.1]',
            )}
            title="Annotations panel"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </button>
          {/* Share session */}
          {!readonly && (
            <>
              <button
                type="button"
                onClick={() => doShare()}
                disabled={sharing.value}
                class={clsx(
                  'w-9 h-9 rounded-xl grid place-items-center cursor-pointer border-none transition-all duration-150 active:scale-[0.94] bg-transparent text-white/45 hover:text-white hover:bg-white/[0.1]',
                  sharing.value && 'opacity-50 pointer-events-none',
                )}
                title="Copy editable link"
              >
                {sharing.value ? (
                  <Spinner />
                ) : (
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13" />
                  </svg>
                )}
              </button>
              <button
                type="button"
                onClick={() => doShare({ readonly: true, expiresIn: 7 * 24 * 60 * 60 })}
                disabled={sharing.value}
                class={clsx(
                  'w-9 h-9 rounded-xl grid place-items-center cursor-pointer border-none transition-all duration-150 active:scale-[0.94] bg-transparent text-white/45 hover:text-white hover:bg-white/[0.1]',
                  sharing.value && 'opacity-50 pointer-events-none',
                )}
                title="Copy read-only link (expires in 7 days)"
              >
                {sharing.value ? (
                  <Spinner />
                ) : (
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    aria-hidden="true"
                  >
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                )}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Viewer */}
      <div id="viewer" ref={viewerRef} class="flex-1 relative overflow-hidden">
        <iframe
          ref={frameRef}
          title="Annotated page"
          src={pageUrl.value ? `/proxy?url=${encodeURIComponent(pageUrl.value)}` : undefined}
          sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
          class={clsx(
            'w-full h-full border-none bg-white',
            (showCanvas || showCommentCursor || showTextCursor) && 'pointer-events-none',
          )}
        />

        <canvas
          ref={canvasRef}
          onMouseDown={onDown}
          class="absolute inset-0"
          style={{
            pointerEvents: showCanvas ? 'auto' : 'none',
            cursor: showCanvas ? 'crosshair' : 'default',
          }}
        />

        <CursorLayer scale={scale.value} scrollY={iframeScrollY.value} />

        <div
          class="absolute inset-0 overflow-hidden"
          style={{
            pointerEvents: showCommentCursor ? 'auto' : 'none',
            cursor: showCommentCursor ? 'crosshair' : 'default',
          }}
          onClick={(e) => {
            if (tool !== 'comment') return;
            const viewer = viewerRef.current;
            if (!viewer) return;
            const r = viewer.getBoundingClientRect();
            const s = scale.value;
            const x = (e.clientX - r.left) / s;
            const y = (e.clientY - r.top) / s + iframeScrollY.value / s;
            commentPopover.value = { x, y };
          }}
        >
          {comments.map((c) => (
            <WebCommentPin key={c.id} op={c} scale={scale.value} scrollY={iframeScrollY.value} />
          ))}
          {commentPopover.value && (
            <WebCommentPopover
              x={commentPopover.value.x}
              y={commentPopover.value.y}
              scale={scale.value}
              scrollY={iframeScrollY.value}
              onClose={() => {
                commentPopover.value = null;
              }}
            />
          )}
        </div>

        {/* Selection highlights */}
        <div class="absolute inset-0 pointer-events-none overflow-hidden">
          {selections.value.map((op) => (
            <WebSelectionHighlight key={op.id} op={op} scale={scale.value} scrollY={iframeScrollY.value} />
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
          class="absolute inset-0"
          style={{
            pointerEvents: showTextCursor ? 'auto' : 'none',
            cursor: showTextCursor ? 'text' : 'default',
          }}
          onClick={(e) => {
            if (tool !== 'text') return;
            const viewer = viewerRef.current;
            if (!viewer) return;
            const r = viewer.getBoundingClientRect();
            const s = scale.value;
            const x = (e.clientX - r.left) / s;
            const y = (e.clientY - r.top) / s + iframeScrollY.value / s;
            textInput.value = { x, y };
          }}
        />
        {textInput.value && (
          <TextInputOverlay
            x={textInput.value.x}
            y={textInput.value.y}
            scale={scale.value}
            scrollY={iframeScrollY.value}
            onCommit={(text) => {
              if (text && textInput.value) {
                pushOp({
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

        {/* Annotation sidebar panel */}
        <AnnotationPanel
          onScrollTo={(_x, y) => {
            // Scroll the iframe to bring the annotation into view
            try {
              const win = frameRef.current?.contentWindow;
              if (win) {
                win.scrollTo({ top: Math.max(0, y - 200), behavior: 'smooth' });
              }
            } catch {
              /* cross-origin */
            }
          }}
        />
      </div>

      {!readonly && <Toolbar />}

      {readonly && (
        <div
          class={clsx(
            'fixed bottom-5 left-1/2 -translate-x-1/2 z-[2147483646] px-4 py-2.5 flex items-center gap-3',
            glass.surfaceSmall,
            glass.font,
          )}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="text-white/40"
            aria-hidden="true"
          >
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          <span class="text-[12px] text-white/50 font-medium">View-only mode</span>
        </div>
      )}

      {toasts.value.length > 0 && (
        <div class="fixed top-12 left-1/2 -translate-x-1/2 z-[2147483647] flex flex-col gap-2 items-center">
          {toasts.value.map((t) => (
            <div
              key={t.id}
              class={`${glass.surfaceSmall} ${glass.font} px-4 py-2.5 text-xs font-medium
                      animate-[fadeInDown_0.2s_ease-out]
                      ${t.type === 'error' ? 'text-red-300' : t.type === 'success' ? 'text-green-300' : 'text-white/70'}`}
            >
              {t.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── Shared components ─── */

function Spinner() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" class="animate-spin" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2.5" opacity="0.25" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" />
    </svg>
  );
}

let logoIdx = 0;
export function Logo({ size = 24 }: { size?: number }) {
  const id = `ml${++logoIdx}`;
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" fill="none" aria-hidden="true">
      <rect width="512" height="512" rx="128" fill={`url(#${id})`} />
      <path
        transform="translate(80 80) scale(22)"
        stroke="white"
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="1.5"
        d="m9.324 3.324 3.352 3.352m-6.746 6.59 7.595-7.419c.95-.928.958-2.452.02-3.391v0a2.384 2.384 0 0 0-3.392.02l-7.42 7.594-.983 4.18 4.18-.983Z"
      />
      <defs>
        <linearGradient id={id} gradientTransform="rotate(45)" style={{ transformOrigin: 'center center' }}>
          <stop stop-color="#F953C6" />
          <stop offset="1" stop-color="#B91D73" />
        </linearGradient>
      </defs>
    </svg>
  );
}

function GithubLink({ dark }: { dark?: boolean }) {
  return (
    <a
      href="https://github.com/thevrus/MarkLayer"
      target="_blank"
      rel="noopener"
      class={
        dark
          ? 'text-black/25 hover:text-black/50 transition-colors no-underline'
          : 'text-white/25 hover:text-white/50 transition-colors no-underline'
      }
    >
      <span class="sr-only">GitHub</span>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
      </svg>
    </a>
  );
}

/* ─── Landing page (Klack-inspired) ─── */

const FEATURES = [
  {
    label: 'Drawing\ntools',
    d: 'M12 19l7-7 3 3-7 7-3-3z M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z M2 2l7.586 7.586 M11 13a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  },
  {
    label: 'Real-time\ncollaboration',
    d: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M23 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75',
  },
  {
    label: 'Shareable\nlinks',
    d: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71 M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71',
  },
  { label: 'Threaded\ncomments', d: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z' },
  { label: 'No sign-up\nrequired', d: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2 M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z' },
  {
    label: 'Private\nby default',
    d: 'M3 13a2 2 0 0 0 0 0h0a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7z M7 11V7a5 5 0 0 1 10 0v4',
  },
  {
    label: 'Browser\nextension',
    d: 'M18 3a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3 3 3 0 0 0 3-3 3 3 0 0 0-3-3H6a3 3 0 0 0-3 3 3 3 0 0 0 3 3 3 3 0 0 0 3-3V6a3 3 0 0 0-3-3 3 3 0 0 0-3 3 3 3 0 0 0 3 3h12a3 3 0 0 0 3-3 3 3 0 0 0-3-3z',
  },
  { label: 'Free &\nopen source', d: 'M16 18l6-6-6-6 M8 6l-6 6 6 6' },
] as const;

function FeatureIcon({ d }: { d: string }) {
  return (
    <svg
      width="56"
      height="56"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.75"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}

function TextInputOverlay({
  x,
  y,
  scale: s,
  scrollY,
  onCommit,
}: {
  x: number;
  y: number;
  scale: number;
  scrollY: number;
  onCommit: (text: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const fontSize = Math.max(14, lineWidth.value * 6);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  const vx = x * s;
  const vy = y * s - scrollY;

  return (
    <textarea
      ref={ref}
      class="absolute bg-transparent border-none outline-none resize-none p-0 m-0"
      style={{
        left: vx,
        top: vy,
        fontSize: `${fontSize * s}px`,
        lineHeight: 1.3,
        color: color.value,
        fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Inter", system-ui, sans-serif',
        minWidth: '40px',
        minHeight: `${fontSize * s * 1.3}px`,
        caretColor: color.value,
        fieldSizing: 'content',
        zIndex: 2147483646,
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          onCommit((e.currentTarget as HTMLTextAreaElement).value.trim());
        } else if (e.key === 'Escape') {
          e.preventDefault();
          onCommit('');
        }
      }}
      onBlur={(e) => {
        onCommit((e.currentTarget as HTMLTextAreaElement).value.trim());
      }}
      placeholder="Type here..."
    />
  );
}
