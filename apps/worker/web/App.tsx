import { Toolbar } from '@ext/components/Toolbar';
import { glass } from '@ext/lib/glass';
import { hexToRgba, inView, opBounds, renderOp, simplify } from '@ext/lib/renderer';
import {
  activeTool,
  color,
  comments as commentsComputed,
  cycleTheme,
  FREEHAND,
  isDrawingActive,
  isDrawingTool,
  lineWidth,
  localUser,
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
  setUserName,
  showAnnotationPanel,
  showShareDialog,
  theme,
  toast,
  toasts,
  undo,
  undoRedoFlash,
} from '@ext/lib/state';
import type { DeviceMode, DrawOp, FreehandOp, Point, TextOp } from '@ext/lib/types';
import { effect, signal, useSignalEffect } from '@preact/signals';
import clsx from 'clsx';
import type { LucideIcon } from 'lucide-preact';
import {
  ArrowRight,
  Code,
  Link,
  Loader2,
  Lock,
  MessageSquare,
  Monitor,
  Moon,
  PenTool,
  Puzzle,
  Search,
  Smartphone,
  Sun,
  Tablet,
  Upload,
  User,
  Users,
} from 'lucide-preact';
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

const isMobileDevice = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) && 'ontouchstart' in window;

// Web-specific state
const iframeScrollY = signal(0);
/** CSS transform scale — how much the locked container is visually scaled to fit the viewer */
const cssScale = signal(1);
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

const VALID_DEVICES = new Set<DeviceMode>(['desktop', 'tablet', 'mobile']);
const initDevice = new URLSearchParams(location.search).get('device') as DeviceMode | null;
export const deviceMode = signal<DeviceMode>(initDevice && VALID_DEVICES.has(initDevice) ? initDevice : 'desktop');
const DEVICE_WIDTHS: Record<DeviceMode, number> = { desktop: 0, tablet: 768, mobile: 390 };

// Sync device mode to URL
effect(() => {
  const dev = deviceMode.value;
  const url = new URL(location.href);
  if (dev === 'desktop') url.searchParams.delete('device');
  else url.searchParams.set('device', dev);
  history.replaceState(null, '', url);
});

/** Tag an operation with the current device mode before pushing */
export function pushDeviceOp(op: DrawOp) {
  pushOp({ ...op, device: deviceMode.value } as DrawOp);
}

/** Check if an operation belongs to the current device viewport (ops without a device tag default to desktop) */
export function opMatchesDevice(op: { device?: string }): boolean {
  return (op.device ?? 'desktop') === deviceMode.value;
}

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
    if (!originalWidth.value || originalWidth.value <= 0 || Number.isNaN(originalWidth.value))
      originalWidth.value = 1280;
    annotationId.value = meta.substring(eqIdx + 1);
    isReadonly.value = params.get('readonly') === '1';
    return !!(pageUrl.value && annotationId.value);
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
  const scrollToAnnotation = useCallback((_x: number, y: number) => {
    try {
      const win = frameRef.current?.contentWindow;
      if (win) win.scrollTo({ top: Math.max(0, y - 200), behavior: 'smooth' });
    } catch {
      /* cross-origin */
    }
  }, []);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  /** Inner container — locked at originalWidth, CSS-transformed to fit viewer */
  const innerRef = useRef<HTMLDivElement>(null);
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
    const inner = innerRef.current;
    if (!inner) return { x: e.clientX + window.scrollX, y: e.clientY + window.scrollY };
    const r = inner.getBoundingClientRect();
    const cs = cssScale.value;
    return {
      x: (e.clientX - r.left) / cs,
      y: (e.clientY - r.top) / cs + iframeScrollY.value,
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
    const landing = isLanding.value;
    const viewer = viewerRef.current;
    const viewerW = viewer ? viewer.clientWidth : window.innerWidth;
    const viewerH = viewer ? viewer.clientHeight : window.innerHeight;
    const dev = deviceMode.value;
    const refW = dev === 'desktop' ? originalWidth.value || viewerW : DEVICE_WIDTHS[dev];
    const cs = refW && viewerW ? viewerW / refW : 1;
    if (cssScale.value !== cs) cssScale.value = cs;
    const canvasW = refW;
    // LP: full document height so canvas scrolls naturally; viewer: viewport height
    const canvasH = landing ? document.documentElement.scrollHeight : Math.round(viewerH / cs);
    if (canvas.width !== canvasW) canvas.width = canvasW;
    if (canvas.height !== canvasH) canvas.height = canvasH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvasW, canvasH);
    ctx.save();
    // LP: canvas is absolute (scrolls with page) so no translate needed
    // Viewer: canvas is fixed, translate to offset iframe scroll
    const scrollY = landing ? 0 : iframeScrollY.value;
    ctx.translate(0, -scrollY);
    const vx = 0;
    const vy = landing ? 0 : scrollY;
    const vw = canvasW;
    const vh = canvasH;
    for (const op of operations.value) {
      if (op.tool === 'comment' || op.tool === 'selection') continue;
      if (!opMatchesDevice(op)) continue;
      if (!inView(opBounds(op), vx, vy, vw, vh)) continue;
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
      isDrawingActive.value = true;
      const pos = canvasCoords(e);
      startPtRef.current = pos;
      const ctx = canvasRef.current?.getContext('2d');
      if (!ctx) return;
      applyTool(ctx);
      if (FREEHAND.has(tool)) {
        ctx.beginPath();
        ctx.moveTo(pos.x, pos.y - (isLanding.value ? 0 : iframeScrollY.value));
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
      const scrollOff = isLanding.value ? 0 : iframeScrollY.value;
      if (FREEHAND.has(tool)) {
        currentPathRef.current?.points.push(pos);
        ctx.lineTo(pos.x, pos.y - scrollOff);
        ctx.stroke();
      } else if (snapshotRef.current && SHAPES.has(tool)) {
        ctx.putImageData(snapshotRef.current, 0, 0);
        ctx.beginPath();
        const sp = startPtRef.current;
        const vsx = sp.x,
          vsy = sp.y - scrollOff;
        const vex = pos.x,
          vey = pos.y - scrollOff;
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

  // Re-render canvas when operations, scroll, or device mode change
  useSignalEffect(() => {
    operations.value;
    iframeScrollY.value;
    const dev = deviceMode.value;
    renderAll();
    // Device mode change triggers a CSS width transition — schedule a delayed re-render to match final size
    if (dev !== 'desktop') {
      const t = setTimeout(renderAll, 550);
      return () => clearTimeout(t);
    }
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

  // Send cursor position to peers
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const pos = canvasCoords(e);
      if (pos.x === 0 && pos.y === 0 && !innerRef.current) return;
      onCursorMove.value?.(pos.x, pos.y, activeTool.value);
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
    const sy = landing ? window.scrollY || 0 : iframeScrollY.value;
    const ir = landing ? null : innerRef.current?.getBoundingClientRect();
    const cs = cssScale.value;
    for (let i = 0; i < sel.rangeCount; i++) {
      for (const cr of sel.getRangeAt(i).getClientRects()) {
        if (landing) {
          rects.push({ x: cr.x + window.scrollX, y: cr.y + window.scrollY, width: cr.width, height: cr.height });
        } else if (fromIframe) {
          rects.push({ x: cr.x, y: cr.y + sy, width: cr.width, height: cr.height });
        } else if (ir) {
          rects.push({
            x: (cr.x - ir.left) / cs,
            y: (cr.y - ir.top) / cs + sy,
            width: cr.width / cs,
            height: cr.height / cs,
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
      screenX: fromIframe && ir ? last.right * cs + ir.left : last.right,
      screenY: fromIframe && ir ? last.bottom * cs + ir.top : last.bottom,
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

  if (!landing && isMobileDevice) {
    return (
      <div
        class="min-h-screen flex flex-col items-center justify-center px-6 font-['Inter',system-ui,sans-serif] text-center"
        style={{ background: 'var(--color-ml-bg)' }}
      >
        <Logo size={48} />
        <h1 class="text-[24px] font-bold text-ml-fg mt-6 mb-2">Desktop only</h1>
        <p class="text-[15px] text-ml-fg/50 max-w-[320px] leading-relaxed mb-8">
          Annotation tools require a desktop browser. Open this link on your computer to view and collaborate.
        </p>
        <a
          href="/"
          class="px-5 py-2.5 rounded-xl bg-ml-btn text-ml-btn-fg text-[14px] font-semibold no-underline hover:bg-ml-btn-hover transition-colors"
        >
          Back to home
        </a>
      </div>
    );
  }

  if (landing) {
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
                  Drawing tools and annotation require a desktop browser. Open this page on your computer to get
                  started.
                </p>
              </div>
            ) : (
              <>
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

                {/* Quick try */}
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
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-y-12 sm:gap-y-16 gap-x-6 sm:gap-x-10 group/features">
              {FEATURES.map((f, i) => (
                <div
                  key={i}
                  class="lp-fade-up flex flex-col items-center text-center transition-opacity duration-200 group-hover/features:opacity-40 hover:!opacity-100"
                  style={{ animationDelay: `${0.5 + i * 0.07}s` }}
                >
                  <div
                    class={`flex items-center justify-center w-28 h-28 rounded-3xl mb-5 transition-all duration-200 hover:bg-ml-btn/[0.06] text-ml-fg group/icon ${f.anim}`}
                  >
                    <f.icon
                      size={84}
                      strokeWidth={2.25}
                      aria-hidden="true"
                      class="transition-transform duration-500 ease-out"
                    />
                  </div>
                  <span class="text-[30px] font-semibold text-ml-fg leading-tight tracking-[-0.04em] whitespace-pre-line">
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

          {/* SEO footer copy */}
          <footer class="max-w-[520px] mx-auto px-6 pb-16 text-center">
            <p class="text-[16px] text-ml-fg/25 leading-relaxed">
              MarkLayer is a free, open-source web annotation tool. Annotate any webpage with drawings, highlights, and
              comments — then share a link for real-time collaboration. No account needed.
            </p>
          </footer>

          {/* Half-hidden watermark with gradient fade */}
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

          {/* Drawing canvas overlay — absolute so it scrolls with the page */}
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
                  class={clsx(
                    glass.surfaceSmall,
                    glass.font,
                    'px-4 py-2.5 text-xs font-medium animate-[fadeInDown_0.2s_ease-out]',
                    t.type === 'error'
                      ? 'text-red-500'
                      : t.type === 'success'
                        ? 'text-green-500'
                        : 'text-ml-glass-fg/70',
                  )}
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

  return (
    <div class={clsx('h-screen flex flex-col bg-ml-bg-viewer', glass.font)}>
      {/* Mobile gate — annotation tools need a desktop screen */}
      <div class="md:hidden fixed inset-0 z-[2147483647] bg-ml-bg flex flex-col items-center justify-center px-8 text-center font-['Inter',system-ui,sans-serif]">
        <Logo size={48} />
        <h2 class="text-[22px] font-bold text-ml-fg mt-6 mb-3 tracking-[-0.02em]">Desktop only</h2>
        <p class="text-[16px] text-ml-fg/40 leading-relaxed max-w-[300px] mb-8">
          MarkLayer's annotation tools are designed for desktop screens. Open this link on your computer.
        </p>
        <a href="/" class="px-5 py-2.5 rounded-xl bg-ml-btn text-ml-btn-fg text-[14px] font-semibold no-underline">
          Back to home
        </a>
      </div>
      {/* Top bar — uses same glass surface as toolbar */}
      <div class="flex items-center gap-3 px-4 h-[48px] z-50 shrink-0 bg-[var(--ml-glass-bg)] backdrop-blur-[80px] backdrop-saturate-[1.9] backdrop-brightness-[1.1] shadow-[0_1px_3px_oklch(0_0_0/0.08)]">
        {/* Logo */}
        <a
          href="/"
          class="flex items-center gap-2 no-underline shrink-0 group cursor-pointer rounded-lg px-2 py-1 -ml-2 hover:bg-ml-glass-fg/[0.05] transition-colors duration-150"
        >
          <Logo size={24} />
          <span class="text-[14px] font-bold tracking-[-0.02em] text-ml-glass-fg/70 group-hover:text-ml-glass-fg transition-colors">
            MarkLayer
          </span>
        </a>

        {/* Divider */}
        <div class={glass.sep} />

        {/* URL display — click to copy */}
        <button
          type="button"
          onClick={() => {
            navigator.clipboard.writeText(pageUrl.value).then(
              () => toast('URL copied!', 'success'),
              () => toast('Failed to copy', 'error'),
            );
          }}
          class="flex-1 min-w-0 flex items-center gap-2 px-2 bg-transparent border-none cursor-pointer rounded-lg py-1
                 hover:bg-ml-glass-fg/[0.05] transition-colors duration-150"
          title="Copy URL"
        >
          <Link size={16} class="text-ml-glass-fg/30 shrink-0" aria-hidden="true" />
          <span class="text-[13px] text-ml-glass-fg/40 truncate text-left">{pageUrl.value}</span>
        </button>

        {/* Divider */}
        <div class={glass.sep} />

        {/* Device viewport picker */}
        <div class="flex items-center gap-0.5 shrink-0">
          {(['desktop', 'tablet', 'mobile'] as DeviceMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => (deviceMode.value = mode)}
              class={clsx(
                'w-8 h-8 rounded-lg grid place-items-center cursor-pointer border-none transition-all duration-150 active:scale-[0.94]',
                deviceMode.value === mode
                  ? 'bg-ml-glass-accent/[0.14] text-ml-glass-fg shadow-[inset_0_0.5px_0_oklch(1_0_0/0.08)]'
                  : 'bg-transparent text-ml-glass-fg/35 hover:text-ml-glass-fg hover:bg-ml-glass-accent/[0.08]',
              )}
              title={`${mode.charAt(0).toUpperCase() + mode.slice(1)} viewport`}
            >
              {mode === 'desktop' && <Monitor size={16} aria-hidden="true" />}
              {mode === 'tablet' && <Tablet size={16} aria-hidden="true" />}
              {mode === 'mobile' && <Smartphone size={16} aria-hidden="true" />}
            </button>
          ))}
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
                    class="w-6 h-6 rounded-full text-white text-[9px] font-bold grid place-items-center border-[2px] border-ml-glass-fg/10 shadow-sm"
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
                <div class="w-6 h-6 rounded-full bg-ml-glass-accent/[0.1] text-ml-glass-fg/40 text-[9px] font-bold grid place-items-center border-[2px] border-ml-glass-fg/10">
                  +{peers.value.size - 5}
                </div>
              )}
            </div>
          )}
          {/* User avatar + name — click to edit */}
          <div class="flex items-center gap-1.5">
            <div
              class="w-6 h-6 rounded-full text-white text-[9px] font-bold grid place-items-center shrink-0 border-[2px] border-ml-glass-fg/10 shadow-sm"
              style={{ background: localUser.color }}
            >
              {localUser.name
                .split(' ')
                .map((w) => w[0])
                .join('')}
            </div>
            <input
              type="text"
              defaultValue={localUser.name}
              maxLength={24}
              class="w-[90px] bg-transparent border-none text-[11px] text-ml-glass-fg/50 font-medium outline-none truncate px-1 py-0.5 rounded hover:bg-ml-glass-accent/[0.06] focus:bg-ml-glass-accent/[0.08] focus:text-ml-glass-fg/80 cursor-text"
              title="Click to edit your name"
              onBlur={(e) => setUserName((e.target as HTMLInputElement).value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              }}
            />
          </div>
          {/* Connection indicator */}
          <div class="flex items-center gap-1.5 mr-0.5">
            <span
              class={clsx(
                'w-2 h-2 rounded-full shrink-0',
                connected.value ? 'bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.5)]' : 'bg-ml-glass-accent/20',
              )}
            />
            <span class="text-ml-glass-fg/35 text-[11px] font-medium tabular-nums">
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
                ? 'bg-ml-glass-accent/[0.14] text-ml-glass-fg shadow-[inset_0_0.5px_0_oklch(1_0_0/0.08)]'
                : 'bg-transparent text-ml-glass-fg/45 hover:text-ml-glass-fg hover:bg-ml-glass-accent/[0.1]',
            )}
            title="Annotations panel"
          >
            <MessageSquare size={16} aria-hidden="true" />
          </button>
          {/* Share session */}
          {!readonly && (
            <>
              <button
                type="button"
                onClick={() => doShare()}
                disabled={sharing.value}
                class={clsx(
                  'w-9 h-9 rounded-xl grid place-items-center cursor-pointer border-none transition-all duration-150 active:scale-[0.94] bg-transparent text-ml-glass-fg/45 hover:text-ml-glass-fg hover:bg-ml-glass-accent/[0.1]',
                  sharing.value && 'opacity-50 pointer-events-none',
                )}
                title="Copy editable link"
              >
                {sharing.value ? <Spinner /> : <Upload size={16} aria-hidden="true" />}
              </button>
              <button
                type="button"
                onClick={() => doShare({ readonly: true, expiresIn: 7 * 24 * 60 * 60 })}
                disabled={sharing.value}
                class={clsx(
                  'w-9 h-9 rounded-xl grid place-items-center cursor-pointer border-none transition-all duration-150 active:scale-[0.94] bg-transparent text-ml-glass-fg/45 hover:text-ml-glass-fg hover:bg-ml-glass-accent/[0.1]',
                  sharing.value && 'opacity-50 pointer-events-none',
                )}
                title="Copy read-only link (expires in 7 days)"
              >
                {sharing.value ? <Spinner /> : <Lock size={16} aria-hidden="true" />}
              </button>
            </>
          )}
          {/* Theme toggle */}
          <button
            type="button"
            onClick={(e) => {
              cycleTheme();
              (e.currentTarget as HTMLElement).blur();
            }}
            class="w-9 h-9 rounded-xl grid place-items-center cursor-pointer border-none transition-all duration-150 active:scale-[0.94] bg-transparent text-ml-glass-fg/45 hover:text-ml-glass-fg hover:bg-ml-glass-accent/[0.1]"
            title={`Theme: ${theme.value}`}
          >
            {theme.value === 'dark' ? <Moon size={16} aria-hidden="true" /> : <Sun size={16} aria-hidden="true" />}
          </button>
        </div>
      </div>

      {/* Viewer */}
      <div
        class={clsx(
          'flex-1 relative overflow-hidden',
          deviceMode.value !== 'desktop' && 'flex items-stretch justify-center bg-ml-bg-device',
        )}
      >
        <div
          id="viewer"
          ref={viewerRef}
          class={clsx(
            'relative h-full',
            deviceMode.value === 'desktop'
              ? 'w-full overflow-hidden'
              : 'shadow-[0_0_0_1px_rgba(0,0,0,0.08),0_8px_40px_rgba(0,0,0,0.12)] bg-white',
          )}
          style={
            deviceMode.value !== 'desktop' ? { width: DEVICE_WIDTHS[deviceMode.value], maxWidth: '100%' } : undefined
          }
        >
          {/* Inner container — locked at reference width, CSS-transformed to fit viewer */}
          <div
            ref={innerRef}
            class="absolute top-0 left-0 will-change-transform"
            style={{
              width: deviceMode.value === 'desktop' ? originalWidth.value || '100%' : DEVICE_WIDTHS[deviceMode.value],
              height: `${100 / cssScale.value}%`,
              transform: cssScale.value !== 1 ? `scale(${cssScale.value})` : undefined,
              transformOrigin: 'top left',
            }}
          >
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

            <CursorLayer scale={1} scrollY={iframeScrollY.value} />

            <div
              class="absolute inset-0"
              style={{
                pointerEvents: showCommentCursor ? 'auto' : 'none',
                cursor: showCommentCursor ? 'crosshair' : 'default',
              }}
              onClick={(e) => {
                if (tool !== 'comment') return;
                commentPopover.value = canvasCoords(e);
              }}
            >
              {comments.filter(opMatchesDevice).map((c) => (
                <WebCommentPin key={c.id} op={c} scale={1} scrollY={iframeScrollY.value} />
              ))}
            </div>

            {/* Selection highlights */}
            <div class="absolute inset-0 pointer-events-none overflow-hidden">
              {selections.value.filter(opMatchesDevice).map((op) => (
                <WebSelectionHighlight key={op.id} op={op} scale={1} scrollY={iframeScrollY.value} />
              ))}
            </div>

            {/* Text tool overlay */}
            <div
              class="absolute inset-0"
              style={{
                pointerEvents: showTextCursor ? 'auto' : 'none',
                cursor: showTextCursor ? 'text' : 'default',
              }}
              onClick={(e) => {
                if (tool !== 'text') return;
                textInput.value = canvasCoords(e);
              }}
            />
            {textInput.value && (
              <TextInputOverlay
                x={textInput.value.x}
                y={textInput.value.y}
                scale={1}
                scrollY={iframeScrollY.value}
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
          </div>

          {/* Comment popover — fixed position, outside transform container */}
          {commentPopover.value && (
            <WebCommentPopover
              x={commentPopover.value.x}
              y={commentPopover.value.y}
              scale={cssScale.value}
              scrollY={iframeScrollY.value}
              onClose={() => {
                commentPopover.value = null;
              }}
            />
          )}

          {/* Selection popover — fixed position, outside transform container */}
          {selectionPopover.value && (
            <WebSelectionPopover
              {...selectionPopover.value}
              onClose={() => {
                selectionPopover.value = null;
              }}
            />
          )}

          {/* Annotation sidebar panel (desktop: overlay inside viewer) */}
          {deviceMode.value === 'desktop' && <AnnotationPanel onScrollTo={scrollToAnnotation} />}
        </div>

        {/* Annotation sidebar panel (tablet/mobile: docked beside viewer) */}
        {deviceMode.value !== 'desktop' && <AnnotationPanel docked onScrollTo={scrollToAnnotation} />}
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
          <Lock size={14} class="text-ml-glass-fg/40" aria-hidden="true" />
          <span class="text-[12px] text-ml-glass-fg/50 font-medium">View-only mode</span>
        </div>
      )}

      {toasts.value.length > 0 && (
        <div class="fixed top-12 left-1/2 -translate-x-1/2 z-[2147483647] flex flex-col gap-2 items-center">
          {toasts.value.map((t) => (
            <div
              key={t.id}
              class={`${glass.surfaceSmall} ${glass.font} px-4 py-2.5 text-xs font-medium
                      animate-[fadeInDown_0.2s_ease-out]
                      ${t.type === 'error' ? 'text-red-500' : t.type === 'success' ? 'text-green-500' : 'text-ml-glass-fg/70'}`}
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
  return <Loader2 size={16} class="animate-spin" aria-hidden="true" />;
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
          ? 'text-ml-fg/25 hover:text-ml-fg/50 transition-colors no-underline'
          : 'text-ml-glass-fg/25 hover:text-ml-glass-fg/50 transition-colors no-underline'
      }
    >
      <span class="sr-only">GitHub</span>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
      </svg>
    </a>
  );
}

const FEATURES: { label: string; icon: LucideIcon; anim: string }[] = [
  { label: 'Drawing\ntools', icon: PenTool, anim: 'lp-anim-wiggle' },
  { label: 'Real-time\ncollaboration', icon: Users, anim: 'lp-anim-bounce' },
  { label: 'Shareable\nlinks', icon: Link, anim: 'lp-anim-rotate' },
  { label: 'Threaded\ncomments', icon: MessageSquare, anim: 'lp-anim-bounce' },
  { label: 'No sign-up\nrequired', icon: User, anim: 'lp-anim-bounce' },
  { label: 'Private\nby default', icon: Lock, anim: 'lp-anim-shake' },
  { label: 'Browser\nextension', icon: Puzzle, anim: 'lp-anim-rotate' },
  { label: 'Free &\nopen source', icon: Code, anim: 'lp-anim-pulse' },
];

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
