import { buildStoredDiagnosis, sanitizeDiagnosis } from '@marklayer/agent-tools/diagnosis';
import { type Diagnosis, opAnchor } from '@marklayer/types/ops';
import { MAX_DIAGNOSIS_RECENT } from '@marklayer/types/relay';
import { networkErrorsForPage } from './net-errors';
import { errorsForPage } from './page-errors';
import { annotatedUrl } from './page-url';
import { captureTarget, getSelector, isExtensionElement } from './selector';
import type { AnnotationOp } from './types';

function locateTarget(op: AnnotationOp): Element | null {
  /** An inspect annotation carries selector/rect instead of an anchor target. */
  const target = 'target' in op ? op.target : undefined;
  if (!target) return null;
  const search = (root: Document | ShadowRoot): Element | null => {
    try {
      const direct = root.querySelector(target.selector);
      if (direct) return direct;
    } catch {
      /* A stale selector is normal after a redesign. */
    }
    for (const el of root.querySelectorAll('*')) {
      if (el.shadowRoot) {
        const nested = search(el.shadowRoot);
        if (nested) return nested;
      }
      if (el instanceof HTMLIFrameElement) {
        try {
          const nested = el.contentDocument && search(el.contentDocument);
          if (nested) return nested;
        } catch {
          /* Cross-origin frames remain an explicit boundary. */
        }
      }
    }
    return null;
  };
  return search(document);
}

function depths(el: Element | null): { iframeDepth: number; shadowDepth: number } {
  let iframeDepth = 0;
  let shadowDepth = 0;
  let doc = el?.ownerDocument;
  let root: Node | null = el?.getRootNode() ?? null;
  while (root instanceof ShadowRoot) {
    shadowDepth += 1;
    root = root.host.getRootNode();
  }
  while (doc?.defaultView?.frameElement) {
    iframeDepth += 1;
    doc = doc.defaultView.frameElement.ownerDocument;
  }
  return { iframeDepth, shadowDepth };
}

/** Capture current DOM hit testing plus the page and request buffers for a card's annotation. */
export function captureDiagnosis(op: AnnotationOp, capturedAt = Date.now()): Diagnosis {
  const element = locateTarget(op);
  const liveTarget = element ? captureTarget({ el: element }) : undefined;
  const sourceOp = liveTarget ? ({ ...op, target: liveTarget } as AnnotationOp) : op;
  const base = buildStoredDiagnosis(sourceOp, capturedAt, annotatedUrl.value ?? location.href);
  const doc = element?.ownerDocument ?? document;
  const root = element?.getRootNode();
  const hitRoot = root && 'elementsFromPoint' in root ? (root as Document | ShadowRoot) : doc;
  const win = doc.defaultView ?? window;
  const rect = element?.getBoundingClientRect();
  const anchor = opAnchor(op);
  const x = rect ? rect.left + rect.width / 2 : (anchor?.x ?? 0) - win.scrollX;
  const y = rect ? rect.top + rect.height / 2 : (anchor?.y ?? 0) - win.scrollY;
  const pageHits = hitRoot.elementsFromPoint(x, y).filter((hit) => !isExtensionElement(hit));
  const chain = pageHits.slice(0, 8).map((hit) => {
    const style = (doc.defaultView ?? window).getComputedStyle(hit);
    return {
      selector: getSelector(hit),
      tag: hit.tagName.toLowerCase(),
      pointerEvents: style.pointerEvents,
      position: style.position,
      zIndex: style.zIndex,
      opacity: style.opacity,
      visibility: style.visibility,
    };
  });
  // The extension's own shadow overlay sits above the page and must not count as a page obstruction.
  const pointHit = hitRoot.elementFromPoint(x, y);
  const hit = pointHit && !isExtensionElement(pointHit) ? pointHit : (pageHits[0] ?? null);
  const covered = Boolean(element && hit && hit !== element && !element.contains(hit));
  return sanitizeDiagnosis({
    ...base,
    source: 'live-page',
    ...(liveTarget ? { target: liveTarget } : {}),
    ...(element ? { hierarchy: depths(element) } : {}),
    hitTest: {
      covered,
      ...(hit ? { hit: { selector: getSelector(hit), tag: hit.tagName.toLowerCase() } } : {}),
      chain,
    },
    pageErrorCount: errorsForPage().length,
    pageErrors: errorsForPage().slice(-MAX_DIAGNOSIS_RECENT),
    networkFailureCount: networkErrorsForPage().length,
    networkFailures: networkErrorsForPage().slice(-MAX_DIAGNOSIS_RECENT),
    viewport: {
      devicePixelRatio: win.devicePixelRatio || 1,
      scale: win.visualViewport?.scale ?? 1,
      scrollX: win.scrollX,
      scrollY: win.scrollY,
    },
    partial: !element || !hit,
  });
}

export const diagnosisMarkdown = (diagnosis: Diagnosis): string =>
  `# MarkLayer diagnosis\n\n${JSON.stringify(diagnosis, null, 2)}`;
