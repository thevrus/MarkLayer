import { CommentPopover } from '@ext/components/CommentPopover';
import { PanLayer } from '@ext/components/PanLayer';
import { activeTool, color, lineWidth, panScrollBy, toolPaintsCanvas } from '@ext/lib/state';
import type { TextOp } from '@ext/lib/types';
import { cn } from '@marklayer/types';
import { Loader2 } from 'lucide-preact';
import { nanoid } from 'nanoid';
import { classifyProxyError } from '../src/proxy-errors';
import { AnnotationPanel, DockedAnnotationPanel } from './AnnotationPanel';
import { CursorLayer } from './CursorLayer';
import { frameViewport, pickFrameTarget } from './iframeOverlay';
import { Logo, TextInputOverlay } from './shared';
import {
  commentPopover,
  cssScale,
  DEVICE_WIDTHS,
  deviceAreas,
  deviceComments,
  deviceMode,
  deviceSelections,
  iframeScrollY,
  isReadonly,
  originalWidth,
  pageUrl,
  pushDeviceOp,
  selectionPopover,
  textInput,
} from './signals';
import { DockedInfoPanel, InfoPanel } from './ViewerInfoPanel';
import { useViewerFrame } from './viewerFrame';
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
  // Firefox reports lines, and a page gesture reports pages; both need real pixels.
  const step = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1;
  e.preventDefault();
  panScrollBy.value?.(0, e.deltaY * step);
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

/**
 * Scroll container + `min-h-full` inner, rather than a centred flex box: the
 * ancestor clips on the y axis, so in a short device preview a centred box would
 * have its top and bottom shaved off with no way to reach them. This centres when
 * there is room and scrolls, padding intact, when there is not.
 */
function PageFailure() {
  const { state } = useViewerFrame();
  const copy = state.failureCopy.value;
  return (
    <div class="absolute inset-0 z-10 overflow-y-auto bg-ml-bg-viewer">
      <div class="min-h-full flex flex-col items-center justify-center gap-4 px-8 py-10 text-center">
        <Logo size={48} />
        <h2 class="text-body font-semibold text-ml-fg m-0">{copy.title}</h2>
        <p class="text-ui text-ml-fg/70 max-w-md leading-snug m-0">{copy.body}</p>
        {/* Our relay's own address, so the ask is one specific IP rather than
            "allow Cloudflare", which is every Worker on the platform. */}
        {state.renderFailed.value === 'firewall' && state.blockedEgressIp.value && (
          <p class="text-ui text-ml-fg/70 max-w-md leading-snug m-0">
            Own this site? Your host can allow MarkLayer with one address:{' '}
            <code class="px-1.5 py-0.5 rounded bg-ml-fg/8 font-mono text-meta text-ml-fg">
              {state.blockedEgressIp.value}
            </code>
            .
          </p>
        )}
        {/* One primary action; the escape route is a text link rather than a
            second outlined button, so the recovery path has a clear rank. */}
        <div class="flex flex-col items-center gap-3">
          <a
            href={pageUrl.value}
            target="_blank"
            rel="noreferrer"
            class="px-4 py-2 rounded-lg bg-ml-btn text-ml-btn-fg text-ui font-medium no-underline hover:bg-ml-btn-hover transition-colors"
          >
            Open original site
          </a>
          <a href="/" class="text-ui text-ml-fg/70 underline underline-offset-2 hover:text-ml-fg transition-colors">
            Back home
          </a>
        </div>
      </div>
    </div>
  );
}

function PageLoading() {
  return (
    <div class="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-ml-bg-viewer">
      <Logo size={48} />
      <Loader2 size={32} class="animate-spin text-ml-accent" aria-hidden="true" />
      <p class="text-ui text-ml-fg/70">Loading page…</p>
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
      src={pageUrl.value ? `/proxy?url=${encodeURIComponent(pageUrl.value)}` : undefined}
      sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
      onLoad={() => {
        state.iframeLoaded.value = true;
        if (!pageUrl.value) return;
        // Proxy injects data-marklayer="1" on success; missing marker means an error response was served.
        const doc = meta.frameRef.current?.contentDocument;
        if (doc?.documentElement?.dataset?.marklayer === '1') {
          actions.reportRenderSuccess();
          return;
        }
        actions.reportRenderFailure('no-marker', { proxy_error: classifyProxyError(doc?.body?.textContent) });
        state.renderFailed.value = 'no-marker';
      }}
      onError={() => {
        actions.reportRenderFailure('iframe-error');
        state.renderFailed.value = 'iframe-error';
      }}
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
  return (
    <>
      <div class="absolute inset-0 pointer-events-none overflow-hidden">
        {deviceSelections.value.map((op) => (
          <WebSelectionHighlight key={op.id} op={op} scale={1} scrollY={scrollY} frameDoc={frameDoc} />
        ))}
      </div>
      <div class="absolute inset-0 pointer-events-none overflow-hidden">
        {deviceAreas.value.map((op) => (
          <WebAreaShape key={op.id} op={op} scale={1} scrollY={scrollY} frameDoc={frameDoc} />
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
      onWheel={forwardWheel}
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
          commentPopover.value = canvasCoords(e);
        }}
      >
        {deviceComments.value.map((c) => (
          <WebCommentPin key={c.id} op={c} scale={1} scrollY={iframeScrollY.value} frameDoc={frameDoc} />
        ))}
      </div>

      <AnchoredOps frameDoc={frameDoc} />
      <TextPlacement />

      {!isReadonly.value && <AuthoringLayers />}
      <CursorLayer scale={1} scrollY={iframeScrollY.value} />
      <PanLayer class="absolute inset-0 z-20" />
    </div>
  );
}

/** The comment being written, if any. Its own component so the placement point
 *  narrows once for both the panel position and the element it binds to. */
function PendingComment({ frameRef }: { frameRef: { current: HTMLIFrameElement | null } }) {
  const at = commentPopover.value;
  if (!at) return null;
  return (
    <CommentPopover
      at={at}
      anchorAt={{ x: at.x * cssScale.value, y: (at.y - iframeScrollY.value) * cssScale.value }}
      capture={() => ({
        target: pickFrameTarget({ frame: frameRef.current, x: at.x, y: at.y }),
        captureViewport: frameViewport(frameRef.current),
      })}
      push={pushDeviceOp}
      onClose={() => {
        commentPopover.value = null;
      }}
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
    actions: { buildExportData, scrollToAnnotation },
  } = useViewerFrame();
  const panels = { onScrollTo: scrollToAnnotation, getExportData: buildExportData };
  const desktop = deviceMode.value === 'desktop';

  return (
    /* `mx-auto` (not `justify-center`) so flex auto-margins collapse on overflow
       — scroll starts at the page's left edge instead of clipping content. */
    <div class="flex-1 w-full relative min-h-0 bg-ml-bg-device">
      <div class="absolute inset-0 overflow-x-auto overflow-y-hidden flex items-stretch">
        {!desktop && <DockedInfoPanel />}
        <DeviceFrame />
        {!desktop && <DockedAnnotationPanel {...panels} />}
      </div>

      {/* Flush sidebars, outside the scroller: they overlay the frame rather than
          compress it (a squeezed frame is no longer that viewport) and they stay
          put when the frame scrolls sideways under them. */}
      {desktop && <InfoPanel />}
      {desktop && <AnnotationPanel {...panels} />}
    </div>
  );
}
