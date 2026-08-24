import { ContextMenu } from '@ext/components/ContextMenu';
import { Toolbar } from '@ext/components/Toolbar';
import { Tooltip } from '@ext/components/Tooltip';
import { captureScale } from '@ext/lib/anchor';
import { animationsFrozen, freezeDocument, thawDocument } from '@ext/lib/freeze';
import { glass } from '@ext/lib/glass';
import { constrainEnd, hexToRgba, inView, opBounds, renderOp, simplify } from '@ext/lib/renderer';
import { captureTarget } from '@ext/lib/selector';
import { claudeMcpCommand, HOW_IT_WORKS_URL, isLikelyEmbedHostile, npxMcpCommand } from '@ext/lib/share';
import {
  activeTool,
  areas,
  color,
  comments as commentsComputed,
  copyText,
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
import { useCopyToClipboard } from '@ext/lib/useCopy';
import { cn, RETENTION_DAYS } from '@marklayer/types';
import { useSignal, useSignalEffect } from '@preact/signals';
import {
  Bot,
  Calendar,
  Check,
  ChevronDown,
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
import { lazy, Suspense } from 'preact/compat';
import { useCallback, useEffect, useRef } from 'preact/hooks';
import { tinykeys } from 'tinykeys';
import { classifyProxyError } from '../src/proxy-errors';
import {
  AnnotationPanel,
  DOCK_GUTTER,
  DOCKED_ANNOTATION_WIDTH,
  DockedAnnotationPanel,
  DockedPanel,
  PANEL_BASE,
  PANEL_TRANSITION,
} from './AnnotationPanel';
import { capture } from './analytics';
import { CursorLayer } from './CursorLayer';
import { frameViewport, isElementNode, pickFrameTarget } from './iframeOverlay';
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
  MAX_AUTO_UPSCALE,
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
  stepZoom,
  textInput,
  timeAgo,
  type ViewerZoom,
  viewerZoom,
  ZOOM_PRESETS,
} from './signals';
import {
  connected,
  createdAt,
  emitRipple,
  expiresAt,
  localPeerId,
  serverUrl,
  serverWidth,
  useRealtimeSync,
} from './useRealtimeSync';
import {
  audioBlocked,
  expandedPeers,
  localVideoStream,
  peerConnQuality,
  peerVideoStreams,
  qualityRing,
  resumeBlockedAudio,
  videoActive,
  voiceActive,
  voiceLevel,
  voiceMuted,
  voiceSpeaking,
} from './voiceSignals';
import { WebAreaLayer } from './WebAreaLayer';
import { WebAreaShape } from './WebAreaShape';
import { WebCommentPin } from './WebCommentPin';
import { WebCommentPopover } from './WebCommentPopover';
import { WebGuideLayer } from './WebGuideLayer';
import { WebInspectorLayer } from './WebInspectorLayer';
import { WebMeasureLayer } from './WebMeasureLayer';
import { WebMultiInspectLayer } from './WebMultiInspectLayer';
import { WebSelectionHighlight } from './WebSelectionHighlight';
import { WebSelectionPopover } from './WebSelectionPopover';

// WebRTC engine + voice UI live in their own chunks — only fetched when a user
// joins voice/video or opens the device picker.
const VoiceEngine = lazy(() => import('./VoiceEngine'));
const DeviceMenu = lazy(() => import('./DeviceMenu').then((m) => ({ default: m.DeviceMenu })));
const MediaBubble = lazy(() => import('./MediaBubble').then((m) => ({ default: m.MediaBubble })));

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

function zoomLabel(z: ViewerZoom): string {
  if (z === 'auto') return 'Auto';
  return `${Math.round(z * 100)}%`;
}

function InfoRow({ icon: Icon, label, value }: { icon: typeof Info; label: string; value: string }) {
  return (
    <div class="flex items-start gap-3 py-2">
      <Icon size={14} class="text-ml-glass-fg/60 shrink-0 mt-0.5" aria-hidden="true" />
      <div class="flex-1 min-w-0">
        <div class="text-[10px] text-ml-glass-fg/60 font-medium uppercase tracking-wider">{label}</div>
        <div class="text-[12.5px] text-ml-glass-fg/70 mt-0.5 break-all">{value}</div>
      </div>
    </div>
  );
}

/**
 * Click-to-copy command line. Mirrors the ID row's interaction (the whole value
 * is the control, copy glyph trailing) so the panel teaches one copy gesture
 * rather than two. The command wraps instead of truncating — a half-shown
 * command reads as broken and can't be verified before it's pasted.
 */
function CommandField({ label, value }: { label: string; value: string }) {
  const { copied, copy } = useCopyToClipboard();
  return (
    <button
      type="button"
      onClick={() => copy(value)}
      title="Click to copy"
      aria-label={`Copy ${label}`}
      class="w-full flex items-start gap-1.5 text-left px-2 py-1.5 rounded-lg cursor-pointer
             bg-ml-glass-fg/[0.04] border border-ml-glass-fg/[0.08] text-ml-glass-fg/75
             hover:text-ml-glass-fg hover:bg-ml-glass-fg/[0.07] transition-colors duration-150"
    >
      {/* Wrap at spaces, never mid-token: `break-all` split "npx" across lines,
          which makes the command unreadable and unverifiable before pasting. */}
      <code class="flex-1 min-w-0 font-mono text-[11px] leading-normal whitespace-pre-wrap wrap-break-word">
        {value}
      </code>
      {/* mt centers the 11px glyph on the 16.5px first line box, not on the block */}
      {/* Opacity here multiplies the parent's muted colour, so it has to stay
          high: at 0.4 over a /60 parent the copy affordance landed near 1.8:1. */}
      {copied.value ? (
        <Check size={11} class="shrink-0 mt-0.75" aria-hidden="true" />
      ) : (
        <Copy size={11} class="shrink-0 mt-0.75 opacity-80" aria-hidden="true" />
      )}
    </button>
  );
}

function InfoPanelBody() {
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
    <>
      <div class="px-4 py-3 border-b border-ml-glass-fg/[0.1] shrink-0 flex items-center justify-between">
        <h2 class="text-[13px] font-semibold text-ml-glass-fg/80 m-0">Annotation Info</h2>
        <button
          type="button"
          onClick={() => (showInfoPanel.value = false)}
          class="w-7 h-7 rounded-xl grid place-items-center cursor-pointer bg-transparent border-none text-ml-glass-fg/65 hover:text-ml-glass-fg hover:bg-ml-glass-accent/[0.1] active:scale-[0.96] transition-[color,background-color,scale] duration-150"
        >
          <X size={14} aria-hidden="true" />
        </button>
      </div>
      {/* pb clears the floating toolbar that overlaps the panel's bottom-right,
          so the last rows can always be scrolled out from under it. */}
      <div class="flex-1 overflow-y-auto px-4 pt-2 pb-16">
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
              ? `${RETENTION_DAYS} days after last view`
              : expires * 1000 < Date.now()
                ? 'Expired'
                : `${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(expires * 1000)} (${timeAgo(expires)})`
          }
        />
        <div class="flex items-start gap-3 py-2">
          <Users size={14} class="text-ml-glass-fg/60 shrink-0 mt-0.5" aria-hidden="true" />
          <div class="flex-1 min-w-0">
            <div class="text-[10px] text-ml-glass-fg/60 font-medium uppercase tracking-wider">Session</div>
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
            <Link size={14} class="text-ml-glass-fg/60 shrink-0 mt-0.5" aria-hidden="true" />
            <div class="flex-1 min-w-0">
              <div class="text-[10px] text-ml-glass-fg/60 font-medium uppercase tracking-wider">Page URL</div>
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                class="text-[12.5px] text-ml-glass-fg/60 hover:text-ml-glass-fg/80 mt-0.5 break-all no-underline hover:underline block transition-colors"
              >
                {url}
              </a>
            </div>
          </div>
        )}
        {id && (
          <div class="flex items-start gap-3 py-2">
            <Hash size={14} class="text-ml-glass-fg/60 shrink-0 mt-0.5" aria-hidden="true" />
            <div class="flex-1 min-w-0">
              <div class="text-[10px] text-ml-glass-fg/60 font-medium uppercase tracking-wider">ID</div>
              <button
                type="button"
                class="flex items-center gap-1.5 text-[12.5px] text-ml-glass-fg/60 hover:text-ml-glass-fg/80 mt-0.5 bg-transparent border-none cursor-pointer p-0 font-mono transition-colors"
                onClick={() => copyText(id, 'ID copied!')}
                title="Click to copy"
              >
                {id}
                <Copy size={11} class="shrink-0 opacity-80" aria-hidden="true" />
              </button>
            </div>
          </div>
        )}
        {/* Connect an agent — the room ID above is what the MCP server joins, so
            the command belongs directly under it. Shown wherever a room exists;
            read-only is a viewer-side flag and does not stop an agent writing. */}
        {id && (
          <>
            <div class="h-px bg-ml-glass-fg/[0.06] my-2" />
            <div>
              <div class="flex items-center gap-2 mb-2">
                <Bot size={14} class="text-ml-glass-fg/60" aria-hidden="true" />
                <span class="text-[10px] text-ml-glass-fg/60 font-medium uppercase tracking-wider">
                  Connect an AI agent
                </span>
              </div>
              <div class="pl-[26px] flex flex-col gap-1.5">
                <p class="text-[11.5px] text-ml-glass-fg/60 leading-snug m-0">
                  An agent can work these annotations and resolve them here, live. Run once in your project:
                </p>
                <CommandField label="Claude Code command" value={claudeMcpCommand(id)} />
                <details class="text-[11px] text-ml-glass-fg/60">
                  <summary class="cursor-pointer select-none hover:text-ml-glass-fg/70 transition-colors duration-150">
                    Cursor, Codex, Windsurf…
                  </summary>
                  <div class="mt-1.5 flex flex-col gap-1.5">
                    <CommandField label="npx command" value={npxMcpCommand(id)} />
                    <p class="text-[10.5px] text-ml-glass-fg/60 leading-snug m-0">
                      Paste into your MCP config under a "marklayer" entry.
                    </p>
                  </div>
                </details>
              </div>
            </div>
          </>
        )}
        {ops.length > 0 && <div class="h-px bg-ml-glass-fg/[0.06] my-2" />}
        {ops.length > 0 && (
          <div>
            <div class="flex items-center gap-2 mb-2">
              <PenTool size={14} class="text-ml-glass-fg/60" aria-hidden="true" />
              <span class="text-[10px] text-ml-glass-fg/60 font-medium uppercase tracking-wider">
                Annotations ({ops.length})
              </span>
            </div>
            <div class="grid grid-cols-2 gap-x-4 gap-y-1 pl-[26px]">
              {Array.from(toolCounts.entries())
                .sort((a, b) => b[1] - a[1])
                .map(([tool, count]) => (
                  <div key={tool} class="flex items-center justify-between">
                    <span class="text-[11.5px] text-ml-glass-fg/60">{TOOL_LABELS[tool] || tool}</span>
                    <span class="text-[11.5px] text-ml-glass-fg/60 tabular-nums">{count}</span>
                  </div>
                ))}
            </div>
          </div>
        )}
        <div class="h-px bg-ml-glass-fg/[0.06] my-2" />
        <a
          href={HOW_IT_WORKS_URL}
          target="_blank"
          rel="noopener"
          class="block text-[11.5px] text-ml-glass-fg/60 hover:text-ml-glass-fg/80 no-underline hover:underline transition-colors"
        >
          How MarkLayer works
        </a>
      </div>
    </>
  );
}

const INFO_PANEL_WIDTH = 300;
/** Narrowest space auto-fit will size a device frame into before letting it overflow and scroll. */
const MIN_DEVICE_FIT_WIDTH = 320;

function InfoPanel() {
  return (
    <div
      class={cn(
        'absolute top-3 left-3 bottom-3 z-40',
        PANEL_TRANSITION,
        PANEL_BASE,
        showInfoPanel.value ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-4 pointer-events-none',
      )}
      style={{ width: INFO_PANEL_WIDTH }}
    >
      <InfoPanelBody />
    </div>
  );
}

// In a device viewport the frame is only 390–768px wide, so an overlaid panel
// would bury the page being reviewed. Dock it beside the frame instead, the way
// DockedAnnotationPanel does on the other side.
function DockedInfoPanel() {
  return (
    <DockedPanel visible={showInfoPanel.value} width={INFO_PANEL_WIDTH}>
      <InfoPanelBody />
    </DockedPanel>
  );
}

/** Horizontal space the open docked panels take from a device frame. */
function dockedPanelsWidth(): number {
  return (
    (showInfoPanel.value ? INFO_PANEL_WIDTH + DOCK_GUTTER : 0) +
    (showAnnotationPanel.value ? DOCKED_ANNOTATION_WIDTH + DOCK_GUTTER : 0)
  );
}

// Avatar-group hover spring (mirrors the easings/duration in style.css .ml-avatar).
// Lift is negative so the avatar rises; falloff dampens the lift on each neighbour.
const AVATAR_LIFT = -2;
const AVATAR_SCALE = 1.03;
const AVATAR_FALLOFF = 0.35;
// Peers shown before collapsing the rest into a "+N" badge. The local user sits
// at index 0, so the overflow badge lands at MAX_VISIBLE_PEERS + 1 in the group.
const MAX_VISIBLE_PEERS = 3;

export default function Viewer() {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const iframeLoaded = useSignal(false);
  const renderFailed = useSignal<null | 'timeout' | 'no-marker' | 'iframe-error'>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const zoomMenuOpen = useSignal(false);
  const zoomRef = useRef<HTMLDivElement>(null);
  const drawingRef = useRef(false);
  const startPtRef = useRef<Point>({ x: 0, y: 0 });
  const currentPathRef = useRef<FreehandOp | null>(null);
  const snapshotRef = useRef<ImageData | null>(null);
  const shiftHeldRef = useRef(false);
  const lastPosRef = useRef<Point | null>(null);
  const avatarGroupRef = useRef<HTMLDivElement>(null);

  // Dock-style spring for the peer avatar group: hovering an avatar lifts it (with
  // a slight scale) and ripples a diminishing lift across its neighbours. Writes
  // per-item CSS vars inline; the .ml-avatar class owns the transform + transition.
  const springAvatars = useCallback((activeIdx: number) => {
    const group = avatarGroupRef.current;
    if (!group) return;
    const items = Array.from(group.children);
    for (const [i, el] of items.entries()) {
      if (!(el instanceof HTMLElement)) continue;
      el.style.transitionTimingFunction = 'var(--ml-avatar-ease-in)';
      const shift = AVATAR_LIFT * AVATAR_FALLOFF ** Math.abs(i - activeIdx);
      el.style.setProperty('--shift', `${shift.toFixed(3)}px`);
      el.style.setProperty('--scale-active', i === activeIdx ? `${AVATAR_SCALE}` : '1');
    }
  }, []);

  const resetAvatars = useCallback(() => {
    const group = avatarGroupRef.current;
    if (!group) return;
    for (const el of Array.from(group.children)) {
      if (!(el instanceof HTMLElement)) continue;
      el.style.transitionTimingFunction = 'var(--ml-avatar-ease-out)';
      el.style.setProperty('--shift', '0px');
      el.style.setProperty('--scale-active', '1');
    }
  }, []);

  const scrollToAnnotation = useCallback((_x: number, y: number) => {
    try {
      const win = frameRef.current?.contentWindow;
      if (win) win.scrollTo({ top: Math.max(0, y - 200), behavior: 'smooth' });
    } catch {
      /* cross-origin */
    }
  }, []);

  useRealtimeSync(annotationId.value);
  const voiceMounted = voiceActive.value || videoActive.value;

  // Close zoom menu when clicking outside.
  // Re-runs when iframeLoaded flips so we also catch clicks inside the iframe document,
  // which don't bubble to the host document.
  useSignalEffect(() => {
    if (!zoomMenuOpen.value) return;
    iframeLoaded.value; // subscribe so we reattach after iframe (re)loads
    const onDown = (e: MouseEvent) => {
      const t = e.target;
      if (!(t instanceof Node) || !zoomRef.current?.contains(t)) zoomMenuOpen.value = false;
    };
    document.addEventListener('mousedown', onDown);
    const iframeWin = frameRef.current?.contentWindow;
    let iframeAttached: Window | null = null;
    try {
      iframeWin?.addEventListener('mousedown', onDown);
      iframeAttached = iframeWin ?? null;
    } catch {
      /* cross-origin iframe — host listener still works for toolbar clicks */
    }
    return () => {
      document.removeEventListener('mousedown', onDown);
      try {
        iframeAttached?.removeEventListener('mousedown', onDown);
      } catch {
        /* ignore */
      }
    };
  });

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
    capture('page_render_failed', {
      // Deliberately no `url` and no `annotation_id`: the annotated page can be
      // private and the room ID is an unlisted share credential. `reason` plus
      // timing is enough to spot a proxy regression.
      reason,
      duration_ms: Math.round(performance.now() - renderStartRef.current),
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
        // Break follow mode on user interaction in iframe + ripple on click
        win.addEventListener('mousedown', (e) => {
          if (followingPeer.value) followingPeer.value = null;
          if (e.button !== 0) return;
          emitRipple.value?.(e.clientX, e.clientY + (win.scrollY || 0));
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
    const zoomKey = (fn: () => void) => (e: KeyboardEvent) => {
      if (isEditable(e.target)) return;
      e.preventDefault();
      fn();
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
      // Zoom shortcuts bypass `guard` so they work in readonly (view-only operation).
      '$mod+Equal': zoomKey(() => stepZoom(1)),
      '$mod+Minus': zoomKey(() => stepZoom(-1)),
      '$mod+Digit0': zoomKey(() => {
        viewerZoom.value = 'auto';
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
    // Fit against the scroll container, never #viewer itself — #viewer's width
    // is `originalWidth * cssScale`, so measuring it turns auto-fit into a
    // one-way ratchet (shrinks once, never recovers when the window widens).
    const containerW = viewer?.parentElement ? viewer.parentElement.clientWidth : window.innerWidth;
    const viewerH = viewer ? viewer.clientHeight : window.innerHeight;
    const dev = deviceMode.value;
    // In a device viewport the panels dock as flex siblings and take real width
    // from the frame, so auto-fit has to size against what is left — measuring
    // the container alone scales the frame under whichever panel is open. The
    // floor keeps a narrow window from fitting the frame down to a sliver; past
    // it the frame keeps its size and the row scrolls.
    const availW = dev === 'desktop' ? containerW : Math.max(MIN_DEVICE_FIT_WIDTH, containerW - dockedPanelsWidth());
    const refW = dev === 'desktop' ? originalWidth.value || availW : DEVICE_WIDTHS[dev];
    const z = viewerZoom.value;
    const cs = !refW || !availW ? 1 : z === 'auto' ? Math.min(MAX_AUTO_UPSCALE, availW / refW) : z;
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

  // Click ripple — only fires for left-button clicks landing on the page area
  // (canvas/iframe wrapper), not on toolbars or panels.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const inner = innerRef.current;
      if (!inner || !(e.target instanceof Node) || !inner.contains(e.target)) return;
      const pos = canvasCoords(e);
      emitRipple.value?.(pos.x, pos.y);
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [canvasCoords]);

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
    // Snapshot the enclosing element now — once the popover textarea takes focus
    // the selection collapses and this context is gone.
    const ancestor = sel.getRangeAt(0).commonAncestorContainer;
    const el = isElementNode(ancestor) ? ancestor : ancestor.parentElement;
    const first = rects[0];
    selectionPopover.value = {
      text,
      rects,
      screenX: fromIframe && ir ? last.right * cs + ir.left : last.right,
      screenY: fromIframe && ir ? last.bottom * cs + ir.top : last.bottom,
      target: el && first ? captureTarget(el, { x: first.x, y: first.y }) : undefined,
      captureViewport: frameViewport(frameRef.current),
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
    tool !== 'guide' &&
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
        <p class="text-[15px] text-ml-fg/60 max-w-[320px] leading-relaxed mb-8">
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
    <div class={cn('h-screen overflow-hidden flex flex-col bg-ml-bg-device', glass.font)}>
      {voiceMounted && (
        <Suspense fallback={null}>
          <VoiceEngine localPeerId={localPeerId} />
        </Suspense>
      )}
      {/* Mobile gate */}
      <div class="md:hidden fixed inset-0 z-2147483647 bg-ml-bg flex flex-col items-center justify-center px-8 text-center font-['Geist',system-ui,sans-serif]">
        <Logo size={48} />
        <h2 class="text-[22px] font-bold text-ml-fg mt-6 mb-3 tracking-[-0.02em]">Desktop only</h2>
        <p class="text-[16px] text-ml-fg/60 leading-relaxed max-w-[300px] mb-8">
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
          class="flex items-center gap-1 no-underline shrink-0 group cursor-pointer rounded-lg px-2 py-1 -ml-2 hover:bg-ml-glass-fg/[0.05] transition-colors duration-150"
        >
          <Logo size={24} />
          <span class="text-[14px] font-semibold text-ml-glass-fg">MarkLayer</span>
        </a>

        <div class={glass.sep} />

        {/* URL — editable, Enter to navigate, click icon to copy */}
        <div class="flex-1 min-w-0 flex items-center gap-2 px-2 rounded-lg py-1 hover:bg-ml-glass-fg/[0.05] transition-colors duration-150">
          <Link
            size={16}
            class="text-ml-glass-fg/60 shrink-0 cursor-pointer hover:text-ml-glass-fg transition-colors"
            aria-label="Copy URL"
            onClick={() => copyText(pageUrl.value, 'URL copied!')}
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
            'group relative w-9 h-9 rounded-xl grid place-items-center cursor-pointer border-none transition-[color,background-color,scale] duration-150 active:scale-[0.96] shrink-0',
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
                'group relative w-8 h-8 rounded-lg grid place-items-center cursor-pointer border-none transition-[color,background-color,scale] duration-150 active:scale-[0.96]',
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

        {/* Zoom picker */}
        <div ref={zoomRef} class="relative shrink-0">
          <button
            type="button"
            onClick={() => (zoomMenuOpen.value = !zoomMenuOpen.value)}
            class={cn(
              'group relative h-8 px-2 rounded-lg flex items-center gap-1 cursor-pointer border-none transition-[color,background-color,scale] duration-150 active:scale-[0.96]',
              'text-[12px] font-medium tabular-nums min-w-14 justify-center',
              zoomMenuOpen.value
                ? 'bg-ml-glass-accent/[0.14] text-ml-glass-fg shadow-[inset_0_0.5px_0_oklch(1_0_0/0.08)]'
                : 'bg-transparent text-ml-glass-fg/65 hover:text-ml-glass-fg hover:bg-ml-glass-accent/[0.08]',
            )}
          >
            {zoomLabel(viewerZoom.value)}
            <ChevronDown size={12} aria-hidden="true" />
            <Tooltip text="Zoom" placement="bottom" />
          </button>
          {zoomMenuOpen.value && (
            <div class={cn(glass.surfaceSmall, 'absolute top-full mt-1 right-0 z-10 py-1 min-w-28')}>
              {ZOOM_PRESETS.map((preset) => (
                <button
                  key={String(preset.value)}
                  type="button"
                  onClick={() => {
                    viewerZoom.value = preset.value;
                    zoomMenuOpen.value = false;
                  }}
                  class={cn(
                    'w-full px-3 py-1.5 text-center text-[12px] font-medium tabular-nums cursor-pointer border-none transition-colors',
                    viewerZoom.value === preset.value
                      ? 'bg-ml-glass-accent/[0.10] text-ml-glass-fg'
                      : 'bg-transparent text-ml-glass-fg/70 hover:bg-ml-glass-accent/[0.08] hover:text-ml-glass-fg',
                  )}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div class={glass.sep} />

        <div class="flex items-center gap-1.5 shrink-0">
          {/* Avatar group */}
          <div ref={avatarGroupRef} class="flex items-center -space-x-2.5 mr-1" onMouseLeave={resetAvatars}>
            {/* Local user */}
            <div
              class="ml-avatar w-7 h-7 rounded-full text-white text-[10px] font-bold grid place-items-center shrink-0 ring-2 ring-[var(--ml-glass-bg)] shadow-sm transition-colors duration-150"
              style={{ background: color.value, zIndex: peers.value.size + 1 }}
              title={localUser.name}
              onMouseEnter={() => springAvatars(0)}
            >
              {localUser.name
                .split(' ')
                .map((w) => w[0])
                .join('')
                .slice(0, 2)}
            </div>
            {/* Peer avatars */}
            {Array.from(peers.value.values())
              .slice(0, MAX_VISIBLE_PEERS)
              .map((p, i) => {
                const active = p.cursor != null;
                return (
                  <div
                    key={p.id}
                    class={cn(
                      'ml-avatar w-7 h-7 rounded-full text-white text-[10px] font-bold grid place-items-center ring-2 ring-[var(--ml-glass-bg)] shadow-sm transition-opacity duration-200',
                      active ? 'opacity-100 cursor-pointer' : 'opacity-40 cursor-default',
                    )}
                    style={{ background: p.color, zIndex: peers.value.size - i }}
                    title={active ? p.name : `${p.name} (inactive)`}
                    onMouseEnter={() => springAvatars(i + 1)}
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
                );
              })}
            {peers.value.size > MAX_VISIBLE_PEERS && (
              <div
                class="ml-avatar w-7 h-7 rounded-full bg-ml-glass-fg/10 text-ml-glass-fg/70 text-[10px] font-bold grid place-items-center ring-2 ring-[var(--ml-glass-bg)] tabular-nums"
                onMouseEnter={() => springAvatars(MAX_VISIBLE_PEERS + 1)}
              >
                +{peers.value.size - MAX_VISIBLE_PEERS}
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
                  'group relative w-9 h-9 rounded-xl grid place-items-center cursor-pointer border-none transition-[color,background-color,scale] duration-150 active:scale-[0.96]',
                  voiceMuted.value
                    ? 'bg-ml-glass-fg/[0.06] text-ml-glass-fg/60'
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
                  'group relative w-9 h-9 rounded-xl grid place-items-center cursor-pointer border-none transition-[color,background-color,scale] duration-150 active:scale-[0.96]',
                  videoActive.value
                    ? 'bg-ml-glass-accent/[0.14] text-ml-glass-fg shadow-[inset_0_0.5px_0_oklch(1_0_0/0.08)]'
                    : 'bg-transparent text-ml-glass-fg/65 hover:text-ml-glass-fg hover:bg-ml-glass-accent/[0.08]',
                )}
              >
                {videoActive.value ? <Video size={16} aria-hidden="true" /> : <VideoOff size={16} aria-hidden="true" />}
                <Tooltip text={videoActive.value ? 'Turn off camera' : 'Turn on camera'} placement="bottom" />
              </button>
              <Suspense fallback={null}>
                <DeviceMenu hasPermission />
              </Suspense>
            </div>
          ) : (
            <div class="flex items-center gap-0.5">
              <button
                type="button"
                onClick={() => (voiceActive.value = true)}
                class="group relative w-9 h-9 rounded-xl grid place-items-center cursor-pointer border-none transition-[color,background-color,scale] duration-150 active:scale-[0.96] bg-transparent text-ml-glass-fg/65 hover:text-ml-glass-fg hover:bg-ml-glass-accent/[0.08]"
              >
                <Mic size={16} aria-hidden="true" />
                <Tooltip text="Join voice" placement="bottom" />
              </button>
              <Suspense fallback={null}>
                <DeviceMenu hasPermission={false} />
              </Suspense>
            </div>
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
              'group relative w-9 h-9 rounded-xl grid place-items-center cursor-pointer border-none transition-[color,background-color,scale] duration-150 active:scale-[0.96]',
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
                'group relative w-9 h-9 rounded-xl grid place-items-center cursor-pointer border-none transition-[color,background-color,scale] duration-150 active:scale-[0.96] bg-transparent text-ml-glass-fg/65 hover:text-ml-glass-fg hover:bg-ml-glass-accent/[0.1]',
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
            class="group relative w-9 h-9 rounded-xl grid place-items-center cursor-pointer border-none transition-[color,background-color,scale] duration-150 active:scale-[0.96] bg-transparent text-ml-glass-fg/65 hover:text-ml-glass-fg hover:bg-ml-glass-accent/[0.1]"
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

      {/* `mx-auto` (not `justify-center`) so flex auto-margins collapse on overflow
          — scroll starts at the page's left edge instead of clipping content. */}
      <div class="flex-1 w-full relative overflow-x-auto overflow-y-hidden flex items-stretch bg-ml-bg-device">
        {deviceMode.value !== 'desktop' && <DockedInfoPanel />}
        <div
          id="viewer"
          ref={viewerRef}
          class={cn(
            // shrink-0: a docked panel must push the frame into the scroll area,
            // never compress it — a squeezed frame is no longer that viewport.
            'relative h-full mx-auto shrink-0',
            deviceMode.value === 'desktop'
              ? originalWidth.value > 0 || cssScale.value !== 1
                ? 'shadow-[0_0_0_1px_rgba(0,0,0,0.08),0_8px_40px_rgba(0,0,0,0.12)]'
                : 'w-full overflow-hidden'
              : 'shadow-[0_0_0_1px_rgba(0,0,0,0.08),0_8px_40px_rgba(0,0,0,0.12)] bg-white',
          )}
          style={
            deviceMode.value === 'desktop'
              ? originalWidth.value > 0
                ? { width: originalWidth.value * cssScale.value }
                : cssScale.value !== 1
                  ? { width: `${cssScale.value * 100}%` }
                  : undefined
              : { width: DEVICE_WIDTHS[deviceMode.value] * cssScale.value }
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
              /* Scroll container + `min-h-full` inner, rather than a centred flex
                 box: the ancestor clips on the y axis, so in a short device
                 preview a centred box would have its top and bottom shaved off
                 with no way to reach them. This centres when there is room and
                 scrolls, padding intact, when there is not. */
              <div class="absolute inset-0 z-10 overflow-y-auto bg-ml-bg-viewer">
                <div class="min-h-full flex flex-col items-center justify-center gap-4 px-8 py-10 text-center">
                  <Logo size={48} />
                  <h2 class="text-base font-semibold text-ml-fg m-0">
                    {isLikelyEmbedHostile(pageUrl.value) ? 'This site blocks embedding' : "We couldn't load this page"}
                  </h2>
                  <p class="text-sm text-ml-fg/70 max-w-md leading-snug m-0">
                    {isLikelyEmbedHostile(pageUrl.value)
                      ? 'Sites like YouTube, TikTok, Instagram, and X refuse to load inside other pages. The annotations are saved — install the MarkLayer extension to view them on the live site.'
                      : 'The page took too long, was blocked, or returned an error. The annotations are saved — try the extension on the live page, or share a different URL.'}
                  </p>
                  {/* One primary action; the escape route is a text link rather than
                      a second outlined button, so the recovery path has a clear rank. */}
                  <div class="flex flex-col items-center gap-3">
                    <a
                      href={pageUrl.value}
                      target="_blank"
                      rel="noreferrer"
                      class="px-4 py-2 rounded-lg bg-ml-btn text-ml-btn-fg text-[13px] font-medium no-underline hover:bg-ml-btn-hover transition-colors"
                    >
                      Open original site
                    </a>
                    <a
                      href="/"
                      class="text-[13px] text-ml-fg/70 underline underline-offset-2 hover:text-ml-fg transition-colors"
                    >
                      Back home
                    </a>
                  </div>
                </div>
              </div>
            ) : (
              !iframeLoaded.value &&
              pageUrl.value && (
                <div class="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-ml-bg-viewer">
                  <Logo size={48} />
                  <Loader2 size={32} class="animate-spin text-ml-accent" aria-hidden="true" />
                  <p class="text-sm text-ml-fg/70">Loading page…</p>
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
                captureRenderFailed('no-marker', { proxy_error: classifyProxyError(doc?.body?.textContent) });
                renderFailed.value = 'no-marker';
              }}
              onError={() => {
                captureRenderFailed('iframe-error');
                renderFailed.value = 'iframe-error';
              }}
              class={cn(
                // ph-no-capture: the proxied page is same-origin, so session replay
                // would record its contents — block it and replay only our chrome.
                'ph-no-capture w-full h-full border-none bg-white',
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
                    const { x, y } = textInput.value;
                    const op: TextOp = {
                      id: nanoid(),
                      tool: 'text',
                      text,
                      x,
                      y,
                      fontSize: Math.max(14, lineWidth.value * 6),
                      color: color.value,
                      lineWidth: lineWidth.value,
                      target: pickFrameTarget({ frame: frameRef.current, x, y }),
                      captureViewport: frameViewport(frameRef.current),
                    };
                    pushDeviceOp(op);
                  }
                  textInput.value = null;
                }}
              />
            )}

            {!readonly && <WebInspectorLayer frameRef={frameRef} />}
            {!readonly && <WebMeasureLayer frameRef={frameRef} />}
            {!readonly && <WebGuideLayer frameRef={frameRef} />}
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
              frameRef={frameRef}
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
          <Lock size={14} class="text-ml-glass-fg/60" aria-hidden="true" />
          <span class="text-[12px] text-ml-glass-fg/60 font-medium">View-only mode</span>
        </div>
      )}

      {/* Raycast-style mic indicator */}
      {voiceActive.value && <VoicePill />}

      {/* Draggable self-view + expanded peer bubbles. Wrapped in one Suspense
          boundary so the MediaBubble chunk loads at most once across all bubbles. */}
      {(localVideoStream.value || expandedPeers.value.size > 0) && (
        <Suspense fallback={null}>
          {localVideoStream.value && videoActive.value && (
            <MediaBubble id="self" stream={localVideoStream.value} muted mirror defaultSize={72} />
          )}
          {Array.from(expandedPeers.value).map((peerId) => {
            const stream = peerVideoStreams.value.get(peerId);
            const peer = peers.value.get(peerId);
            if (!stream || !peer) return null;
            const ring = qualityRing(peerConnQuality.value.get(peerId), peer.color);
            return (
              <MediaBubble
                key={peerId}
                id={`peer-${peerId}`}
                stream={stream}
                defaultSize={140}
                label={peer.name}
                ringColor={ring}
                speaking={voiceSpeaking.value.has(peerId)}
                onClose={() => {
                  const next = new Set(expandedPeers.value);
                  next.delete(peerId);
                  expandedPeers.value = next;
                }}
              />
            );
          })}
        </Suspense>
      )}

      {/* Autoplay block — single tap unblocks remote audio. */}
      {audioBlocked.value && (
        <button
          type="button"
          onClick={resumeBlockedAudio}
          class="fixed top-12 left-1/2 -translate-x-1/2 z-2147483647 px-3 py-2 rounded-xl bg-amber-500/90 text-white text-xs font-medium shadow-lg cursor-pointer border-none animate-[fadeInDown_0.2s_ease-out]"
        >
          Click to enable call audio
        </button>
      )}

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
                class="ml-1 text-ml-glass-fg/60 hover:text-ml-glass-fg/70 transition-colors"
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
          'w-7 h-7 rounded-lg grid place-items-center border-none cursor-pointer transition-[color,background-color,scale] duration-150 active:scale-[0.96]',
          muted ? 'bg-ml-glass-fg/[0.06] text-ml-glass-fg/60' : 'bg-green-500/20 text-green-400',
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
              class="w-[2.5px] rounded-full transition-[opacity,transform] duration-100 ease-out"
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
        class="w-6 h-6 rounded-md grid place-items-center border-none cursor-pointer bg-transparent text-ml-glass-fg/60 hover:text-ml-glass-fg hover:bg-ml-glass-fg/[0.06] transition-[color,background-color,scale] duration-150 active:scale-[0.96]"
        title="Leave voice"
      >
        <X size={11} aria-hidden="true" />
      </button>
    </div>
  );
}
