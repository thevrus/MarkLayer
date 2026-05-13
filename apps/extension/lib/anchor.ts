import type { CaptureViewport, TargetElement } from '@marklayer/types';
import { textFingerprint } from './selector';

// Re-anchor element-bound ops against the page's CURRENT layout using the
// optional selector + offsetX/offsetY recorded at capture time; fall back to
// stored doc coords when nothing resolves.

export interface AnchorContext {
  doc?: Document;
  win?: Window;
}

/** `primary` = stored selector matched; `text` = tag+text fingerprint fallback. */
export type AnchorStrategy = 'primary' | 'text';

export interface ResolvedAnchor {
  x: number;
  y: number;
  strategy: AnchorStrategy;
}

const TEXT_FALLBACK_SCAN_LIMIT = 1000;

// Memo keyed by the op's stable `target` reference. WeakMap so dropped ops
// don't pin elements. Fast path: `isConnected` is the only DOM call.
const RESOLVE_MEMO = new WeakMap<TargetElement, { el: Element; strategy: AnchorStrategy }>();

// Squared distance from `el`'s current center to the captured center —
// tiebreaker when text-fingerprint matches multiple nodes.
function distanceToCaptured(el: Element, target: TargetElement, win: Window): number {
  const cap = target.rect;
  if (!cap) return Number.POSITIVE_INFINITY;
  const r = el.getBoundingClientRect();
  const cx = r.x + r.width / 2 + win.scrollX;
  const cy = r.y + r.height / 2 + win.scrollY;
  const tx = cap.x + cap.width / 2;
  const ty = cap.y + cap.height / 2;
  const dx = cx - tx;
  const dy = cy - ty;
  return dx * dx + dy * dy;
}

// Two-phase scan: cheap `textContent` substring prefilter, then `innerText`
// verification via the same `textFingerprint` used at capture time so the
// algorithms stay in lockstep. Ties broken by closest-to-captured-rect.
function findByTextFingerprint(target: TargetElement, doc: Document, win: Window): Element | null {
  if (!target.tag || !target.text) return null;
  let nodes: NodeListOf<Element>;
  try {
    nodes = doc.querySelectorAll(target.tag);
  } catch {
    return null;
  }
  const limit = Math.min(nodes.length, TEXT_FALLBACK_SCAN_LIMIT);
  // Cheap textContent prefilter before paying for innerText; skip on short
  // fingerprints (e.g. "Submit") which would match everything.
  const probe = target.text.slice(0, Math.min(25, target.text.length));
  const usePrefilter = probe.length >= 12;

  const verified: Element[] = [];
  for (let i = 0; i < limit; i++) {
    const el = nodes[i];
    if (usePrefilter && !el.textContent?.includes(probe)) continue;
    if (textFingerprint(el) === target.text) verified.push(el);
  }
  if (verified.length === 0) return null;
  if (verified.length === 1) return verified[0];
  // Multiple matches: pick the closest to where the user drew.
  let best = verified[0];
  let bestD = distanceToCaptured(best, target, win);
  for (let i = 1; i < verified.length; i++) {
    const d = distanceToCaptured(verified[i], target, win);
    if (d < bestD) {
      best = verified[i];
      bestD = d;
    }
  }
  return best;
}

// Reproject an op's element anchor against the element's CURRENT rect.
// `fallback` is the stored doc-px anchor; for legacy ops without offsetX/Y we
// reconstruct the offset from `fallback - target.rect.topLeft` so they still
// re-anchor against layout shifts.
export function resolveAnchorPoint(
  target: TargetElement | undefined,
  ctx?: AnchorContext,
  fallback?: { docX: number; docY: number },
): ResolvedAnchor | null {
  if (!target?.selector) return null;
  let offsetX = target.offsetX;
  let offsetY = target.offsetY;
  if ((offsetX === undefined || offsetY === undefined) && target.rect && fallback) {
    offsetX = fallback.docX - target.rect.x;
    offsetY = fallback.docY - target.rect.y;
  }
  if (offsetX === undefined || offsetY === undefined) return null;
  const doc = ctx?.doc ?? document;
  const win = ctx?.win ?? doc.defaultView ?? window;

  const memo = RESOLVE_MEMO.get(target);
  if (memo?.el.isConnected && memo.el.ownerDocument === doc) {
    const rect = memo.el.getBoundingClientRect();
    return {
      x: rect.x + win.scrollX + offsetX,
      y: rect.y + win.scrollY + offsetY,
      strategy: memo.strategy,
    };
  }

  let el: Element | null = null;
  let strategy: AnchorStrategy = 'primary';
  try {
    el = doc.querySelector(target.selector);
  } catch {
    el = null;
  }
  if (!el?.isConnected) {
    el = findByTextFingerprint(target, doc, win);
    strategy = 'text';
  }
  if (!el?.isConnected) {
    RESOLVE_MEMO.delete(target);
    return null;
  }
  RESOLVE_MEMO.set(target, { el, strategy });
  const rect = el.getBoundingClientRect();
  return {
    x: rect.x + win.scrollX + offsetX,
    y: rect.y + win.scrollY + offsetY,
    strategy,
  };
}

// Returns the resolved point plus the delta from the op's stored anchor —
// callers shift either a single point (pin) or a multi-rect shape by the
// delta. When resolution fails, returns the fallback with zero delta.
export interface AnchorDelta {
  x: number;
  y: number;
  dx: number;
  dy: number;
  strategy: AnchorStrategy | null;
}
export function applyAnchorDelta(
  target: TargetElement | undefined,
  fallback: { docX: number; docY: number },
  ctx?: AnchorContext,
): AnchorDelta {
  const anchor = resolveAnchorPoint(target, ctx, fallback);
  if (!anchor) return { x: fallback.docX, y: fallback.docY, dx: 0, dy: 0, strategy: null };
  return {
    x: anchor.x,
    y: anchor.y,
    dx: anchor.x - fallback.docX,
    dy: anchor.y - fallback.docY,
    strategy: anchor.strategy,
  };
}

// No-op for now — the previous `currentWidth/capturedWidth` heuristic drifted
// badly on long pages (page height doesn't track viewport width). Canvas ops
// stay at their captured doc coords; signature is kept so callers can adopt a
// future per-op element anchor without churn.
export function captureScale(_captureViewport: CaptureViewport | undefined): number {
  return 1;
}
