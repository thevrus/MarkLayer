import { pageErrors } from '@ext/lib/page-errors';
import { elementToolsUnavailable } from '@ext/lib/tool-state';
import { type Signal, useSignalEffect } from '@preact/signals';
import { useCallback, useRef } from 'preact/hooks';
import { hasFrameMarker, isDocumentFrame } from '../../shared/frame-protocol';
import { classifyProxyError } from '../../shared/proxy-errors';
import { capture } from '../analytics';
import { stillFrame } from '../docSource';
import { pageUrl } from '../projects';
import { isStillFrame } from '../viewer-state';
import type { RenderFailure } from '../viewerFrame';

/**
 * When to stop reassuring and start warning, and when to give up entirely.
 *
 * These used to be one 12s timer that did both, which made `timeout` the largest
 * failure bucket in the product while the proxy was answering 92% of fetches with
 * clean HTML at a 200ms median. Slow is not broken: the mark only changes the
 * copy, and the bound sits far enough out that a genuinely slow host still gets
 * to render.
 */
const SLOW_AFTER_MS = 12_000;
const GIVE_UP_AFTER_MS = 30_000;

/**
 * The host of the page being annotated, or `''` when there isn't one to name.
 *
 * Reported on every render outcome, success included, because without it a
 * failure rate is a number nobody can act on: "a fifth of renders fail" gives you
 * nothing to fix, while "these nine hosts fail and these four hundred don't" is a
 * work queue. Host only, never the path or query — the server side already
 * reports exactly this much for a site that refuses the proxy (`blockedDomain`),
 * and a bare hostname carries none of the private detail a full URL does. The
 * room id still never leaves.
 */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/**
 * Decide, and report, whether the proxied page actually rendered.
 *
 * The one owner of the frame's render state: the reveal, the failure screen, the two
 * timers and the telemetry are a single argument about what "rendered" means, so
 * nothing outside this hook writes `iframeLoaded` or `renderFailed`.
 */
export function useRenderOutcome({
  frameRef,
  iframeLoaded,
  renderFailed,
  pageSlow,
}: {
  frameRef: { current: HTMLIFrameElement | null };
  iframeLoaded: Signal<boolean>;
  renderFailed: Signal<RenderFailure | null>;
  pageSlow: Signal<boolean>;
}) {
  const renderStartRef = useRef(0);
  /** One outcome per page, first report wins — see `reportSuccess`. */
  const renderReportedRef = useRef(false);
  /** `ml-ready` has arrived, so any refusal from this page has too. */
  const readyRef = useRef(false);
  /** When the page came on screen, held until `ml-ready` can vouch for it. */
  const revealedAtRef = useRef<number | null>(null);

  // Reset loading state when the proxied URL changes
  useSignalEffect(() => {
    pageUrl.value;
    iframeLoaded.value = false;
    renderFailed.value = null;
    pageSlow.value = false;
    renderReportedRef.current = false;
    readyRef.current = false;
    revealedAtRef.current = null;
  });

  /** Sets the failure and reports it together, so neither a silent screen nor an unseen event can happen. */
  const failRender = useCallback((reason: RenderFailure, extra?: Record<string, unknown>) => {
    renderFailed.value = reason;
    if (renderReportedRef.current) return;
    renderReportedRef.current = true;
    capture('page_render_failed', {
      // Still no full `url` and no `annotation_id`: the annotated page can be
      // private and the room ID is an unlisted share credential. The host is the
      // one part that has to be here — see `hostOf`.
      reason,
      host: hostOf(pageUrl.peek()),
      duration_ms: Math.round(performance.now() - renderStartRef.current),
      ...extra,
    });
  }, []);

  const settleSuccess = useCallback(() => {
    const at = revealedAtRef.current;
    if (at === null || !readyRef.current || renderReportedRef.current || renderFailed.peek()) return;
    renderReportedRef.current = true;
    capture('page_rendered', { host: hostOf(pageUrl.peek()), duration_ms: Math.round(at - renderStartRef.current) });
  }, []);

  /**
   * The success half, and why it waits: a firewall challenge is served with the
   * proxy's marker on it, so the page looks like a clean render until its own
   * `ml-blocked` arrives. The proxy posts `ml-ready` after that notice, so hearing
   * it means there was none. Without the wait every blocked page would also count
   * as a success, which is the number this event exists to be the denominator of.
   */
  const frameReady = useCallback(() => {
    readyRef.current = true;
    settleSuccess();
  }, []);

  /** Show the frame. Only `timeout` is recoverable: a firewall notice can land before `load` and has to survive it. */
  const reveal = useCallback((event?: string) => {
    if (renderFailed.peek() === 'timeout') renderFailed.value = null;
    iframeLoaded.value = true;
    if (event) capture(event, { host: hostOf(pageUrl.peek()) });
    revealedAtRef.current ??= performance.now();
    settleSuccess();
  }, []);

  /** The frame's `load`: the proxy stamps its marker on success, so a missing one means an error response was served. */
  const frameLoaded = useCallback(() => {
    if (!pageUrl.peek()) {
      iframeLoaded.value = true;
      return;
    }
    const doc = frameRef.current?.contentDocument;
    // The tools and device sizes that act on an element tree come off for a document.
    elementToolsUnavailable.value = isDocumentFrame(doc);
    if (elementToolsUnavailable.value) pageErrors.value = [];
    if (isStillFrame.value && doc) stillFrame(doc);
    if (hasFrameMarker(doc)) {
      reveal();
      return;
    }
    iframeLoaded.value = true;
    failRender('no-marker', {
      proxy_error: classifyProxyError(doc?.body?.textContent),
      // Tells a blank proxy body from a frame that navigated cross-origin and left the proxy;
      // only the second is a page escaping it, which decides whether there is anything to fix.
      doc_reachable: Boolean(doc),
    });
  }, []);

  const frameErrored = useCallback(() => failRender('iframe-error'), []);

  /** Back to the loader while the frame refetches the same page. */
  const markLoading = useCallback(() => {
    iframeLoaded.value = false;
  }, []);

  useSignalEffect(() => {
    const url = pageUrl.value;
    const loaded = iframeLoaded.value;
    if (!url || loaded) return;
    renderStartRef.current = performance.now();

    // Why poll instead of trusting `load`: the iframe's load event waits for every
    // sub-resource, so a single hung font or tracking pixel routed through /px/
    // keeps it from ever firing on a page that is already fully painted. That is
    // the actual shape of most "render failures" here — the proxy had the HTML and
    // the page was on screen, but the last request never settled. The marker the
    // proxy injects lands during parse, so watching for it reports what the user
    // can already see.
    const poll = window.setInterval(() => {
      const doc = frameRef.current?.contentDocument;
      if (!hasFrameMarker(doc) || !doc) return;
      // The marker is injected at the very top of <head>, so on its own it only
      // proves the response arrived — revealing the frame there shows a blank
      // white box. `readyState` leaving 'loading' is DOMContentLoaded: the DOM is
      // parsed and the page is genuinely on screen, and unlike `load` it does not
      // wait on the sub-resources that were never the point.
      if (doc.readyState === 'loading') return;
      reveal();
    }, 250);

    const slow = window.setTimeout(() => {
      // Last resort before the loader starts lying: if the page is painted, show
      // it, whatever `readyState` claims. A parser-blocking script routed through
      // /px/ that never resolves pins `readyState` at 'loading' for the life of the
      // tab, so the DOMContentLoaded gate above never opens on a page the user
      // could have been annotating for twelve seconds.
      const doc = frameRef.current?.contentDocument;
      if (hasFrameMarker(doc) && (doc?.body?.childElementCount ?? 0) > 0) {
        reveal('page_render_revealed_while_loading');
        return;
      }
      pageSlow.value = true;
      capture('page_render_slow', { host: hostOf(pageUrl.peek()) });
    }, SLOW_AFTER_MS);
    // Deliberately left running past this point: if the marker shows up at 30s the
    // poll above still recovers the page rather than stranding the failure screen
    // over it, which is what the old single timer did.
    const giveUp = window.setTimeout(() => failRender('timeout'), GIVE_UP_AFTER_MS);

    return () => {
      window.clearInterval(poll);
      clearTimeout(slow);
      clearTimeout(giveUp);
    };
  });

  return { failRender, frameLoaded, frameErrored, frameReady, markLoading };
}
