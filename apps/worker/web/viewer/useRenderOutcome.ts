import { type Signal, useSignalEffect } from '@preact/signals';
import { useCallback, useRef } from 'preact/hooks';
import { capture } from '../analytics';
import { pageUrl } from '../signals';
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
 * Extracted from the viewer body, where this sat among six other concerns. It is
 * the one piece worth keeping together: the reveal signal, the two timers and the
 * telemetry are a single argument about what "rendered" means, and they were
 * previously three unrelated-looking blocks 100 lines apart.
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
}): {
  reportRenderFailure: (reason: RenderFailure, extra?: Record<string, unknown>) => void;
  reportRenderSuccess: () => void;
} {
  // Reset loading state when the proxied URL changes
  useSignalEffect(() => {
    pageUrl.value;
    iframeLoaded.value = false;
    renderFailed.value = null;
    pageSlow.value = false;
    renderReportedRef.current = false;
  });

  const renderStartRef = useRef(0);
  /** One outcome per page, first report wins — see `reportRenderSuccess`. */
  const renderReportedRef = useRef(false);
  const reportRenderFailure = useCallback((reason: RenderFailure, extra?: Record<string, unknown>) => {
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
  /**
   * The success half, and the reason it waits: a firewall challenge is served
   * with the proxy's marker on it, so `load` fires and looks like a clean render
   * until the page's own `ml-blocked` message arrives a task later. Reporting
   * immediately would have counted every blocked page as a success too, which is
   * exactly the number this event exists to be the denominator of.
   */
  const reportRenderSuccess = useCallback(() => {
    const at = performance.now();
    window.setTimeout(() => {
      if (renderReportedRef.current || renderFailed.peek()) return;
      renderReportedRef.current = true;
      capture('page_rendered', { host: hostOf(pageUrl.peek()), duration_ms: Math.round(at - renderStartRef.current) });
    }, 500);
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
    const host = () => hostOf(pageUrl.peek());
    /**
     * Show the frame. Only `timeout` is recoverable: a firewall notice arrives on
     * its own message and must outlive a marker that was served alongside the
     * challenge. Both reveal paths go through here so neither can drift.
     */
    let poll = 0;
    const reveal = (event?: string) => {
      window.clearInterval(poll);
      if (renderFailed.peek() === 'timeout') renderFailed.value = null;
      iframeLoaded.value = true;
      if (event) capture(event, { host: host() });
      reportRenderSuccess();
    };

    poll = window.setInterval(() => {
      const doc = frameRef.current?.contentDocument;
      if (doc?.documentElement?.dataset?.marklayer !== '1') return;
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
      const painted = doc?.documentElement?.dataset?.marklayer === '1' && (doc.body?.childElementCount ?? 0) > 0;
      if (painted) {
        reveal('page_render_revealed_while_loading');
        return;
      }
      pageSlow.value = true;
      capture('page_render_slow', { host: host() });
    }, SLOW_AFTER_MS);
    // Deliberately left running past this point: if the marker shows up at 32s the
    // poll above still recovers the page rather than stranding the failure screen
    // over it, which is what the old single timer did.
    const giveUp = window.setTimeout(() => {
      reportRenderFailure('timeout');
      if (!iframeLoaded.peek()) renderFailed.value = 'timeout';
    }, GIVE_UP_AFTER_MS);

    return () => {
      window.clearInterval(poll);
      clearTimeout(slow);
      clearTimeout(giveUp);
    };
  });

  return { reportRenderFailure, reportRenderSuccess };
}
