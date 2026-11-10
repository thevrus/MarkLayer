import { ContextMenu } from '@ext/components/ContextMenu';
import { Toasts } from '@ext/components/Toasts';
import { Toolbar } from '@ext/components/Toolbar';
import { glass } from '@ext/lib/glass';
import { operations } from '@ext/lib/ops';
import { connected, localPeerId, serverUrl, serverWidth } from '@ext/lib/realtime';
import { scrollPageTo } from '@ext/lib/scroller';
import { isLikelyEmbedHostile } from '@ext/lib/share';
import type { Point } from '@ext/lib/types';
import { uiHidden } from '@ext/lib/ui-state';
import { cn } from '@marklayer/ui/cn';
import { useComputed, useSignal, useSignalEffect } from '@preact/signals';
import { lazy, Suspense } from 'preact/compat';
import { useCallback, useEffect, useMemo, useRef } from 'preact/hooks';
import { FRAME_MESSAGE } from '../shared/frame-protocol';
import type { Firewall } from '../shared/proxy-errors';
import { ProjectTabs } from './ProjectTabs';
import { annotationId, openProject, originalWidth, pageUrl, projectId } from './projects';
import { watchUse } from './support-ui';
import { useCheckFix } from './useCheckFix';
import { useRealtimeSync } from './useRealtimeSync';
import { ViewerTopBar } from './ViewerChrome';
import { TeachLayer } from './TeachLayer';
import { AudioUnblockPrompt, FollowIndicator, VideoBubbles, ViewOnlyBadge, VoicePill } from './ViewerHud';
import { ViewerStage } from './ViewerStage';
import { AuthoringChrome } from './viewer/AuthoringChrome';
import { PhoneBar } from './viewer/PhoneBar';
import { useCanvasPainter } from './viewer/useCanvasPainter';
import { useFrameMessages } from './viewer/useFrameMessages';
import { useFrameSession } from './viewer/useFrameSession';
import { usePointerBroadcast } from './viewer/usePointerBroadcast';
import { useRenderOutcome } from './viewer/useRenderOutcome';
import { useSelectionPopover } from './viewer/useSelectionPopover';
import { useStrokeInput } from './viewer/useStrokeInput';
import { useViewerKeymap } from './viewer/useViewerKeymap';
import { compactChrome, cssScale, iframeScrollY, isReadonly, isStillFrame } from './viewer-state';
import { FAILURE_COPY, type RenderFailure, type ViewerFrame, ViewerFrameProvider } from './viewerFrame';
import { voiceActive } from './voiceSignals';

// WebRTC engine lives in its own chunk — only fetched when a user joins voice/video.
const VoiceEngine = lazy(() => import('./VoiceEngine'));

// A whole second screen most sessions never open, so it loads on first use.
const AnnotationBoard = lazy(() => import('./AnnotationBoard').then((m) => ({ default: m.AnnotationBoard })));

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
  const blockedFirewall = useSignal<Firewall | null>(null);
  const pageSlow = useSignal(false);
  // The two causes the upstream names itself win; anything else is judged by the URL.
  const failureCopy = useComputed(() => {
    const cause = renderFailed.value;
    if (cause === 'firewall' || cause === 'upstream-error') return FAILURE_COPY[cause];
    return FAILURE_COPY[isLikelyEmbedHostile(pageUrl.value) ? 'hostile' : 'generic'];
  });

  const readonly = isReadonly.value;
  const chromeHidden = uiHidden.value;

  const scrollToAnnotation = useCallback((y: number) => {
    try {
      const win = frameRef.current?.contentWindow;
      if (win) scrollPageTo(win, { top: Math.max(0, y - 200), behavior: 'smooth' });
    } catch {
      /* cross-origin */
    }
  }, []);

  useRealtimeSync(annotationId.value);
  const voiceMounted = voiceActive.value;

  useFrameSession({ frameRef });
  useSignalEffect(watchUse);
  useViewerKeymap();

  useSignalEffect(() => {
    const u = serverUrl.value;
    const w = serverWidth.value;
    if (u && !pageUrl.value) pageUrl.value = u;
    if (w && !originalWidth.value) originalWidth.value = w;
  });

  // Reads no signal after `peek`, so a project opens once per mount.
  useSignalEffect(() => {
    const pid = projectId.peek();
    if (pid) void openProject(pid);
  });

  const { failRender, frameLoaded, frameErrored, frameReady, markLoading } = useRenderOutcome({
    frameRef,
    iframeLoaded,
    renderFailed,
    pageSlow,
  });
  useFrameMessages({ frameRef, blockedEgressIp, blockedFirewall, failRender, frameReady });
  useCheckFix({ frameRef, markLoading, scrollTo: scrollToAnnotation });

  // The landing swaps its poster for this room once there is a page to look at.
  useSignalEffect(() => {
    if (isStillFrame.value && iframeLoaded.value)
      window.parent.postMessage({ type: FRAME_MESSAGE.ready }, location.origin);
  });

  // Ops sync live; only warn when the socket is down with unsynced ops on screen.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (operations.value.length > 0 && !connected.value) e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  const clientToDoc = useCallback(({ x, y }: Point): Point => {
    const r = innerRef.current?.getBoundingClientRect() ?? { left: 0, top: 0 };
    const cs = cssScale.peek();
    return { x: (x - r.left) / cs, y: (y - r.top) / cs + iframeScrollY.peek() };
  }, []);
  const canvasCoords = useCallback((e: MouseEvent) => clientToDoc({ x: e.clientX, y: e.clientY }), []);

  const { startDrawing, repainted } = useStrokeInput({ canvasRef, clientToDoc });
  useCanvasPainter({ canvasRef, viewerRef, repainted });
  usePointerBroadcast({ innerRef, canvasCoords });
  useSelectionPopover({ frameRef, innerRef });

  // Every member is stable for the component's life — signals and refs are
  // identities, the handlers are all `useCallback([])` — so the contract is built
  // once and a Viewer re-render never invalidates the subtree beneath it.
  const frame = useMemo<ViewerFrame>(
    () => ({
      state: { iframeLoaded, renderFailed, pageSlow, blockedEgressIp, blockedFirewall, failureCopy },
      actions: {
        canvasCoords,
        startDrawing,
        scrollToAnnotation,
        frameLoaded,
        frameErrored,
      },
      meta: { frameRef, canvasRef, innerRef, viewerRef },
    }),
    [],
  );

  return (
    <ViewerFrameProvider value={frame}>
      <div class={cn('h-screen overflow-hidden flex flex-col bg-ml-bg-device', glass.font)}>
        {voiceMounted && (
          <Suspense fallback={null}>
            <VoiceEngine localPeerId={localPeerId} />
          </Suspense>
        )}

        {/* Figma's hide-UI (⌘/): every bar and panel off, the annotations and
            the page they sit on left alone. The top bar collapses out of the
            column, so the stage takes the height it gives up. */}
        {/* A phone drops the bar: its controls live in the phone bar at the bottom. */}
        {!chromeHidden && !compactChrome.value && <ViewerTopBar />}
        {/* Only renders anything when the URL is /p/:id */}
        {!chromeHidden && <ProjectTabs />}
        <ViewerStage />

        <TeachLayer frameRef={frameRef} />
        <ContextMenu />
        {/* One bar at the bottom: the phone's, or the desktop toolbar (a guest's badge in its place). */}
        {!chromeHidden && (compactChrome.value ? <PhoneBar /> : readonly ? <ViewOnlyBadge /> : <Toolbar />)}
        {!chromeHidden && !readonly && <AuthoringChrome />}

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
