import { ContextMenu } from '@ext/components/ContextMenu';
import { Toolbar } from '@ext/components/Toolbar';
import { Tooltip } from '@ext/components/Tooltip';
import { captureScale } from '@ext/lib/anchor';
import { animationsFrozen, freezeDocument, thawDocument } from '@ext/lib/freeze';
import { glass } from '@ext/lib/glass';
import { constrainEnd, hexToRgba, inView, opBounds, renderOp, simplify } from '@ext/lib/renderer';
import { isLikelyEmbedHostile } from '@ext/lib/share';
import {
  activeTool,
  areas,
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
import type { FreehandOp, Point, TextOp } from '@ext/lib/types';
import { cn } from '@marklayer/types';
import { useSignal, useSignalEffect } from '@preact/signals';
import {
  Calendar,
  Copy,
  Hash,
  Info,
  Link,
  Loader2,
  Lock,
  MessageSquare,
  Mic,
  MicOff,
  Monitor,
  Moon,
  PenTool,
  Smartphone,
  Sun,
  Tablet,
  Timer,
  Upload,
  Users,
  Video,
  VideoOff,
  X,
} from 'lucide-preact';
import { nanoid } from 'nanoid';
import posthog from 'posthog-js';
import { useCallback, useEffect, useRef } from 'preact/hooks';
import { tinykeys } from 'tinykeys';
import { AnnotationPanel, DockedAnnotationPanel } from './AnnotationPanel';
import { CursorLayer } from './CursorLayer';
import { ProjectTabs } from './ProjectTabs';
import { Logo, TextInputOverlay } from './shared';
import {
  API_BASE,
  annotationId,
  attachIframeMutationObserver,
  commentPopover,
  cssScale,
  currentPageIdx,
  DEVICE_WIDTHS,
  deviceMode,
  followingPeer,
  iframeScrollY,
  isMobileDevice,
  isReadonly,
  loadProject,
  navigateTo,
  onFollowScroll,
  opMatchesDevice,
  originalWidth,
  pageUrl,
  projectId,
  projectLoading,
  projectPages,
  pushDeviceOp,
  selectionPopover,
  sharing,
  showInfoPanel,
  textInput,
  timeAgo,
} from './signals';
import {
  connected,
  createdAt,
  expiresAt,
  localPeerId,
  serverUrl,
  serverWidth,
  useRealtimeSync,
} from './useRealtimeSync';
import { localVideoStream, useVoiceRoom, videoActive, voiceActive, voiceLevel, voiceMuted } from './useVoiceRoom';
import { WebAreaLayer } from './WebAreaLayer';
import { WebAreaShape } from './WebAreaShape';
import { WebCommentPin } from './WebCommentPin';
import { WebCommentPopover } from './WebCommentPopover';
import { WebInspectorLayer } from './WebInspectorLayer';
import { WebMeasureLayer } from './WebMeasureLayer';
import { WebMultiInspectLayer } from './WebMultiInspectLayer';
import { WebSelectionHighlight } from './WebSelectionHighlight';
import { WebSelectionPopover } from './WebSelectionPopover';

/* ─── InfoPanel (viewer-only, keeps useRealtimeSync out of shared.tsx) ─── */

const TOOL_LABELS: Record<string, string> = {
  pen: 'Pen strokes',
  highlight: 'Highlights',
  rectangle: 'Rectangles',
  circle: 'Circles',
  line: 'Lines',
  arrow: 'Arrows',
  text: 'Text labels',
  comment: 'Comments',
  selection: 'Selections',
};

function InfoRow({ icon: Icon, label, value }: { icon: typeof Info; label: string; value: string }) {
  return (
    <div class="flex items-start gap-3 py-2">
      <Icon size={14} class="text-ml-glass-fg/25 shrink-0 mt-0.5" aria-hidden="true" />
      <div class="flex-1 min-w-0">
        <div class="text-[10px] text-ml-glass-fg/30 font-medium uppercase tracking-wider">{label}</div>
        <div class="text-[12.5px] text-ml-glass-fg/70 mt-0.5 break-all">{value}</div>
      </div>
    </div>
  );
}

function InfoPanel() {
  const ops = operations.value;
  const toolCounts = new Map<string, number>();
  for (const op of ops) {
    if (op.tool === 'eraser') continue;
    const t = op.tool === 'line' && op.arrow ? 'arrow' : op.tool;
    toolCounts.set(t, (toolCounts.get(t) || 0) + 1);
  }
  const created = createdAt.value;
  const expires = expiresAt.value;
  const readonly = isReadonly.value;
  const url = pageUrl.value;
  const id = annotationId.value;
  const online = peerCount.value;
  const isConnected = connected.value;

  return (
    <div
      class={cn(
        'absolute top-3 left-3 bottom-3 w-[300px] z-40 transition-all duration-300 ease-ml-spring',
        glass.surface,
        'flex flex-col overflow-hidden',
        showInfoPanel.value ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-4 pointer-events-none',
      )}
    >
      <div class="px-4 py-3 border-b border-ml-glass-fg/[0.1] shrink-0 flex items-center justify-between">
        <h2 class="text-[13px] font-semibold text-ml-glass-fg/80 m-0">Annotation Info</h2>
        <button
          type="button"
          onClick={() => (showInfoPanel.value = false)}
          class="w-7 h-7 rounded-xl grid place-items-center cursor-pointer bg-transparent border-none text-ml-glass-fg/65 hover:text-ml-glass-fg hover:bg-ml-glass-accent/[0.1] active:scale-[0.94] transition-all duration-150"
        >
          <X size={14} aria-hidden="true" />
        </button>
      </div>
      <div class="flex-1 overflow-y-auto px-4 py-2">
        {created != null && (
          <InfoRow
            icon={Calendar}
            label="Created"
            value={`${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(created * 1000)} (${timeAgo(created)})`}
          />
        )}
        <InfoRow
          icon={Timer}
          label="Expires"
          value={
            expires == null
              ? 'Never'
              : expires * 1000 < Date.now()
                ? 'Expired'
                : `${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(expires * 1000)} (${timeAgo(expires)})`
          }
        />
        <div class="flex items-start gap-3 py-2">
          <Users size={14} class="text-ml-glass-fg/25 shrink-0 mt-0.5" aria-hidden="true" />
          <div class="flex-1 min-w-0">
            <div class="text-[10px] text-ml-glass-fg/30 font-medium uppercase tracking-wider">Session</div>
            <div class="flex items-center gap-2 mt-0.5">
              <span
                class={cn(
                  'w-1.5 h-1.5 rounded-full shrink-0',
                  isConnected ? 'bg-green-400 shadow-[0_0_4px_rgba(74,222,128,0.5)]' : 'bg-ml-glass-fg/20',
                )}
              />
              <span class="text-[12.5px] text-ml-glass-fg/70">
                {isConnected ? `Connected · ${online} online` : 'Offline'}
              </span>
            </div>
          </div>
        </div>
        <InfoRow icon={readonly ? Lock : Upload} label="Access" value={readonly ? 'Read-only' : 'Editable'} />
        {url && (
          <div class="flex items-start gap-3 py-2">
            <Link size={14} class="text-ml-glass-fg/25 shrink-0 mt-0.5" aria-hidden="true" />
            <div class="flex-1 min-w-0">
              <div class="text-[10px] text-ml-glass-fg/30 font-medium uppercase tracking-wider">Page URL</div>
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                class="text-[12.5px] text-ml-glass-fg/50 hover:text-ml-glass-fg/80 mt-0.5 break-all no-underline hover:underline block transition-colors"
              >
                {url}
              </a>
            </div>
          </div>
        )}
        {id && (
          <div class="flex items-start gap-3 py-2">
            <Hash size={14} class="text-ml-glass-fg/25 shrink-0 mt-0.5" aria-hidden="true" />
            <div class="flex-1 min-w-0">
              <div class="text-[10px] text-ml-glass-fg/30 font-medium uppercase tracking-wider">ID</div>
              <button
                type="button"
                class="flex items-center gap-1.5 text-[12.5px] text-ml-glass-fg/50 hover:text-ml-glass-fg/80 mt-0.5 bg-transparent border-none cursor-pointer p-0 font-mono transition-colors"
                onClick={() => {
                  navigator.clipboard.writeText(id).then(
                    () => toast('ID copied!', 'success'),
                    () => toast('Failed to copy', 'error'),
                  );
                }}
                title="Click to copy"
              >
                {id}
                <Copy size={11} class="shrink-0 opacity-40" aria-hidden="true" />
              </button>
            </div>
          </div>
        )}
        {ops.length > 0 && <div class="h-px bg-ml-glass-fg/[0.06] my-2" />}
        {ops.length > 0 && (
          <div>
            <div class="flex items-center gap-2 mb-2">
              <PenTool size={14} class="text-ml-glass-fg/25" aria-hidden="true" />
              <span class="text-[10px] text-ml-glass-fg/30 font-medium uppercase tracking-wider">
                Annotations ({ops.length})
              </span>
            </div>
            <div class="grid grid-cols-2 gap-x-4 gap-y-1 pl-[26px]">
              {Array.from(toolCounts.entries())
                .sort((a, b) => b[1] - a[1])
                .map(([tool, count]) => (
                  <div key={tool} class="flex items-center justify-between">
                    <span class="text-[11.5px] text-ml-glass-fg/50">{TOOL_LABELS[tool] || tool}</span>
                    <span class="text-[11.5px] text-ml-glass-fg/30 tabular-nums">{count}</span>
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Viewer() {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const iframeLoaded = useSignal(false);
  const renderFailed = useSignal<null | 'timeout' | 'no-marker' | 'iframe-error'>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const drawingRef = useRef(false);
  const startPtRef = useRef<Point>({ x: 0, y: 0 });
  const currentPathRef = useRef<FreehandOp | null>(null);
  const snapshotRef = useRef<ImageData | null>(null);
  const shiftHeldRef = useRef(false);
  const lastPosRef = useRef<Point | null>(null);

  const scrollToAnnotation = useCallback((_x: number, y: number) => {
    try {
      const win = frameRef.current?.contentWindow;
      if (win) win.scrollTo({ top: Math.max(0, y - 200), behavior: 'smooth' });
    } catch {
      /* cross-origin */
    }
  }, []);

  useRealtimeSync(annotationId.value);
  useVoiceRoom(localPeerId);

  // Fill page URL / width from server when using short URLs
  useSignalEffect(() => {
    const u = serverUrl.value;
    const w = serverWidth.value;
    if (u && !pageUrl.value) pageUrl.value = u;
    if (w && !originalWidth.value) originalWidth.value = w;
  });

  // Project init: when /p/:id is in the URL, fetch all pages and activate the selected one.
  useEffect(() => {
    const pid = projectId.value;
    if (!pid) return;
    let cancelled = false;
    projectLoading.value = true;
    loadProject(pid).then((data) => {
      if (cancelled || !data) {
        projectLoading.value = false;
        if (!cancelled) toast('Project not found or expired', 'error', 4000);
        return;
      }
      projectPages.value = data.pages;
      const idx = Math.min(currentPageIdx.value, data.pages.length - 1);
      currentPageIdx.value = Math.max(0, idx);
      projectLoading.value = false;
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // When project page changes, switch the active annotation room and reset URL/ops/width.
  // Take a defensive copy of cached ops so subsequent mutations on either page can't bleed across.
  useSignalEffect(() => {
    if (!projectId.value) return;
    const pages = projectPages.value;
    const idx = currentPageIdx.value;
    const page = pages[idx];
    if (!page) return;
    if (annotationId.value === page.id) return;
    annotationId.value = page.id;
    pageUrl.value = page.url ?? '';
    originalWidth.value = page.width ?? 0;
    operations.value = [...page.ops];
    iframeScrollY.value = 0;
    peers.value = new Map();
  });

  // Reset loading state when the proxied URL changes
  useSignalEffect(() => {
    pageUrl.value;
    iframeLoaded.value = false;
    renderFailed.value = null;
  });

  const renderStartRef = useRef(0);
  const captureRenderFailed = (reason: 'timeout' | 'no-marker' | 'iframe-error', extra?: Record<string, unknown>) => {
    posthog.capture('page_render_failed', {
      url: pageUrl.value,
      reason,
      duration_ms: Math.round(performance.now() - renderStartRef.current),
      annotation_id: annotationId.value || null,
      ...extra,
    });
  };
  useSignalEffect(() => {
    const url = pageUrl.value;
    const loaded = iframeLoaded.value;
    if (!url || loaded) return;
    renderStartRef.current = performance.now();
    const timer = window.setTimeout(() => {
      captureRenderFailed('timeout');
      if (!iframeLoaded.peek()) renderFailed.value = 'timeout';
    }, 12_000);
    return () => clearTimeout(timer);
  });

  // Export PNG. Captures the live page (iframe content) plus the drawing canvas
  // composited together via modern-screenshot's `domToBlob`. The proxy serves
  // pages same-origin so the iframe's contentDocument is accessible to the
  // capture pass. Falls back to a canvas-only PNG if DOM capture throws — same
  // shape as the previous behavior, so we never lose the export.
  useEffect(() => {
    onExportPng.value = async () => {
      const canvas = canvasRef.current;
      const inner = innerRef.current;
      const downloadBlob = (blob: Blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `marklayer-${Date.now()}.png`;
        a.click();
        URL.revokeObjectURL(url);
      };
      const fallbackToCanvas = () => {
        if (!canvas) return;
        canvas.toBlob((b) => {
          if (b) {
            downloadBlob(b);
            toast('PNG exported (drawings only)', 'success');
          }
        });
      };
      if (!inner) return fallbackToCanvas();
      try {
        const { domToBlob } = await import('modern-screenshot');
        const blob = await domToBlob(inner, {
          backgroundColor: '#ffffff',
          scale: window.devicePixelRatio || 1,
        });
        if (blob) {
          downloadBlob(blob);
          toast('PNG exported!', 'success');
        } else {
          fallbackToCanvas();
        }
      } catch {
        fallbackToCanvas();
      }
    };
    return () => {
      onExportPng.value = null;
    };
  }, []);

  // Mirror the freeze toggle into the iframe document. The host-side toggle
  // (Settings panel) calls `freezeDocument(document)`, which only affects the
  // host — but for the web preview the page being inspected lives inside the
  // iframe, so we re-apply the same freeze inside `frame.contentDocument`.
  // The iframe doc may swap when the user navigates the proxied page, so we
  // also re-freeze on `load` while the toggle is on.
  useSignalEffect(() => {
    if (!animationsFrozen.value) return;
    const frame = frameRef.current;
    const doc = frame?.contentDocument;
    if (doc) freezeDocument(doc);
    const onLoad = () => {
      const next = frame?.contentDocument;
      if (next && animationsFrozen.peek()) freezeDocument(next);
    };
    frame?.addEventListener('load', onLoad);
    return () => {
      frame?.removeEventListener('load', onLoad);
      const cur = frame?.contentDocument;
      if (cur) thawDocument(cur);
    };
  });

  // Auto-save reminder — ops sync in real-time, so just confirm on close
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (operations.value.length > 0 && !connected.value) e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  // Iframe setup
  const programmaticScroll = useRef(false);
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    let detachMutationObserver: (() => void) | null = null;
    const setupFrame = () => {
      try {
        const win = frame.contentWindow;
        if (!win?.document.body) return;
        // Re-attach the mutation observer per `load` so it tracks the new
        // document. Old observer is detached automatically by GC, but call
        // teardown to release the closure-held RAF state too.
        detachMutationObserver?.();
        detachMutationObserver = attachIframeMutationObserver(win.document);
        win.addEventListener('scroll', () => {
          iframeScrollY.value = win.scrollY || 0;
          // Break follow mode on user-initiated scroll
          if (followingPeer.value && !programmaticScroll.current) {
            followingPeer.value = null;
          }
        });
        // Break follow mode on user interaction in iframe
        win.addEventListener('mousedown', () => {
          if (followingPeer.value) followingPeer.value = null;
        });
        win.addEventListener(
          'wheel',
          () => {
            if (followingPeer.value) followingPeer.value = null;
          },
          { passive: true },
        );
        const forwardKey = (type: 'keydown' | 'keyup') => (e: KeyboardEvent) => {
          window.dispatchEvent(
            new KeyboardEvent(type, {
              key: e.key,
              code: e.code,
              metaKey: e.metaKey,
              ctrlKey: e.ctrlKey,
              shiftKey: e.shiftKey,
              altKey: e.altKey,
            }),
          );
        };
        win.addEventListener('keydown', forwardKey('keydown'));
        win.addEventListener('keyup', forwardKey('keyup'));
        // Forward cursor position from iframe so peers see it even when navigate tool is active
        win.addEventListener('mousemove', (e) => {
          onCursorMove.value?.(e.clientX, e.clientY + (win.scrollY || 0), activeTool.value);
        });
        // Follow mode: scroll iframe to followed peer's Y
        onFollowScroll.value = (y: number) => {
          programmaticScroll.current = true;
          win.scrollTo({ top: Math.max(0, y - win.innerHeight / 2), behavior: 'smooth' });
          // Reset flag after scroll settles
          setTimeout(() => {
            programmaticScroll.current = false;
          }, 300);
        };
      } catch {
        /* cross-origin */
      }
    };
    setupFrame();
    frame.addEventListener('load', setupFrame);
    return () => {
      frame.removeEventListener('load', setupFrame);
      detachMutationObserver?.();
      onFollowScroll.value = null;
    };
  }, []);

  // Link interception from proxy
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type === 'ml-navigate' && typeof e.data.url === 'string') navigateTo(e.data.url);
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const isEditable = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    };
    const guard = (fn: (e: KeyboardEvent) => void) => (e: KeyboardEvent) => {
      if (isReadonly.value || isEditable(e.target)) return;
      fn(e);
    };

    const bindings: Record<string, (e: KeyboardEvent) => void> = {
      '$mod+KeyR': guard((e) => {
        e.preventDefault();
        window.location.reload();
      }),
      '$mod+KeyZ': guard((e) => {
        e.preventDefault();
        undo();
      }),
      '$mod+Shift+KeyZ': guard((e) => {
        e.preventDefault();
        redo();
      }),
      '$mod+KeyY': guard((e) => {
        e.preventDefault();
        redo();
      }),
      Escape: (e) => {
        if (isReadonly.value) return;
        if (isEditable(e.target) && e.target instanceof HTMLElement) {
          e.target.blur();
          return;
        }
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
        if (showInfoPanel.value) {
          showInfoPanel.value = false;
          e.preventDefault();
          return;
        }
        activeTool.value = 'navigate';
        e.preventDefault();
      },
    };
    for (const [letter, tool] of Object.entries(SHORTCUT_MAP)) {
      bindings[`Key${letter}`] = guard((e) => {
        activeTool.value = tool;
        e.preventDefault();
      });
    }
    return tinykeys(window, bindings);
  }, []);

  // Share dialog signal
  useSignalEffect(() => {
    if (!showShareDialog.value) return;
    showShareDialog.value = false;
    doShare();
  });

  async function doShare(opts?: { readonly?: boolean; expiresIn?: number }) {
    if (sharing.value) return;
    sharing.value = true;
    // Project share: just copy the /p/:id link — pages are already persisted as the user added them
    const pid = projectId.value;
    if (pid) {
      let shareUrl = `${location.origin}/p/${pid}`;
      if (opts?.readonly) shareUrl += '?readonly=1';
      try {
        await navigator.clipboard.writeText(shareUrl);
        toast('Project link copied!', 'success');
      } catch {
        toast('Failed to copy link', 'error');
      } finally {
        sharing.value = false;
      }
      return;
    }

    const id = annotationId.value || nanoid();
    annotationId.value = id;
    const url_ = pageUrl.value || location.origin;
    const ow = originalWidth.value || window.innerWidth;

    // Copy link immediately so the user gets instant feedback
    let shareUrl = `${location.origin}/s/${id}`;
    if (opts?.readonly) shareUrl += '?readonly=1';
    await navigator.clipboard.writeText(shareUrl);
    toast('Link copied!', 'success');

    // Save to server in the background
    try {
      const payload: Record<string, unknown> = { ops: operations.value, url: url_, width: ow };
      if (opts?.expiresIn) payload.expires_in = opts.expiresIn;
      const res = await fetch(`${API_BASE}${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error();
    } catch {
      toast('Failed to save — link may not work', 'error');
    } finally {
      sharing.value = false;
    }
  }

  // Aggregate ops across all project pages (current page = live, others = cached on load)
  function buildExportData() {
    const pid = projectId.value;
    if (!pid) return { ops: operations.value, url: pageUrl.value || undefined };
    const pages = projectPages.value;
    const idx = currentPageIdx.value;
    const liveOps = operations.value;
    const aggregated = pages.map((p, i) => ({
      url: p.url,
      ops: i === idx ? liveOps : p.ops,
    }));
    return { ops: liveOps, url: pageUrl.value || undefined, pages: aggregated };
  }

  const canvasCoords = useCallback((e: MouseEvent): Point => {
    const inner = innerRef.current;
    if (!inner) return { x: e.clientX + window.scrollX, y: e.clientY + window.scrollY };
    const r = inner.getBoundingClientRect();
    const cs = cssScale.value;
    return { x: (e.clientX - r.left) / cs, y: (e.clientY - r.top) / cs + iframeScrollY.value };
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
    const viewerW = viewer ? viewer.clientWidth : window.innerWidth;
    const viewerH = viewer ? viewer.clientHeight : window.innerHeight;
    const dev = deviceMode.value;
    const refW = dev === 'desktop' ? originalWidth.value || viewerW : DEVICE_WIDTHS[dev];
    const cs = refW && viewerW ? viewerW / refW : 1;
    if (cssScale.value !== cs) cssScale.value = cs;
    const canvasW = refW;
    const canvasH = Math.round(viewerH / cs);
    if (canvas.width !== canvasW) canvas.width = canvasW;
    if (canvas.height !== canvasH) canvas.height = canvasH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvasW, canvasH);
    ctx.save();
    const scrollY = iframeScrollY.value;
    ctx.translate(0, -scrollY);
    for (const op of operations.value) {
      if (op.tool === 'comment' || op.tool === 'selection') continue;
      if (!opMatchesDevice(op)) continue;
      const scale = captureScale(op.captureViewport);
      const bounds = opBounds(op);
      const scaledBounds =
        bounds && scale !== 1
          ? { x: bounds.x * scale, y: bounds.y * scale, w: bounds.w * scale, h: bounds.h * scale }
          : bounds;
      if (!inView(scaledBounds, 0, scrollY, canvasW, canvasH)) continue;
      renderOp(ctx, op, 0, 0, scale);
    }
    ctx.restore();
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
      lastPosRef.current = pos;
      shiftHeldRef.current = e.shiftKey;
      const ctx = canvasRef.current?.getContext('2d');
      if (!ctx) return;
      applyTool(ctx);
      if (FREEHAND.has(tool) || SHAPES.has(tool)) {
        snapshotRef.current = ctx.getImageData(0, 0, canvasRef.current!.width, canvasRef.current!.height);
      }
      if (FREEHAND.has(tool)) {
        currentPathRef.current = {
          id: nanoid(),
          tool,
          points: [pos],
          color: tool === 'highlight' ? hexToRgba(color.value, 0.4) : color.value,
          lineWidth: ctx.lineWidth,
          compositeOperation: ctx.globalCompositeOperation,
        };
      }
    },
    [canvasCoords, applyTool],
  );

  const renderPreview = useCallback(() => {
    if (!drawingRef.current) return;
    const tool = activeTool.value;
    const ctx = canvasRef.current?.getContext('2d');
    const pos = lastPosRef.current;
    if (!ctx || !pos) return;
    const scrollOff = iframeScrollY.value;
    const sp = startPtRef.current;

    if (FREEHAND.has(tool)) {
      if (!snapshotRef.current) return;
      const path = currentPathRef.current;
      if (!path) return;
      ctx.putImageData(snapshotRef.current, 0, 0);
      ctx.save();
      ctx.translate(0, -scrollOff);
      if (shiftHeldRef.current) {
        const start = path.points[0];
        const end = constrainEnd(tool, start.x, start.y, pos.x, pos.y);
        renderOp(ctx, { ...path, points: [start, end] }, 0, 0);
      } else if (path.points.length > 1) {
        renderOp(ctx, path, 0, 0);
      }
      ctx.restore();
      return;
    }

    if (SHAPES.has(tool) && snapshotRef.current) {
      ctx.putImageData(snapshotRef.current, 0, 0);
      ctx.beginPath();
      const { x: ex, y: ey } = shiftHeldRef.current
        ? constrainEnd(tool, sp.x, sp.y, pos.x, pos.y)
        : { x: pos.x, y: pos.y };
      const vsx = sp.x;
      const vsy = sp.y - scrollOff;
      const vex = ex;
      const vey = ey - scrollOff;
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
  }, [applyTool]);

  const onMove = useCallback(
    (e: MouseEvent) => {
      if (!drawingRef.current) return;
      const tool = activeTool.value;
      const pos = canvasCoords(e);
      lastPosRef.current = pos;
      shiftHeldRef.current = e.shiftKey;
      // Freehand accumulates points unless Shift is locking the stroke to a
      // straight line from the start.
      if (FREEHAND.has(tool) && !shiftHeldRef.current) currentPathRef.current?.points.push(pos);
      renderPreview();
    },
    [canvasCoords, renderPreview],
  );

  const onUp = useCallback(
    (e: MouseEvent) => {
      if (!drawingRef.current) return;
      drawingRef.current = false;
      isDrawingActive.value = false;
      const tool = activeTool.value;
      shiftHeldRef.current = e.shiftKey;
      const rawPos = canvasCoords(e);
      const sp = startPtRef.current;
      const pos = shiftHeldRef.current ? constrainEnd(tool, sp.x, sp.y, rawPos.x, rawPos.y) : rawPos;
      if (FREEHAND.has(tool) && currentPathRef.current) {
        snapshotRef.current = null;
        if (shiftHeldRef.current) {
          currentPathRef.current.points = [currentPathRef.current.points[0], pos];
        } else {
          currentPathRef.current.points.push(pos);
        }
        if (currentPathRef.current.points.length > 1) {
          if (tool !== 'eraser') currentPathRef.current.points = simplify(currentPathRef.current.points, 1.5);
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

  // Iframe forwards keydown/keyup to host `window`, so a single host-window binding catches
  // Shift events regardless of focus side.
  useEffect(() => {
    const setShift = (next: boolean) => {
      if (shiftHeldRef.current === next) return;
      shiftHeldRef.current = next;
      renderPreview();
    };
    const unbindDown = tinykeys(window, { Shift: () => setShift(true) });
    const unbindUp = tinykeys(window, { Shift: () => setShift(false) }, { event: 'keyup' });
    return () => {
      unbindDown();
      unbindUp();
    };
  }, [renderPreview]);

  // Re-render canvas when operations, scroll, or device mode change
  useSignalEffect(() => {
    operations.value;
    iframeScrollY.value;
    const dev = deviceMode.value;
    renderAll();
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
    let timer: ReturnType<typeof setTimeout>;
    const onResize = () => {
      clearTimeout(timer);
      timer = setTimeout(renderAll, 100);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [renderAll]);

  useEffect(() => {
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [onMove, onUp]);

  // Cursor broadcast
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const pos = canvasCoords(e);
      if (pos.x === 0 && pos.y === 0 && !innerRef.current) return;
      onCursorMove.value?.(pos.x, pos.y, activeTool.value);
    };
    window.addEventListener('mousemove', handler);
    return () => window.removeEventListener('mousemove', handler);
  }, []);

  // Selection tool: capture from parent frame
  const captureSelection = useCallback((sel: Selection | null, fromIframe: boolean) => {
    if (!sel || sel.isCollapsed || !sel.toString().trim()) return;
    const text = sel.toString();
    const rects: import('@ext/lib/types').SelectionRect[] = [];
    const sy = iframeScrollY.value;
    const ir = innerRef.current?.getBoundingClientRect() ?? null;
    const cs = cssScale.value;
    for (let i = 0; i < sel.rangeCount; i++) {
      for (const cr of sel.getRangeAt(i).getClientRects()) {
        if (fromIframe) {
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

  useEffect(() => {
    const onMouseUp = () => {
      if (activeTool.value !== 'selection') return;
      requestAnimationFrame(() => captureSelection(window.getSelection(), false));
    };
    window.addEventListener('mouseup', onMouseUp);
    return () => window.removeEventListener('mouseup', onMouseUp);
  }, [captureSelection]);

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
        /* */
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
  const showCanvas =
    !readonly &&
    isDrawingTool(tool) &&
    tool !== 'comment' &&
    tool !== 'text' &&
    tool !== 'selection' &&
    tool !== 'inspect' &&
    tool !== 'measure' &&
    tool !== 'area' &&
    tool !== 'multiInspect';
  const showTextCursor = !readonly && tool === 'text';
  const showCommentCursor = !readonly && tool === 'comment';
  const comments = commentsComputed.value;

  if (isMobileDevice) {
    return (
      <div
        class="min-h-screen flex flex-col items-center justify-center px-6 font-['Geist',system-ui,sans-serif] text-center"
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

  return (
    <div class={cn('h-screen flex flex-col bg-ml-bg-viewer', glass.font)}>
      {/* Mobile gate */}
      <div class="md:hidden fixed inset-0 z-2147483647 bg-ml-bg flex flex-col items-center justify-center px-8 text-center font-['Geist',system-ui,sans-serif]">
        <Logo size={48} />
        <h2 class="text-[22px] font-bold text-ml-fg mt-6 mb-3 tracking-[-0.02em]">Desktop only</h2>
        <p class="text-[16px] text-ml-fg/40 leading-relaxed max-w-[300px] mb-8">
          MarkLayer's annotation tools are designed for desktop screens. Open this link on your computer.
        </p>
        <a href="/" class="px-5 py-2.5 rounded-xl bg-ml-btn text-ml-btn-fg text-[14px] font-semibold no-underline">
          Back to home
        </a>
      </div>

      {/* Top bar */}
      <div class="flex items-center gap-3 px-4 h-[48px] z-50 shrink-0 bg-[var(--ml-glass-bg)] backdrop-blur-[80px] backdrop-saturate-[1.9] backdrop-brightness-[1.1] shadow-[0_1px_3px_oklch(0_0_0/0.08)]">
        <a
          href="/"
          class="flex items-center gap-2 no-underline shrink-0 group cursor-pointer rounded-lg px-2 py-1 -ml-2 hover:bg-ml-glass-fg/[0.05] transition-colors duration-150"
        >
          <Logo size={24} />
          <span class="text-[14px] font-bold tracking-[-0.02em] text-ml-glass-fg group-hover:text-ml-glass-fg transition-colors">
            MarkLayer
          </span>
        </a>

        <div class={glass.sep} />

        {/* URL — editable, Enter to navigate, click icon to copy */}
        <div class="flex-1 min-w-0 flex items-center gap-2 px-2 rounded-lg py-1 hover:bg-ml-glass-fg/[0.05] transition-colors duration-150">
          <Link
            size={16}
            class="text-ml-glass-fg/55 shrink-0 cursor-pointer hover:text-ml-glass-fg transition-colors"
            aria-label="Copy URL"
            onClick={() => {
              navigator.clipboard.writeText(pageUrl.value).then(
                () => toast('URL copied!', 'success'),
                () => toast('Failed to copy', 'error'),
              );
            }}
          />
          <input
            name="pageUrl"
            type="text"
            defaultValue={pageUrl.value}
            class="flex-1 min-w-0 bg-transparent border-none outline-none text-[13.5px] text-ml-glass-fg/75 focus:text-ml-glass-fg truncate cursor-text"
            title="Edit URL and press Enter to navigate"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                let url = e.currentTarget.value.trim();
                if (!url) return;
                if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
                navigateTo(url);
              }
            }}
            onFocus={(e) => e.currentTarget.select()}
          />
        </div>

        {/* Info panel toggle */}
        <button
          type="button"
          onClick={() => (showInfoPanel.value = !showInfoPanel.value)}
          class={cn(
            'group relative w-9 h-9 rounded-xl grid place-items-center cursor-pointer border-none transition-all duration-150 active:scale-[0.94] shrink-0',
            showInfoPanel.value
              ? 'bg-ml-glass-accent/[0.14] text-ml-glass-fg shadow-[inset_0_0.5px_0_oklch(1_0_0/0.08)]'
              : 'bg-transparent text-ml-glass-fg/65 hover:text-ml-glass-fg hover:bg-ml-glass-accent/[0.08]',
          )}
        >
          <Info size={16} aria-hidden="true" />
          <Tooltip text="Annotation info" placement="bottom" />
        </button>

        <div class={glass.sep} />

        {/* Device viewport picker */}
        <div class="flex items-center gap-0.5 shrink-0">
          {(['desktop', 'tablet', 'mobile'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => (deviceMode.value = mode)}
              class={cn(
                'group relative w-8 h-8 rounded-lg grid place-items-center cursor-pointer border-none transition-all duration-150 active:scale-[0.94]',
                deviceMode.value === mode
                  ? 'bg-ml-glass-accent/[0.14] text-ml-glass-fg shadow-[inset_0_0.5px_0_oklch(1_0_0/0.08)]'
                  : 'bg-transparent text-ml-glass-fg/65 hover:text-ml-glass-fg hover:bg-ml-glass-accent/[0.08]',
              )}
            >
              {mode === 'desktop' && <Monitor size={16} aria-hidden="true" />}
              {mode === 'tablet' && <Tablet size={16} aria-hidden="true" />}
              {mode === 'mobile' && <Smartphone size={16} aria-hidden="true" />}
              <Tooltip text={`${mode.charAt(0).toUpperCase() + mode.slice(1)} viewport`} placement="bottom" />
            </button>
          ))}
        </div>

        <div class={glass.sep} />

        <div class="flex items-center gap-1.5 shrink-0">
          {/* Avatar group */}
          <div class="flex items-center -space-x-2.5 mr-1">
            {/* Local user */}
            <div
              class="w-7 h-7 rounded-full text-white text-[10px] font-bold grid place-items-center shrink-0 ring-2 ring-[var(--ml-glass-bg)] shadow-sm transition-colors duration-150"
              style={{ background: color.value, zIndex: peers.value.size + 1 }}
              title={localUser.name}
            >
              {localUser.name
                .split(' ')
                .map((w) => w[0])
                .join('')
                .slice(0, 2)}
            </div>
            {/* Peer avatars */}
            {Array.from(peers.value.values())
              .slice(0, 3)
              .map((p, i) => (
                <div
                  key={p.id}
                  class="w-7 h-7 rounded-full text-white text-[10px] font-bold grid place-items-center ring-2 ring-[var(--ml-glass-bg)] shadow-sm cursor-pointer"
                  style={{ background: p.color, zIndex: peers.value.size - i }}
                  title={p.name}
                  onClick={() => {
                    if (p.cursor) onFollowScroll.value?.(p.cursor.y);
                  }}
                >
                  {p.name
                    .split(' ')
                    .map((w) => w[0])
                    .join('')
                    .slice(0, 2)}
                </div>
              ))}
            {peers.value.size > 3 && (
              <div class="w-7 h-7 rounded-full bg-ml-glass-fg/10 text-ml-glass-fg/70 text-[10px] font-bold grid place-items-center ring-2 ring-[var(--ml-glass-bg)] tabular-nums">
                +{peers.value.size - 3}
              </div>
            )}
          </div>
          {/* Editable name */}
          <input
            name="displayName"
            type="text"
            defaultValue={localUser.name}
            maxLength={24}
            class="w-[90px] bg-transparent border-none text-[12px] text-ml-glass-fg/85 font-semibold outline-none truncate px-1.5 py-0.5 rounded hover:bg-ml-glass-fg/6 focus:bg-ml-glass-fg/8 focus:text-ml-glass-fg cursor-text"
            title="Click to edit your name"
            onBlur={(e) => {
              setUserName(e.currentTarget.value);
              e.currentTarget.value = localUser.name;
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
          />

          {/* Voice + Video room */}
          {voiceActive.value ? (
            <div class="flex items-center gap-0.5">
              <button
                type="button"
                onClick={() => (voiceMuted.value = !voiceMuted.value)}
                class={cn(
                  'group relative w-9 h-9 rounded-xl grid place-items-center cursor-pointer border-none transition-all duration-150 active:scale-[0.94]',
                  voiceMuted.value
                    ? 'bg-ml-glass-fg/[0.06] text-ml-glass-fg/30'
                    : 'bg-ml-glass-accent/[0.14] text-ml-glass-fg shadow-[inset_0_0.5px_0_oklch(1_0_0/0.08)]',
                )}
              >
                {voiceMuted.value ? <MicOff size={16} aria-hidden="true" /> : <Mic size={16} aria-hidden="true" />}
                <Tooltip text={voiceMuted.value ? 'Unmute' : 'Mute'} placement="bottom" />
              </button>
              <button
                type="button"
                onClick={() => (videoActive.value = !videoActive.value)}
                class={cn(
                  'group relative w-9 h-9 rounded-xl grid place-items-center cursor-pointer border-none transition-all duration-150 active:scale-[0.94]',
                  videoActive.value
                    ? 'bg-ml-glass-accent/[0.14] text-ml-glass-fg shadow-[inset_0_0.5px_0_oklch(1_0_0/0.08)]'
                    : 'bg-transparent text-ml-glass-fg/65 hover:text-ml-glass-fg hover:bg-ml-glass-accent/[0.08]',
                )}
              >
                {videoActive.value ? <Video size={16} aria-hidden="true" /> : <VideoOff size={16} aria-hidden="true" />}
                <Tooltip text={videoActive.value ? 'Turn off camera' : 'Turn on camera'} placement="bottom" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => (voiceActive.value = true)}
              class="group relative w-9 h-9 rounded-xl grid place-items-center cursor-pointer border-none transition-all duration-150 active:scale-[0.94] bg-transparent text-ml-glass-fg/65 hover:text-ml-glass-fg hover:bg-ml-glass-accent/[0.08]"
            >
              <Mic size={16} aria-hidden="true" />
              <Tooltip text="Join voice" placement="bottom" />
            </button>
          )}

          {/* Connection indicator */}
          <div class="flex items-center gap-1.5 mr-0.5">
            <span
              class={cn(
                'w-2 h-2 rounded-full shrink-0',
                connected.value ? 'bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.5)]' : 'bg-ml-glass-accent/20',
              )}
            />
            <span class="text-ml-glass-fg/75 text-[12px] font-medium tabular-nums">
              {connected.value ? `${peerCount.value} online` : 'offline'}
            </span>
          </div>

          {/* Annotations panel toggle */}
          <button
            type="button"
            onClick={() => (showAnnotationPanel.value = !showAnnotationPanel.value)}
            class={cn(
              'group relative w-9 h-9 rounded-xl grid place-items-center cursor-pointer border-none transition-all duration-150 active:scale-[0.94]',
              showAnnotationPanel.value
                ? 'bg-ml-glass-accent/[0.14] text-ml-glass-fg shadow-[inset_0_0.5px_0_oklch(1_0_0/0.08)]'
                : 'bg-transparent text-ml-glass-fg/65 hover:text-ml-glass-fg hover:bg-ml-glass-accent/[0.1]',
            )}
          >
            <MessageSquare size={16} aria-hidden="true" />
            <Tooltip text="Annotations panel" placement="bottom" />
          </button>

          {/* Share session */}
          {!readonly && (
            <button
              type="button"
              onClick={() => doShare()}
              disabled={sharing.value}
              class={cn(
                'group relative w-9 h-9 rounded-xl grid place-items-center cursor-pointer border-none transition-all duration-150 active:scale-[0.94] bg-transparent text-ml-glass-fg/65 hover:text-ml-glass-fg hover:bg-ml-glass-accent/[0.1]',
                sharing.value && 'opacity-50 pointer-events-none',
              )}
            >
              <Upload size={16} aria-hidden="true" />
              <Tooltip text="Copy editable link" placement="bottom" />
            </button>
          )}

          {/* Theme toggle */}
          <button
            type="button"
            onClick={(e) => {
              cycleTheme();
              e.currentTarget.blur();
            }}
            class="group relative w-9 h-9 rounded-xl grid place-items-center cursor-pointer border-none transition-all duration-150 active:scale-[0.94] bg-transparent text-ml-glass-fg/65 hover:text-ml-glass-fg hover:bg-ml-glass-accent/[0.1]"
          >
            {theme.value === 'dark' ? <Moon size={16} aria-hidden="true" /> : <Sun size={16} aria-hidden="true" />}
            <Tooltip
              text={`Theme: ${theme.value === 'system' ? 'System' : theme.value === 'dark' ? 'Dark' : 'Light'}`}
              placement="bottom"
            />
          </button>
        </div>
      </div>

      {/* Project page tabs (only rendered when /p/:id) */}
      <ProjectTabs />

      {/* Viewer */}
      <div
        class={cn(
          'flex-1 relative overflow-hidden',
          deviceMode.value !== 'desktop' && 'flex items-stretch justify-center bg-ml-bg-device',
        )}
      >
        <div
          id="viewer"
          ref={viewerRef}
          class={cn(
            'relative h-full',
            deviceMode.value === 'desktop'
              ? 'w-full overflow-hidden'
              : 'shadow-[0_0_0_1px_rgba(0,0,0,0.08),0_8px_40px_rgba(0,0,0,0.12)] bg-white',
          )}
          style={
            deviceMode.value !== 'desktop' ? { width: DEVICE_WIDTHS[deviceMode.value], maxWidth: '100%' } : undefined
          }
        >
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
            {renderFailed.value && pageUrl.value ? (
              <div class="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-white px-8 text-center">
                <Logo size={48} />
                <h2 class="text-base font-semibold text-zinc-800 m-0">
                  {isLikelyEmbedHostile(pageUrl.value) ? 'This site blocks embedding' : "We couldn't load this page"}
                </h2>
                <p class="text-sm text-zinc-500 max-w-md leading-snug m-0">
                  {isLikelyEmbedHostile(pageUrl.value)
                    ? 'Sites like YouTube, TikTok, Instagram, and X refuse to load inside other pages. The annotations are saved — install the MarkLayer extension to view them on the live site.'
                    : 'The page took too long, was blocked, or returned an error. The annotations are saved — try the extension on the live page, or share a different URL.'}
                </p>
                <div class="flex items-center gap-2">
                  <a
                    href={pageUrl.value}
                    target="_blank"
                    rel="noreferrer"
                    class="px-4 py-2 rounded-lg bg-zinc-900 text-white text-[13px] font-medium hover:bg-zinc-800"
                  >
                    Open original site
                  </a>
                  <a
                    href="/"
                    class="px-4 py-2 rounded-lg border border-zinc-200 text-zinc-700 text-[13px] font-medium hover:bg-zinc-50"
                  >
                    Back home
                  </a>
                </div>
              </div>
            ) : (
              !iframeLoaded.value &&
              pageUrl.value && (
                <div class="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-white">
                  <Logo size={48} />
                  <Loader2 size={32} class="animate-spin text-violet-500" aria-hidden="true" />
                  <p class="text-sm text-zinc-400">Loading page…</p>
                </div>
              )
            )}
            <iframe
              ref={frameRef}
              title="Annotated page"
              src={pageUrl.value ? `/proxy?url=${encodeURIComponent(pageUrl.value)}` : undefined}
              sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
              onLoad={() => {
                iframeLoaded.value = true;
                if (!pageUrl.value) return;
                // Proxy injects data-marklayer="1" on success; missing marker means an error response was served.
                const doc = frameRef.current?.contentDocument;
                if (doc?.documentElement?.dataset?.marklayer === '1') return;
                captureRenderFailed('no-marker', { body_preview: doc?.body?.textContent?.slice(0, 200) });
                renderFailed.value = 'no-marker';
              }}
              onError={() => {
                captureRenderFailed('iframe-error');
                renderFailed.value = 'iframe-error';
              }}
              class={cn(
                'w-full h-full border-none bg-white',
                !iframeLoaded.value && 'invisible',
                (showCanvas || showCommentCursor || showTextCursor) && 'pointer-events-none',
              )}
            />

            <canvas
              ref={canvasRef}
              onMouseDown={onDown}
              class="absolute inset-0"
              style={{ pointerEvents: showCanvas ? 'auto' : 'none', cursor: showCanvas ? 'crosshair' : 'default' }}
            />

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
                <WebCommentPin
                  key={c.id}
                  op={c}
                  scale={1}
                  scrollY={iframeScrollY.value}
                  frameDoc={frameRef.current?.contentDocument}
                />
              ))}
            </div>

            <div class="absolute inset-0 pointer-events-none overflow-hidden">
              {selections.value.filter(opMatchesDevice).map((op) => (
                <WebSelectionHighlight
                  key={op.id}
                  op={op}
                  scale={1}
                  scrollY={iframeScrollY.value}
                  frameDoc={frameRef.current?.contentDocument}
                />
              ))}
            </div>

            <div class="absolute inset-0 pointer-events-none overflow-hidden">
              {areas.value.filter(opMatchesDevice).map((op) => (
                <WebAreaShape
                  key={op.id}
                  op={op}
                  scale={1}
                  scrollY={iframeScrollY.value}
                  frameDoc={frameRef.current?.contentDocument}
                />
              ))}
            </div>

            <div
              class="absolute inset-0"
              style={{ pointerEvents: showTextCursor ? 'auto' : 'none', cursor: showTextCursor ? 'text' : 'default' }}
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
                    const frameWin = frameRef.current?.contentWindow;
                    const op: TextOp = {
                      id: nanoid(),
                      tool: 'text',
                      text,
                      x: textInput.value.x,
                      y: textInput.value.y,
                      fontSize: Math.max(14, lineWidth.value * 6),
                      color: color.value,
                      lineWidth: lineWidth.value,
                      captureViewport: frameWin
                        ? { width: frameWin.innerWidth, height: frameWin.innerHeight }
                        : { width: window.innerWidth, height: window.innerHeight },
                    };
                    pushDeviceOp(op);
                  }
                  textInput.value = null;
                }}
              />
            )}

            {!readonly && <WebInspectorLayer frameRef={frameRef} />}
            {!readonly && <WebMeasureLayer frameRef={frameRef} />}
            {!readonly && <WebAreaLayer frameRef={frameRef} />}
            {!readonly && <WebMultiInspectLayer frameRef={frameRef} />}
            <CursorLayer scale={1} scrollY={iframeScrollY.value} />
          </div>

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

          {selectionPopover.value && (
            <WebSelectionPopover
              {...selectionPopover.value}
              onClose={() => {
                selectionPopover.value = null;
              }}
            />
          )}

          {deviceMode.value === 'desktop' && (
            <AnnotationPanel onScrollTo={scrollToAnnotation} getExportData={buildExportData} />
          )}
          {deviceMode.value === 'desktop' && <InfoPanel />}
        </div>

        {deviceMode.value !== 'desktop' && (
          <DockedAnnotationPanel onScrollTo={scrollToAnnotation} getExportData={buildExportData} />
        )}
      </div>

      {!readonly && <Toolbar />}
      <ContextMenu />

      {readonly && (
        <div
          class={cn(
            'fixed bottom-5 left-1/2 -translate-x-1/2 z-2147483646 px-4 py-2.5 flex items-center gap-3',
            glass.surfaceSmall,
            glass.font,
          )}
        >
          <Lock size={14} class="text-ml-glass-fg/40" aria-hidden="true" />
          <span class="text-[12px] text-ml-glass-fg/50 font-medium">View-only mode</span>
        </div>
      )}

      {/* Raycast-style mic indicator */}
      {voiceActive.value && <VoicePill />}

      {/* Draggable self-view video bubble */}
      {localVideoStream.value && videoActive.value && <SelfVideoBubble stream={localVideoStream.value} />}

      {/* Follow mode indicator */}
      {followingPeer.value &&
        (() => {
          const peer = peers.value.get(followingPeer.value!);
          if (!peer) return null;
          return (
            <div
              class={`fixed top-3 left-1/2 -translate-x-1/2 z-2147483646 flex items-center gap-2 px-3 py-2 ${glass.surfaceSmall} ${glass.font} animate-[fadeInDown_0.2s_ease-out]`}
            >
              <span class="w-2 h-2 rounded-full shrink-0 animate-pulse" style={{ background: peer.color }} />
              <span class="text-xs font-medium text-ml-glass-fg/70">Following {peer.name}</span>
              <button
                type="button"
                class="ml-1 text-ml-glass-fg/40 hover:text-ml-glass-fg/70 transition-colors"
                onClick={() => {
                  followingPeer.value = null;
                }}
              >
                <X size={14} />
              </button>
            </div>
          );
        })()}

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
  );
}

function VoicePill() {
  const muted = voiceMuted.value;
  const level = voiceLevel.value;

  return (
    <div
      class={cn(
        'fixed top-[60px] z-2147483646 flex items-center gap-2 px-3 py-2 rounded-xl transition-[right] duration-200',
        showAnnotationPanel.value ? 'right-[364px]' : 'right-4',
        'bg-[var(--ml-glass-bg)] backdrop-blur-[80px] backdrop-saturate-[1.9] border border-ml-glass-fg/[0.06] shadow-[0_2px_10px_oklch(0_0_0/0.08)]',
        'animate-[fadeInDown_0.2s_ease-out]',
        'select-none',
      )}
    >
      <button
        type="button"
        onClick={() => (voiceMuted.value = !voiceMuted.value)}
        class={cn(
          'w-7 h-7 rounded-lg grid place-items-center border-none cursor-pointer transition-all duration-150 active:scale-[0.94]',
          muted ? 'bg-ml-glass-fg/[0.06] text-ml-glass-fg/30' : 'bg-green-500/20 text-green-400',
        )}
        title={muted ? 'Unmute' : 'Mute'}
      >
        {muted ? <MicOff size={14} aria-hidden="true" /> : <Mic size={14} aria-hidden="true" />}
      </button>

      {/* Level bars */}
      <div class="flex items-end gap-[2px] h-3.5">
        {Array.from({ length: 4 }, (_, i) => {
          const threshold = i / 4;
          const active = !muted && level > threshold;
          return (
            <div
              key={i}
              class="w-[2.5px] rounded-full transition-all duration-100 ease-out"
              style={{
                height: `${40 + ((i + 1) / 4) * 60}%`,
                background: 'var(--color-ml-glass-fg, #888)',
                opacity: active ? 0.5 : 0.1,
                transform: active ? `scaleY(${0.7 + level * 0.3})` : 'scaleY(0.5)',
              }}
            />
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => (voiceActive.value = false)}
        class="w-6 h-6 rounded-md grid place-items-center border-none cursor-pointer bg-transparent text-ml-glass-fg/20 hover:text-ml-glass-fg/50 hover:bg-ml-glass-fg/[0.06] transition-all duration-150 active:scale-[0.94]"
        title="Leave voice"
      >
        <X size={11} aria-hidden="true" />
      </button>
    </div>
  );
}

function SelfVideoBubble({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLVideoElement>(null);
  const dragRef = useRef<HTMLDivElement>(null);
  const posRef = useRef({ x: 0, y: 0 });
  const sizeRef = useRef(64);
  const draggingRef = useRef(false);
  const offsetRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);

  // Initialize position: bottom-right corner
  useEffect(() => {
    const s = sizeRef.current;
    posRef.current = { x: window.innerWidth - s - 16, y: window.innerHeight - s - 16 };
    if (dragRef.current) {
      dragRef.current.style.transform = `translate(${posRef.current.x}px,${posRef.current.y}px)`;
    }
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current || !dragRef.current) return;
      const s = sizeRef.current;
      const x = Math.max(0, Math.min(window.innerWidth - s, e.clientX - offsetRef.current.x));
      const y = Math.max(48, Math.min(window.innerHeight - s, e.clientY - offsetRef.current.y));
      posRef.current = { x, y };
      dragRef.current.style.transform = `translate(${x}px,${y}px)`;
    };
    const onUp = () => {
      draggingRef.current = false;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  const initX = window.innerWidth - 80;
  const initY = window.innerHeight - 80;

  return (
    <div
      ref={dragRef}
      class="fixed top-0 left-0 z-2147483646 cursor-grab active:cursor-grabbing select-none will-change-transform animate-[fadeInDown_0.2s_ease-out]"
      style={{ transform: `translate(${initX}px,${initY}px)` }}
      onMouseDown={(e) => {
        draggingRef.current = true;
        offsetRef.current = { x: e.clientX - posRef.current.x, y: e.clientY - posRef.current.y };
        e.preventDefault();
      }}
      onWheel={(e) => {
        e.preventDefault();
        const el = dragRef.current;
        const vid = ref.current;
        if (!el || !vid) return;
        const prev = sizeRef.current;
        const next = Math.max(48, Math.min(200, prev - Math.sign(e.deltaY) * 16));
        if (next === prev) return;
        sizeRef.current = next;
        vid.style.width = `${next}px`;
        vid.style.height = `${next}px`;
        const dx = (next - prev) / 2;
        posRef.current.x -= dx;
        posRef.current.y -= dx;
        el.style.transform = `translate(${posRef.current.x}px,${posRef.current.y}px)`;
      }}
    >
      <video
        ref={ref}
        autoPlay
        playsInline
        muted
        class="rounded-full object-cover shadow-lg ring-2 ring-white/20"
        style={{ width: 64, height: 64, transform: 'scaleX(-1)' }}
      />
    </div>
  );
}
