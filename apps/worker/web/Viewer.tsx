import { ContextMenu } from '@ext/components/ContextMenu';
import { Toasts } from '@ext/components/Toasts';
import { Toolbar } from '@ext/components/Toolbar';
import { captureScale } from '@ext/lib/anchor';
import { animationsFrozen, freezeDocument, thawDocument } from '@ext/lib/freeze';
import { glass } from '@ext/lib/glass';
import { constrainEnd, hexToRgba, inView, opBounds, renderOp, simplify, strokeArrowHead } from '@ext/lib/renderer';
import { captureTarget } from '@ext/lib/selector';
import { isLikelyEmbedHostile } from '@ext/lib/share';
import {
  activeTool,
  bindFigmaKeys,
  color,
  FREEHAND,
  focusedAnnotationId,
  handTool,
  isDrawingActive,
  lineWidth,
  onCursorMove,
  onExportPng,
  onSupport,
  operations,
  panScrollBy,
  peers,
  redo,
  SHAPES,
  selectionCaptureArmed,
  showAnnotationPanel,
  showShareDialog,
  toast,
  toggleUiHidden,
  uiHidden,
  undo,
  undoRedoFlash,
} from '@ext/lib/state';
import type { FreehandOp, Point, SelectionRect } from '@ext/lib/types';
import { cn } from '@marklayer/types';
import { useComputed, useSignal, useSignalEffect } from '@preact/signals';
import { nanoid } from 'nanoid';
import { lazy, Suspense } from 'preact/compat';
import { useCallback, useEffect, useMemo, useRef } from 'preact/hooks';
import { tinykeys } from 'tinykeys';
import type { ExportData } from './AnnotationPanel';
import { capture } from './analytics';
import { frameViewport, isElementNode } from './iframeOverlay';
import { ProjectTabs } from './ProjectTabs';
import { SupportDialog } from './SupportDialog';
import {
  API_BASE,
  annotationId,
  attachIframeMutationObserver,
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
  presenting,
  projectId,
  projectLoading,
  projectPages,
  pushDeviceOp,
  selectionPopover,
  sharing,
  showBoard,
  showInfoPanel,
  stepZoom,
  textInput,
  viewerZoom,
} from './signals';
import { noteSupportSignal } from './support';
import { maybeOfferSupport, openSupportCard } from './support-ui';
import { connected, emitRipple, localPeerId, serverUrl, serverWidth, useRealtimeSync } from './useRealtimeSync';
import { ViewerTopBar } from './ViewerChrome';
import {
  AudioUnblockPrompt,
  FollowIndicator,
  MobileOnlyPage,
  NarrowViewportGate,
  VideoBubbles,
  ViewOnlyBadge,
  VoicePill,
} from './ViewerHud';
import { dockedPanelsWidth } from './ViewerInfoPanel';
import { ViewerStage } from './ViewerStage';
import { useRenderOutcome } from './viewer/useRenderOutcome';
import { FAILURE_COPY, type RenderFailure, type ViewerFrame, ViewerFrameProvider } from './viewerFrame';
import { videoActive, voiceActive } from './voiceSignals';

// WebRTC engine lives in its own chunk — only fetched when a user joins voice/video.
const VoiceEngine = lazy(() => import('./VoiceEngine'));

// A whole second screen most sessions never open, so it loads on first use.
const AnnotationBoard = lazy(() => import('./AnnotationBoard').then((m) => ({ default: m.AnnotationBoard })));

/** Narrowest space auto-fit will size a device frame into before letting it overflow and scroll. */
const MIN_DEVICE_FIT_WIDTH = 320;

/** Authoring-only chrome. A guest is somebody else's visitor and gets none of it. */
function AuthoringChrome() {
  // The settings panel is the extension's, and the card is not. Publishing the
  // opener from the same component that renders the card is what keeps that row
  // honest: it exists exactly as long as there is something for it to open.
  useEffect(() => {
    onSupport.value = () => openSupportCard('menu');
    return () => {
      onSupport.value = null;
    };
  }, []);

  return (
    <>
      <Toolbar />
      {/* Never for a read-only visitor: they did not make any of this. */}
      <SupportDialog />
    </>
  );
}

/**
 * The one place that knows how the viewer is wired. Every ref, local signal and
 * handler below is published through `ViewerFrameProvider`, so the chrome, stage
 * and HUD it composes read one contract instead of taking a dozen props each.
 */

export default function Viewer() {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<HTMLDivElement>(null);

  const iframeLoaded = useSignal(false);
  const renderFailed = useSignal<RenderFailure | null>(null);
  const blockedEgressIp = useSignal<string | null>(null);
  const pageSlow = useSignal(false);
  const zoomMenuOpen = useSignal(false);
  // The two causes the upstream names itself win; anything else is judged by the URL.
  const failureCopy = useComputed(() => {
    const cause = renderFailed.value;
    if (cause === 'firewall' || cause === 'upstream-error') return FAILURE_COPY[cause];
    return FAILURE_COPY[isLikelyEmbedHostile(pageUrl.value) ? 'hostile' : 'generic'];
  });

  const drawingRef = useRef(false);
  const startPtRef = useRef<Point>({ x: 0, y: 0 });
  const currentPathRef = useRef<FreehandOp | null>(null);
  const snapshotRef = useRef<ImageData | null>(null);
  const shiftHeldRef = useRef(false);
  const lastPosRef = useRef<Point | null>(null);

  const readonly = isReadonly.value;
  const chromeHidden = uiHidden.value;

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

  // The zoom menu dismisses itself on any outside pointerdown in our document —
  // but a click inside the previewed page is inside an iframe, and never reaches
  // us. Re-runs when iframeLoaded flips so it reattaches after each (re)load.
  useSignalEffect(() => {
    if (!zoomMenuOpen.value) return;
    iframeLoaded.value; // subscribe so we reattach after iframe (re)loads
    const close = () => {
      zoomMenuOpen.value = false;
    };
    const win = frameRef.current?.contentWindow;
    try {
      win?.addEventListener('mousedown', close);
    } catch {
      return; // cross-origin — nothing to attach, and nothing to clean up
    }
    return () => {
      try {
        win?.removeEventListener('mousedown', close);
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

  const { reportRenderFailure, reportRenderSuccess } = useRenderOutcome({
    frameRef,
    iframeLoaded,
    renderFailed,
    pageSlow,
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
      // `mode` is the one thing worth knowing here: a run of `canvas` exports
      // means the DOM capture is failing on real pages and nobody is reporting it.
      const fallbackToCanvas = () => {
        if (!canvas) return capture('export_failed', { format: 'png', reason: 'no-canvas' });
        canvas.toBlob((b) => {
          if (b) {
            downloadBlob(b);
            capture('export_completed', { format: 'png', mode: 'canvas', ops: operations.value.length });
            toast('PNG exported (drawings only)', 'success');
          } else {
            capture('export_failed', { format: 'png', reason: 'blob-null' });
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
          capture('export_completed', { format: 'png', mode: 'dom', ops: operations.value.length });
          toast('PNG exported', 'success');
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
  /** Clears `programmaticScroll` once scrolling has actually stopped, not on a fixed timer. */
  const scrollSettle = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Last cursor X inside the frame, so a presenter's scroll-only update keeps a sane X. */
  const lastCursorX = useRef(0);
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
          // Break follow mode on user-initiated scroll. The programmatic flag is
          // held open until scrolling actually stops rather than for a fixed
          // window: a smooth scroll across a long page outlives any timer started
          // when it began, and the late events would read as the user taking over
          // and break the follow that caused them.
          if (programmaticScroll.current) {
            if (scrollSettle.current) clearTimeout(scrollSettle.current);
            scrollSettle.current = setTimeout(() => {
              programmaticScroll.current = false;
              scrollSettle.current = null;
            }, 150);
          } else if (followingPeer.value) {
            followingPeer.value = null;
          }
          // Followers ride the presenter's cursor Y, and the cursor only emits on
          // mousemove — so a presenter who scrolls without moving the mouse would
          // move nobody. Emit the viewport centre instead, which is where
          // `onFollowScroll` lands them, so the two viewports show the same content.
          if (presenting.value) {
            onCursorMove.value?.(lastCursorX.current, (win.scrollY || 0) + win.innerHeight / 2, activeTool.value);
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
          lastCursorX.current = e.clientX;
          onCursorMove.value?.(e.clientX, e.clientY + (win.scrollY || 0), activeTool.value);
        });
        // Hand tool: the framed page is its own scroller, and it sits behind a CSS
        // scale, so a screen-space drag delta has to be divided back out.
        panScrollBy.value = (dx: number, dy: number) => {
          const s = cssScale.value || 1;
          win.scrollBy(dx / s, dy / s);
        };
        // Follow mode: scroll iframe to followed peer's Y
        onFollowScroll.value = (y: number) => {
          programmaticScroll.current = true;
          if (scrollSettle.current) clearTimeout(scrollSettle.current);
          win.scrollTo({ top: Math.max(0, y - win.innerHeight / 2), behavior: 'smooth' });
          // The flag is cleared by the scroll handler once the events stop, so a
          // scroll of any length stays recognised as ours for its whole duration.
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
      panScrollBy.value = null;
      if (scrollSettle.current) clearTimeout(scrollSettle.current);
    };
  }, []);

  // Distinct days of use, the slowest of the support signals. Authors only: a
  // read-only visitor is looking at somebody else's work, not using the tool.
  useEffect(() => {
    if (!readonly) noteSupportSignal('used');
  }, []);

  // Link interception from proxy, plus the proxy's own "this page never arrived"
  // signal — a firewall challenge or an upstream error status, which the load
  // event alone reports as a perfectly successful render of nothing.
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type === 'ml-navigate' && typeof e.data.url === 'string')
        navigateTo({ url: e.data.url, source: 'page_link' });
      if (e.data?.type === 'ml-blocked') {
        // The proxy separates "a firewall refused us" from "the origin errored";
        // only the first is worth showing an allowlisting address for.
        const failure: RenderFailure = e.data.reason === 'firewall' ? 'firewall' : 'upstream-error';
        blockedEgressIp.value = failure === 'firewall' && typeof e.data.ip === 'string' ? e.data.ip : null;
        reportRenderFailure(failure, { block_reason: e.data.reason, status: e.data.status });
        renderFailed.value = failure;
      }
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
    // Zoom, panning and the Alt measure readout are navigation, so they bypass
    // `guard` and stay available to a read-only viewer.
    const viewKey = (fn: (e: KeyboardEvent) => void) => (e: KeyboardEvent) => {
      if (isEditable(e.target)) return;
      fn(e);
    };
    const viewKeyPD = (fn: () => void) =>
      viewKey((e) => {
        e.preventDefault();
        fn();
      });

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
      // The board is the same annotations in another arrangement, so a read-only
      // guest gets it too — `viewKey`, not `guard`. ⌘B is free in a browser: the
      // bookmarks bar is ⌘⇧B, and this never fires while a field has focus.
      '$mod+KeyB': viewKey((e) => {
        e.preventDefault();
        const opening = !showBoard.value;
        showBoard.value = opening;
        // It replaces the panel rather than stacking over it, the same way the
        // panel's own board button does.
        if (opening) showAnnotationPanel.value = false;
      }),
      '$mod+Equal': viewKeyPD(() => stepZoom(1)),
      '$mod+Minus': viewKeyPD(() => stepZoom(-1)),
      '$mod+Digit0': viewKeyPD(() => {
        viewerZoom.value = 'auto';
      }),
      Escape: (e) => {
        if (isEditable(e.target) && e.target instanceof HTMLElement) {
          e.target.blur();
          return;
        }
        // Above the read-only bail: ⌘/ is a navigation key a guest gets too, so
        // the key that undoes it has to reach them as well. Nothing else is on
        // screen to escape from either, which is why it unwinds first.
        if (uiHidden.value) {
          toggleUiHidden();
          e.preventDefault();
          return;
        }
        if (isReadonly.value) return;
        if (showShareDialog.value) {
          showShareDialog.value = false;
          e.preventDefault();
          return;
        }
        // Steps out of a focused annotation before closing the panel that holds it,
        // so Escape unwinds one level at a time rather than dropping the whole panel.
        if (focusedAnnotationId.value) {
          focusedAnnotationId.value = null;
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
        if (handTool.value) {
          handTool.value = false;
          e.preventDefault();
          return;
        }
        activeTool.value = 'navigate';
        e.preventDefault();
      },
    };
    const unbind = tinykeys(window, bindings);
    const unbindFigma = bindFigmaKeys({ target: window, guard, viewGuard: viewKey });
    return () => {
      unbind();
      unbindFigma();
    };
  }, []);

  const share = useCallback(async (opts?: { readonly?: boolean; expiresIn?: number }) => {
    if (sharing.value) return;
    sharing.value = true;
    // Project share: just copy the /p/:id link — pages are already persisted as the user added them
    const pid = projectId.value;
    if (pid) {
      let shareUrl = `${location.origin}/p/${pid}`;
      if (opts?.readonly) shareUrl += '?readonly=1';
      try {
        await navigator.clipboard.writeText(shareUrl);
        toast('Project link copied', 'success');
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
    toast('Link copied', 'success');

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
      capture('share_created', {
        readonly: Boolean(opts?.readonly),
        ops: operations.value.length,
        expires: Boolean(opts?.expiresIn),
      });
      // Only a link that actually saved counts as the tool having worked.
      noteSupportSignal('shared');
      // A beat after the toast, so the card arrives at a pause rather than on
      // top of the thing that just succeeded.
      window.setTimeout(maybeOfferSupport, 1200);
    } catch {
      // A copied link that never saved is the worst failure the product has: the
      // person walks away believing they shared something.
      capture('share_failed', { ops: operations.value.length });
      toast('Failed to save — link may not work', 'error');
    } finally {
      sharing.value = false;
    }
  }, []);

  // Share dialog signal
  useSignalEffect(() => {
    if (!showShareDialog.value) return;
    showShareDialog.value = false;
    share();
  });

  // Aggregate ops across all project pages (current page = live, others = cached on load)
  const buildExportData = useCallback((): ExportData => {
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
  }, []);

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

  const startDrawing = useCallback(
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
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx) return;
      applyTool(ctx);
      if (FREEHAND.has(tool) || SHAPES.has(tool)) {
        snapshotRef.current = ctx.getImageData(0, 0, canvas.width, canvas.height);
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
            strokeArrowHead(ctx, { start: { x: vsx, y: vsy }, end: { x: vex, y: vey }, lineWidth: ctx.lineWidth });
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
  const captureSelection = useCallback(
    ({
      sel,
      fromIframe,
      auto,
    }: {
      sel: Selection | null;
      /** Rects arrive in frame coordinates and need the frame's offset and scale applied. */
      fromIframe: boolean;
      /** The selection alone opened this, so the popover must not take focus. */
      auto: boolean;
    }) => {
      if (!sel || sel.isCollapsed) return;
      const text = sel.toString();
      if (!text.trim()) return;
      const rects: SelectionRect[] = [];
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
        target: el && first ? captureTarget({ el, anchor: { x: first.x, y: first.y }, selectedText: text }) : undefined,
        captureViewport: frameViewport(frameRef.current),
        auto,
      };
    },
    [],
  );

  useEffect(() => {
    const onMouseUp = () => {
      if (activeTool.value !== 'selection') return;
      requestAnimationFrame(() => captureSelection({ sel: window.getSelection(), fromIframe: false, auto: false }));
    };
    window.addEventListener('mouseup', onMouseUp);
    return () => window.removeEventListener('mouseup', onMouseUp);
  }, [captureSelection]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    let win: Window | null = null;
    const onMouseUp = () => {
      if (!selectionCaptureArmed.value) return;
      const auto = activeTool.value !== 'selection';
      requestAnimationFrame(() => {
        try {
          captureSelection({ sel: frame.contentWindow?.getSelection?.() ?? null, fromIframe: true, auto });
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

  // Every member is stable for the component's life — signals and refs are
  // identities, the handlers are all `useCallback([])` — so the contract is built
  // once and a Viewer re-render never invalidates the subtree beneath it.
  const frame = useMemo<ViewerFrame>(
    () => ({
      state: { iframeLoaded, renderFailed, pageSlow, blockedEgressIp, failureCopy, zoomMenuOpen },
      actions: {
        canvasCoords,
        startDrawing,
        share: () => void share(),
        scrollToAnnotation,
        buildExportData,
        reportRenderFailure,
        reportRenderSuccess,
      },
      meta: { frameRef, canvasRef, innerRef, viewerRef },
    }),
    [],
  );

  if (isMobileDevice) return <MobileOnlyPage />;

  return (
    <ViewerFrameProvider value={frame}>
      <div class={cn('h-screen overflow-hidden flex flex-col bg-ml-bg-device', glass.font)}>
        {voiceMounted && (
          <Suspense fallback={null}>
            <VoiceEngine localPeerId={localPeerId} />
          </Suspense>
        )}
        <NarrowViewportGate />

        {/* Figma's hide-UI (⌘/): every bar and panel off, the annotations and
            the page they sit on left alone. The top bar collapses out of the
            column, so the stage takes the height it gives up. */}
        {!chromeHidden && <ViewerTopBar />}
        {/* Only renders anything when the URL is /p/:id */}
        {!chromeHidden && <ProjectTabs />}
        <ViewerStage />

        <ContextMenu />
        {!chromeHidden && (readonly ? <ViewOnlyBadge /> : <AuthoringChrome />)}

        {/* Call controls stay: losing the mute button behind a shortcut with no
            visible way back is a different kind of problem than a busy screen. */}
        {voiceActive.value && <VoicePill />}
        <VideoBubbles />
        <AudioUnblockPrompt />
        <FollowIndicator />
        {/* Above the toasts in the tree so a status change made on the board still
            announces itself over it. */}
        <Suspense fallback={null}>
          <AnnotationBoard />
        </Suspense>
        <Toasts offset={chromeHidden ? 'top' : 'below-bar'} />
      </div>
    </ViewerFrameProvider>
  );
}
