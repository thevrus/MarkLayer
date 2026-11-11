import { CommentPopover, CommentSheet } from '@ext/components/CommentPopover';
import { PanLayer } from '@ext/components/PanLayer';
import { commentContext } from '@ext/lib/comment-context';
import { activeLayer } from '@ext/lib/layers';
import { operations } from '@ext/lib/ops';
import { snapshotPin } from '@ext/lib/pin-shot';
import { color, lineWidth } from '@ext/lib/prefs';
import { fileUrl, transcribeFile, uploadFile } from '@ext/lib/share';
import { makeTextOp } from '@ext/lib/text-op';
import { activeTool, panScrollBy } from '@ext/lib/tool-state';
import { toolPaintsCanvas } from '@ext/lib/tools';
import { useCopyToClipboard } from '@ext/lib/useCopy';
import { CHROME_STORE_URL } from '@marklayer/brand';
import { displayHost, isUploadPath } from '@marklayer/brand/links';
import { cn } from '@marklayer/ui/cn';
import { Loader2 } from 'lucide-preact';
import { FRAME_SANDBOX } from '../shared/frame-protocol';
import { AnnotationPanel, AnnotationSheet, DockedAnnotationPanel } from './AnnotationPanel';
import { capture } from './analytics';
import { CursorLayer } from './CursorLayer';
import { DeviceOverview } from './DeviceOverview';
import { audioConstraint } from './devicePrefs';
import { frameSrc, liveRoomUrl } from './docSource';
import { shootFrame } from './frameShot';
import {
  captureAnchors,
  frameViewport,
  sameOriginWindow,
  useFrameMarkPointer,
  useFrameRectTracker,
  wheelUnit,
} from './iframeOverlay';
import { annotationId, originalWidth, pageUrl, transcribeVideo, uploadVideo } from './projects';
import { HOME_LINK_PROPS, Logo, TextInputOverlay } from './shared';
import { annotationPanelOpen, commentPopover, selectionPopover, showAnnotationPanel, textInput } from './ui-state';
import { DockedInfoPanel, InfoPanel } from './ViewerInfoPanel';
import {
  compactChrome,
  cssScale,
  DEVICE_WIDTHS,
  deviceAreas,
  deviceComments,
  deviceMode,
  deviceSelections,
  iframeScrollY,
  isReadonly,
  isStillFrame,
  panelsDocked,
  pushDeviceOp,
} from './viewer-state';
import { FIREWALL_ADVICE, useViewerFrame } from './viewerFrame';
import { WebAreaLayer } from './WebAreaLayer';
import { WebAreaShape } from './WebAreaShape';
import { WebCommentPin } from './WebCommentPin';
import { WebGuideLayer } from './WebGuideLayer';
import { WebInspectorLayer } from './WebInspectorLayer';
import { WebMeasureLayer } from './WebMeasureLayer';
import { WebMultiInspectLayer } from './WebMultiInspectLayer';
import { WebSelectionHighlight } from './WebSelectionHighlight';
import { WebSelectionPopover } from './WebSelectionPopover';

/**
 * The page scrolls inside the iframe, but a live tool overlay sits on top of it in
 * *this* document — so a wheel over the overlay reaches no scroller at all and the
 * page sits frozen under the pen. Forward it to the frame instead, at the same
 * scale-corrected rate the hand tool uses.
 *
 * Two things are deliberately left alone: a sideways gesture, which belongs to the
 * device strip this frame sits in, and a wheel that already found a scroller of its
 * own on the way up (a comment thread's hover card), which would otherwise have its
 * scroll stolen by the page behind it.
 */
/**
 * The ancestor walk above is a `getComputedStyle` (style recalc) and a
 * `scrollHeight` read (layout) per hop, and a trackpad fires 60-120 wheel events
 * a second into a document the forwarded scroll is already dirtying — so running
 * it per tick forces a style+layout flush per tick. Within one gesture the target
 * never changes, so the verdict is cached against it; a pause longer than a
 * gesture's own event gap drops the cache, in case the element became scrollable.
 */
const GESTURE_GAP_MS = 300;
let wheelCache: { target: Element; blocked: boolean; at: number } | null = null;

function wheelHitsOwnScroller({ target, root }: { target: Element; root: Element }): boolean {
  const now = performance.now();
  if (wheelCache && wheelCache.target === target && now - wheelCache.at < GESTURE_GAP_MS) {
    wheelCache.at = now;
    return wheelCache.blocked;
  }
  let blocked = false;
  for (let el: Element | null = target; el && el !== root; el = el.parentElement) {
    const { overflowY } = getComputedStyle(el);
    if ((overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight) {
      blocked = true;
      break;
    }
  }
  wheelCache = { target, blocked, at: now };
  return blocked;
}

function forwardWheel(e: WheelEvent) {
  if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
  const { currentTarget, target } = e;
  if (!(currentTarget instanceof Element) || !(target instanceof Element)) return;
  if (wheelHitsOwnScroller({ target, root: currentTarget })) return;
  e.preventDefault();
  panScrollBy.value?.(0, e.deltaY * wheelUnit({ e, pageHeight: window.innerHeight }));
}

/**
 * Which pointer surface is live. Derived here rather than passed down: every
 * value comes from a signal, so a prop would only be a stale copy of one.
 */
function pointerModes() {
  const tool = activeTool.value;
  const readonly = isReadonly.value;
  return {
    tool,
    canvas: !readonly && toolPaintsCanvas(tool),
    text: !readonly && tool === 'text',
    comment: !readonly && tool === 'comment',
  };
}

/** Our relay's own address, so the ask is one specific IP rather than "allow Cloudflare". */
function OwnerFix({ ip }: { ip: string }) {
  const { state } = useViewerFrame();
  const { copied, copy } = useCopyToClipboard({ resetMs: 1600 });
  const firewall = state.blockedFirewall.value;
  const advice = firewall ? FIREWALL_ADVICE[firewall] : null;
  const host = displayHost(pageUrl.value) ?? pageUrl.value;
  return (
    <div class="flex flex-col items-center gap-2 max-w-md">
      <p class="text-ui text-ml-fg/70 leading-snug m-0">
        {advice?.before ?? 'Own this site? Your host can allow visual collaboration with one address:'}{' '}
        <code class="px-1.5 py-0.5 rounded bg-ml-fg/8 font-mono text-meta text-ml-fg">{ip}</code>
        {advice ? ` ${advice.after}` : '.'}
      </p>
      {advice && (
        <button
          type="button"
          onClick={() => {
            copy(advice.request({ ip, host }));
            capture('owner_fix_copied', { firewall });
          }}
          class="px-3 py-1.5 rounded-lg border border-ml-fg/15 bg-transparent text-meta text-ml-fg cursor-pointer hover:bg-ml-fg/5 transition-colors"
        >
          {copied.value ? 'Copied' : 'Copy support request'}
        </button>
      )}
    </div>
  );
}

/**
 * Scroll container + `min-h-full` inner, rather than a centred flex box: the
 * ancestor clips on the y axis, so in a short device preview a centred box would
 * have its top and bottom shaved off with no way to reach them. This centres when
 * there is room and scrolls, padding intact, when there is not.
 */
function PageFailure() {
  const { state } = useViewerFrame();
  const copy = state.failureCopy.value;
  const upload = isUploadPath(pageUrl.value);
  const ip = state.blockedEgressIp.value;
  const openHref = upload
    ? pageUrl.value
    : liveRoomUrl({ url: pageUrl.value, width: originalWidth.value, id: annotationId.value });
  return (
    <div class="absolute inset-0 z-10 overflow-y-auto bg-ml-bg-viewer">
      <div class="min-h-full flex flex-col items-center justify-center gap-4 px-8 py-10 text-center">
        <Logo size={48} />
        <h2 class="text-body font-semibold text-ml-fg m-0">{copy.title}</h2>
        <p class="text-ui text-ml-fg/70 max-w-md leading-snug m-0">{copy.body}</p>
        {state.renderFailed.value === 'firewall' && ip && <OwnerFix ip={ip} />}
        {/* One primary action; the escape route is a text link rather than a
            second outlined button, so the recovery path has a clear rank. */}
        <div class="flex flex-col items-center gap-3">
          <a
            href={openHref}
            target="_blank"
            rel="noreferrer"
            class="px-4 py-2 rounded-lg bg-ml-btn text-ml-btn-fg text-ui font-medium no-underline hover:bg-ml-btn-hover transition-colors"
          >
            {upload ? 'Open the file' : 'Open on the live site'}
          </a>
          {!upload && (
            <p class="text-meta text-ml-fg/60 max-w-xs leading-snug m-0">
              Then click the visual collaboration extension's icon to load these annotations there.{' '}
              <a
                href={CHROME_STORE_URL}
                target="_blank"
                rel="noreferrer"
                class="text-ml-fg/70 underline underline-offset-2 hover:text-ml-fg"
              >
                Get the extension
              </a>
            </p>
          )}
          <a
            {...HOME_LINK_PROPS}
            class="text-ui text-ml-fg/70 underline underline-offset-2 hover:text-ml-fg transition-colors"
          >
            Back home
          </a>
        </div>
      </div>
    </div>
  );
}

function PageLoading() {
  const { state } = useViewerFrame();
  return (
    <div class="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-ml-bg-viewer">
      <Logo size={48} />
      <Loader2 size={32} class="animate-spin text-ml-accent" aria-hidden="true" />
      <p class="text-ui text-ml-fg/70">
        {state.pageSlow.value ? 'Still loading. This page is slow to answer…' : 'Loading page…'}
      </p>
    </div>
  );
}

/** Nothing to show yet, or nothing to show at all — one place decides which. */
function PageStatus() {
  const { state } = useViewerFrame();
  if (state.renderFailed.value && pageUrl.value) return <PageFailure />;
  if (!state.iframeLoaded.value && pageUrl.value) return <PageLoading />;
  return null;
}

function ProxiedPage() {
  const { state, actions, meta } = useViewerFrame();
  const modes = pointerModes();
  return (
    <iframe
      ref={meta.frameRef}
      title="Annotated page"
      src={pageUrl.value ? frameSrc({ url: pageUrl.value }) : undefined}
      sandbox={FRAME_SANDBOX}
      onLoad={actions.frameLoaded}
      onError={actions.frameErrored}
      class={cn(
        // ph-no-capture: the proxied page is same-origin, so session replay
        // would record its contents — block it and replay only our chrome.
        'ph-no-capture w-full h-full border-none bg-white',
        !state.iframeLoaded.value && 'invisible',
        (modes.canvas || modes.comment || modes.text) && 'pointer-events-none',
      )}
    />
  );
}

/** Anchored annotations that render as DOM rather than into the canvas. */
function AnchoredOps({ frameDoc }: { frameDoc: Document | null | undefined }) {
  const scrollY = iframeScrollY.value;
  useFrameMarkPointer(useViewerFrame().meta.frameRef);
  return (
    <>
      <div class="absolute inset-0 pointer-events-none overflow-hidden">
        {deviceSelections.value.map((op) => (
          <WebSelectionHighlight key={op.id} op={op} scrollY={scrollY} frameDoc={frameDoc} />
        ))}
      </div>
      <div class="absolute inset-0 pointer-events-none overflow-hidden">
        {deviceAreas.value.map((op) => (
          <WebAreaShape key={op.id} op={op} scrollY={scrollY} frameDoc={frameDoc} />
        ))}
      </div>
    </>
  );
}

/**
 * The tool layers an author gets. One explicit variant instead of five `!readonly &&`
 * guards inline, so "what a guest cannot do" is a single boundary rather than a
 * condition repeated at every call site.
 */
function AuthoringLayers() {
  const {
    meta: { frameRef },
  } = useViewerFrame();
  return (
    <>
      <WebInspectorLayer frameRef={frameRef} />
      <WebMeasureLayer frameRef={frameRef} />
      <WebGuideLayer frameRef={frameRef} />
      <WebAreaLayer frameRef={frameRef} />
      <WebMultiInspectLayer frameRef={frameRef} />
    </>
  );
}

function TextPlacement() {
  const {
    actions: { canvasCoords },
    meta: { frameRef },
  } = useViewerFrame();
  const modes = pointerModes();
  return (
    <>
      <div
        class="absolute inset-0"
        style={{ pointerEvents: modes.text ? 'auto' : 'none', cursor: modes.text ? 'text' : 'default' }}
        onClick={(e) => {
          if (modes.tool !== 'text') return;
          textInput.value = canvasCoords(e);
        }}
      />
      {textInput.value && (
        <TextInputOverlay
          x={textInput.value.x}
          y={textInput.value.y}
          scrollY={iframeScrollY.value}
          onCommit={(text) => {
            if (text && textInput.value) {
              const { x, y } = textInput.value;
              pushDeviceOp({
                ...makeTextOp({
                  text,
                  x,
                  y,
                  color: color.value,
                  lineWidth: lineWidth.value,
                  viewport: frameViewport(frameRef.current),
                }),
                ...captureAnchors({ frame: frameRef.current, x, y }),
              });
            }
            textInput.value = null;
          }}
        />
      )}
    </>
  );
}

/** Everything drawn over the proxied page, in the page's own coordinate space. */
function PageSurface() {
  const { state, actions, meta } = useViewerFrame();
  const { canvasCoords, startDrawing } = actions;
  const { canvasRef, frameRef, innerRef } = meta;
  const modes = pointerModes();
  // Subscribe to the load flag before reading the document: it flips on every
  // (re)load, so the anchored overlays below always get the live document rather
  // than the one that happened to be current at the last unrelated render.
  state.iframeLoaded.value;
  const frameDoc = frameRef.current?.contentDocument;

  return (
    <div
      ref={innerRef}
      onWheel={isStillFrame.value ? undefined : forwardWheel}
      class="absolute top-0 left-0 will-change-transform"
      style={{
        width: deviceMode.value === 'desktop' ? originalWidth.value || '100%' : DEVICE_WIDTHS[deviceMode.value],
        height: `${100 / cssScale.value}%`,
        transform: cssScale.value !== 1 ? `scale(${cssScale.value})` : undefined,
        transformOrigin: 'top left',
      }}
    >
      <PageStatus />
      <ProxiedPage />

      <canvas
        ref={canvasRef}
        onMouseDown={startDrawing}
        class="absolute inset-0"
        style={{ pointerEvents: modes.canvas ? 'auto' : 'none', cursor: modes.canvas ? 'crosshair' : 'default' }}
      />

      <div
        class="absolute inset-0"
        style={{ pointerEvents: modes.comment ? 'auto' : 'none', cursor: modes.comment ? 'crosshair' : 'default' }}
        onClick={(e) => {
          if (modes.tool !== 'comment') return;
          // An open thread on a phone covers half the page: a tap beside it puts
          // the thread away rather than starting a second comment under it.
          if (compactChrome.value && annotationPanelOpen.value) {
            showAnnotationPanel.value = false;
            return;
          }
          const at = canvasCoords(e);
          const viewport = frameViewport(frameRef.current);
          const visualContext = commentContext({ pin: at, viewport: { x: 0, y: iframeScrollY.value, ...viewport }, layerId: activeLayer.peek(), ops: operations.peek(), device: deviceMode.peek(), doc: frameRef.current?.contentDocument ?? null });
          commentPopover.value = { ...at, visualContext, snapshot: shootPin({ frame: frameRef.current, at }) };
        }}
      >
        {deviceComments.value.map((c) => (
          <WebCommentPin key={c.id} op={c} scrollY={iframeScrollY.value} frameDoc={frameDoc} />
        ))}
      </div>

      <AnchoredOps frameDoc={frameDoc} />
      <TextPlacement />

      {!isReadonly.value && <AuthoringLayers />}
      <CursorLayer scrollY={iframeScrollY.value} />
      <PanLayer class="absolute inset-0 z-20" />
    </div>
  );
}

/** Starts the screenshot around a new pin, of what is on screen in the frame right now. */
function shootPin({ frame, at }: { frame: HTMLIFrameElement | null; at: { x: number; y: number } }) {
  // `clientWidth`, not `innerWidth`: the shot is cut from the root's own box, which stops short of the scrollbar.
  const width = frame?.contentDocument?.documentElement.clientWidth ?? 0;
  return snapshotPin({
    shoot: (crop) => shootFrame({ frame, crop }),
    pin: at,
    viewport: { x: 0, y: iframeScrollY.value, width, height: sameOriginWindow(frame)?.innerHeight ?? 0 },
    color: color.value,
    upload: uploadFile,
  });
}

/** The comment being written, if any. Its own component so the placement point
 *  narrows once for both the panel position and the element it binds to. */
function PendingComment({ frameRef }: { frameRef: { current: HTMLIFrameElement | null } }) {
  const at = commentPopover.value;
  if (!at) return null;
  const draft = {
    at,
    capture: () => ({
      ...captureAnchors({ frame: frameRef.current, x: at.x, y: at.y }),
      captureViewport: frameViewport(frameRef.current),
      visualContext: at.visualContext,
      layerId: at.visualContext?.layerId,
    }),
    push: pushDeviceOp,
    onClose: () => {
      commentPopover.value = null;
    },
    media: {
      upload: uploadFile,
      resolveUrl: fileUrl,
      voice: { transcribe: transcribeFile, constraint: audioConstraint },
      video: { upload: uploadVideo, transcribe: transcribeVideo },
      snapshot: at.snapshot,
    },
  };
  if (compactChrome.value) return <CommentSheet {...draft} />;
  return (
    <CommentPopover
      {...draft}
      anchorAt={{ x: at.x * cssScale.value, y: (at.y - iframeScrollY.value) * cssScale.value }}
    />
  );
}

const FRAME_SHADOW = 'shadow-[0_0_0_1px_rgba(0,0,0,0.08),0_8px_40px_rgba(0,0,0,0.12)]';

/** The sized viewport the page is previewed in, plus the popovers pinned to it. */
function DeviceFrame() {
  const {
    meta: { frameRef, viewerRef },
  } = useViewerFrame();
  const dev = deviceMode.value;
  const scale = cssScale.value;
  const width = originalWidth.value;
  const scaled = dev === 'desktop' ? width > 0 || scale !== 1 : true;

  return (
    <div
      id="viewer"
      ref={viewerRef}
      class={cn(
        // shrink-0: a docked panel must push the frame into the scroll area,
        // never compress it — a squeezed frame is no longer that viewport.
        'relative h-full mx-auto shrink-0',
        dev === 'desktop' ? (scaled ? FRAME_SHADOW : 'w-full overflow-hidden') : cn(FRAME_SHADOW, 'bg-white'),
      )}
      style={
        dev === 'desktop'
          ? width > 0
            ? { width: width * scale }
            : scale !== 1
              ? { width: `${scale * 100}%` }
              : undefined
          : { width: DEVICE_WIDTHS[dev] * scale }
      }
    >
      <PageSurface />

      <PendingComment frameRef={frameRef} />

      {selectionPopover.value && (
        <WebSelectionPopover
          {...selectionPopover.value}
          frameDoc={frameRef.current?.contentDocument}
          onClose={() => {
            selectionPopover.value = null;
          }}
        />
      )}
    </div>
  );
}

export function ViewerStage() {
  const {
    actions: { scrollToAnnotation },
    meta: { frameRef, viewerRef },
  } = useViewerFrame();
  useFrameRectTracker({ frameRef, viewerRef });
  const panels = { onScrollTo: scrollToAnnotation };
  const docked = panelsDocked.value;
  const Panel = compactChrome.value ? AnnotationSheet : AnnotationPanel;

  return (
    /* `mx-auto` (not `justify-center`) so flex auto-margins collapse on overflow
       — scroll starts at the page's left edge instead of clipping content. */
    <div class="flex-1 w-full relative min-h-0 bg-ml-bg-device">
      {/* The embedded board auto-fits its frame and offers no device widths, so
          a sideways scroller there can only ever be sub-pixel rounding. */}
      <div
        class={cn(
          'absolute inset-0 overflow-y-hidden flex items-stretch',
          isStillFrame.value ? 'overflow-x-hidden' : 'overflow-x-auto',
        )}
      >
        {docked && <DockedInfoPanel />}
        <DeviceFrame />
        {docked && <DockedAnnotationPanel {...panels} />}
      </div>

      {/* Flush sidebars, outside the scroller: they overlay the frame rather than
          compress it (a squeezed frame is no longer that viewport) and they stay
          put when the frame scrolls sideways under them. */}
      {!docked && <InfoPanel />}
      {!docked && <Panel {...panels} />}

      <DeviceOverview />
    </div>
  );
}
