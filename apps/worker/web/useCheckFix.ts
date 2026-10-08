import { checkRequest, flashAnnotation } from '@ext/lib/checkFix';
import { operations } from '@ext/lib/state';
import { type Signal, useSignalEffect } from '@preact/signals';
import type { RefObject } from 'preact';
import { resolveAnchors } from './iframeOverlay';

/**
 * "Check it": reload the proxied page so it shows what the agent changed, then
 * scroll to the annotation and light its pin. The reload is the whole point
 * here: unlike the extension, the frame is a cached copy of someone else's
 * page, and nothing the agent did can show up without fetching it again.
 */
export function useCheckFix({
  frameRef,
  iframeLoaded,
  scrollTo,
}: {
  frameRef: RefObject<HTMLIFrameElement>;
  iframeLoaded: Signal<boolean>;
  scrollTo: (x: number, y: number) => void;
}) {
  useSignalEffect(() => {
    const id = checkRequest.value;
    if (!id) return;
    checkRequest.value = null;
    const frame = frameRef.current;
    if (!frame) return;

    frame.addEventListener(
      'load',
      () => {
        const op = operations.peek().find((o) => o.id === id);
        const doc = frame.contentDocument;
        if (op?.tool !== 'comment' || !doc) return;
        // A frame tick later, so the page has laid out before the anchor is measured.
        requestAnimationFrame(() => {
          const { x, y } = resolveAnchors({ target: op.target, pdf: op.pdf, docX: op.x, docY: op.y, doc });
          scrollTo(x, y);
          flashAnnotation(id);
        });
      },
      { once: true },
    );
    iframeLoaded.value = false;
    // `reload()` is blocked on a cross-origin document; reassigning `src` is not.
    try {
      frame.contentWindow?.location.reload();
    } catch {
      const { src } = frame;
      frame.src = src;
    }
  });
}
