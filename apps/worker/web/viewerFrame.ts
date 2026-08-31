import type { Point } from '@ext/lib/types';
import type { ReadonlySignal, Signal } from '@preact/signals';
import { createContext } from 'preact';
import { useContext } from 'preact/hooks';
import type { ExportData } from './AnnotationPanel';

/** Why the page never rendered. One list: the signal holds it, telemetry reports it. */
export type RenderFailure = 'timeout' | 'no-marker' | 'iframe-error' | 'firewall' | 'upstream-error';

/**
 * What the failure panel says. Keyed by cause rather than resolved inline, so a
 * new cause is one entry rather than another branch in the resolver.
 */
export const FAILURE_COPY = {
  firewall: {
    title: "This site's firewall blocked us",
    body: 'The host answered our request with a security challenge instead of the page, so there was nothing to show. The annotations are saved — open them with the MarkLayer extension on the live site, which loads the page in your own browser.',
  },
  hostile: {
    title: 'This site blocks embedding',
    body: 'Sites like YouTube, TikTok, Instagram, and X refuse to load inside other pages. The annotations are saved — install the MarkLayer extension to view them on the live site.',
  },
  'upstream-error': {
    // Distinct from `firewall` on purpose: telling someone a firewall blocked us
    // when the site simply 404'd sends them arguing with their host over nothing.
    title: 'This page returned an error',
    body: 'The site answered our request with an error rather than the page, so there was nothing to show. The annotations are saved — check the URL is still live, or open them with the extension.',
  },
  generic: {
    title: "We couldn't load this page",
    body: 'The page took too long, was blocked, or returned an error. The annotations are saved — try the extension on the live page, or share a different URL.',
  },
} as const;

/** Refs and signals are structural on purpose — every consumer only reads `.current`. */
type Ref<T> = { current: T | null };

interface ViewerFrameState {
  iframeLoaded: Signal<boolean>;
  renderFailed: Signal<RenderFailure | null>;
  /** Past the slow mark but not given up on, so the loader can say so. */
  pageSlow: Signal<boolean>;
  /**
   * The egress address the host's firewall named in its challenge, when it named
   * one — the only detail that turns "it broke" into something the owner can act on.
   */
  blockedEgressIp: Signal<string | null>;
  failureCopy: ReadonlySignal<{ readonly title: string; readonly body: string }>;
  zoomMenuOpen: Signal<boolean>;
}

interface ViewerFrameActions {
  /** Screen coordinates → page coordinates, undoing the frame offset and CSS scale. */
  canvasCoords: (e: MouseEvent) => Point;
  startDrawing: (e: MouseEvent) => void;
  share: () => void;
  scrollToAnnotation: (x: number, y: number) => void;
  buildExportData: () => ExportData;
  reportRenderFailure: (reason: RenderFailure, extra?: Record<string, unknown>) => void;
  /** The other half of the pair — without it a failure rate has no denominator. */
  reportRenderSuccess: () => void;
}

interface ViewerFrameMeta {
  frameRef: Ref<HTMLIFrameElement>;
  canvasRef: Ref<HTMLCanvasElement>;
  innerRef: Ref<HTMLDivElement>;
  viewerRef: Ref<HTMLDivElement>;
}

/**
 * The contract between `Viewer` — the one place that knows how any of this is
 * wired — and the chrome, stage and HUD it composes. Split `state` / `actions` /
 * `meta` so a consumer destructures the one part it needs rather than taking a
 * dozen props threaded down through the tree.
 */
export interface ViewerFrame {
  state: ViewerFrameState;
  actions: ViewerFrameActions;
  meta: ViewerFrameMeta;
}

const ViewerFrameContext = createContext<ViewerFrame | null>(null);

export const ViewerFrameProvider = ViewerFrameContext.Provider;

export function useViewerFrame(): ViewerFrame {
  const frame = useContext(ViewerFrameContext);
  // Throwing narrows the type without an assertion, and a missing provider is a
  // wiring bug that should surface loudly rather than as a null read later.
  if (!frame) throw new Error('useViewerFrame() called outside <ViewerFrameProvider>');
  return frame;
}
