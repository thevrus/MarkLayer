import {
  type CaptureViewport,
  type DrawOp,
  opAnchorPoint,
  type SelectionRect,
  type TargetElement,
} from '@marklayer/types';
import { captureTarget, pickElementAtPoint, textFingerprint } from './selector';
import { anchorGeneration, pushOp } from './state';

// Re-anchor element-bound ops against the page's CURRENT layout using the
// optional selector + offsetX/offsetY recorded at capture time; fall back to
// stored doc coords when nothing resolves.
//
// The anchor point is reprojected FRACTIONALLY: `offsetX/offsetY` were
// captured as an absolute doc-px offset from the target element's top-left,
// but on a responsive reflow the element's box can resize between capture
// and re-anchor. Scaling the stored offset by `currentSize / capturedSize`
// keeps the point at the same relative position inside the element's box
// (and lets area/selection sizes scale along with it) instead of drifting
// off the element as it grows or shrinks. When no captured size is known —
// or the element hasn't changed size — the scale is 1 and this degrades to
// the previous absolute-offset behavior exactly.

export interface AnchorContext {
  doc?: Document;
  win?: Window;
}

/** `primary` = stored selector matched; `text` = tag+text fingerprint fallback. */
export type AnchorStrategy = 'primary' | 'text';

export interface ResolvedAnchor {
  x: number;
  y: number;
  /** Current element size / captured element size (X axis). 1 when unknown. */
  scaleX: number;
  /** Current element size / captured element size (Y axis). 1 when unknown. */
  scaleY: number;
  strategy: AnchorStrategy;
}

const TEXT_FALLBACK_SCAN_LIMIT = 1000;

// Memo keyed by the op's stable `target` reference. WeakMap so dropped ops
// don't pin elements. Fast path: `isConnected` is the only DOM call.
// Failures are memoized too: an unresolvable anchor would otherwise re-run the
// full-document text-fingerprint scan (innerText over up to 1000 candidates)
// on every redraw — at scroll frequency for one orphaned op. A selector can
// only start matching after the DOM changes, so a failure stays cached until
// the mutation observer bumps the generation.
type ResolveMemo = { el: Element; strategy: AnchorStrategy } | { failedGen: number };
const RESOLVE_MEMO = new WeakMap<TargetElement, ResolveMemo>();

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
    if (!el) continue;
    if (usePrefilter && !el.textContent?.includes(probe)) continue;
    if (textFingerprint(el) === target.text) verified.push(el);
  }
  let best = verified[0];
  if (!best) return null;
  if (verified.length === 1) return best;
  // Multiple matches: pick the closest to where the user drew.
  let bestD = distanceToCaptured(best, target, win);
  for (let i = 1; i < verified.length; i++) {
    const candidate = verified[i];
    if (!candidate) continue;
    const d = distanceToCaptured(candidate, target, win);
    if (d < bestD) {
      best = candidate;
      bestD = d;
    }
  }
  return best;
}

// Element-relative scale factors for the current re-anchor: how much the
// target's box has grown/shrunk since capture, per axis. Guarded so a missing
// captured rect or a zero-size box (display:none, not-yet-laid-out) degrades
// to 1 (today's absolute-offset behavior) rather than exploding the
// reprojected point.
function elementScale({ rect, target }: { rect: DOMRect; target: TargetElement }): {
  scaleX: number;
  scaleY: number;
} {
  const cap = target.rect;
  if (!cap || !(cap.width > 0) || !(cap.height > 0) || !(rect.width > 0) || !(rect.height > 0)) {
    return { scaleX: 1, scaleY: 1 };
  }
  return { scaleX: rect.width / cap.width, scaleY: rect.height / cap.height };
}

// Reproject the stored offset against the element's CURRENT rect as a
// fraction of its (possibly resized) box — shared by both the memo-hit and
// fresh-resolve paths so they can never drift out of lockstep.
function projectAnchor({
  rect,
  win,
  target,
  offsetX,
  offsetY,
  strategy,
}: {
  rect: DOMRect;
  win: Window;
  target: TargetElement;
  offsetX: number;
  offsetY: number;
  strategy: AnchorStrategy;
}): ResolvedAnchor {
  const { scaleX, scaleY } = elementScale({ rect, target });
  return {
    x: rect.x + win.scrollX + offsetX * scaleX,
    y: rect.y + win.scrollY + offsetY * scaleY,
    scaleX,
    scaleY,
    strategy,
  };
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
  if (memo && 'el' in memo && memo.el.isConnected && memo.el.ownerDocument === doc) {
    const rect = memo.el.getBoundingClientRect();
    return projectAnchor({ rect, win, target, offsetX, offsetY, strategy: memo.strategy });
  }
  if (memo && 'failedGen' in memo && memo.failedGen === anchorGeneration()) return null;

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
    RESOLVE_MEMO.set(target, { failedGen: anchorGeneration() });
    return null;
  }
  RESOLVE_MEMO.set(target, { el, strategy });
  const rect = el.getBoundingClientRect();
  return projectAnchor({ rect, win, target, offsetX, offsetY, strategy });
}

// Returns the resolved point plus the delta from the op's stored anchor —
// callers shift either a single point (pin) or a multi-rect shape by the
// delta. When resolution fails, returns the fallback with zero delta.
export interface AnchorDelta {
  x: number;
  y: number;
  dx: number;
  dy: number;
  /** Element-relative size scale since capture (X axis). 1 when unresolved. */
  scaleX: number;
  /** Element-relative size scale since capture (Y axis). 1 when unresolved. */
  scaleY: number;
  strategy: AnchorStrategy | null;
}
export function applyAnchorDelta(
  target: TargetElement | undefined,
  fallback: { docX: number; docY: number },
  ctx?: AnchorContext,
): AnchorDelta {
  const anchor = resolveAnchorPoint(target, ctx, fallback);
  if (!anchor) return { x: fallback.docX, y: fallback.docY, dx: 0, dy: 0, scaleX: 1, scaleY: 1, strategy: null };
  return {
    x: anchor.x,
    y: anchor.y,
    dx: anchor.x - fallback.docX,
    dy: anchor.y - fallback.docY,
    scaleX: anchor.scaleX,
    scaleY: anchor.scaleY,
    strategy: anchor.strategy,
  };
}

// Bind a freshly-committed op to whatever page element sits under its
// representative point (see `opAnchorPoint`) so it survives responsive reflow.
// No-op when the op has no anchor point, already carries a target, or nothing
// real sits under it — the op is then stored exactly as it was.
//
// Deliberately NOT folded into `pushOp`: the web viewer shares that write path
// but renders the annotated page inside an iframe, so resolving against the
// top-level document there would anchor ops to the viewer chrome.
export function attachTarget(op: DrawOp, ctx?: AnchorContext): void {
  if (!('target' in op) || op.target) return;
  const anchor = opAnchorPoint(op);
  if (!anchor) return;
  const win = ctx?.win ?? window;
  const el = pickElementAtPoint(anchor.x - win.scrollX, anchor.y - win.scrollY, ctx?.doc);
  if (el) op.target = captureTarget(el, anchor);
}

/** Bind a finished op to the element under its anchor, then commit it. */
export function commitOp(op: DrawOp, ctx?: AnchorContext): void {
  attachTarget(op, ctx);
  pushOp(op);
}

export interface ReprojectedRects {
  /** Re-anchored top-left of the FIRST rect, in doc px. */
  x: number;
  y: number;
  /** Every rect re-anchored and size-scaled, in doc px. */
  rects: SelectionRect[];
  /** Bounding box over `rects`, in doc px. */
  bounds: { x: number; y: number; width: number; height: number };
  strategy: AnchorStrategy | null;
}

// Re-anchor a multi-rect shape (a text selection) against its target element's
// current box. The stored offset was recorded relative to the FIRST rect, so
// every rect shifts by the same delta while its offset-from-first and its own
// size scale with the element — the first rect lands exactly on the anchor and
// the shape stays coherent through a reflow. Bounds come out of the same pass
// rather than a second walk over the results.
export function reprojectRects({
  target,
  rects,
  ctx,
}: {
  target: TargetElement | undefined;
  rects: readonly SelectionRect[];
  ctx?: AnchorContext;
}): ReprojectedRects | null {
  const first = rects[0];
  if (!first) return null;
  const { dx, dy, scaleX, scaleY, strategy } = applyAnchorDelta(target, { docX: first.x, docY: first.y }, ctx);
  const x = first.x + dx;
  const y = first.y + dy;

  const out: SelectionRect[] = [];
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const r of rects) {
    const rect = {
      x: x + (r.x - first.x) * scaleX,
      y: y + (r.y - first.y) * scaleY,
      width: r.width * scaleX,
      height: r.height * scaleY,
    };
    out.push(rect);
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.width);
    maxY = Math.max(maxY, rect.y + rect.height);
  }
  return { x, y, rects: out, bounds: { x: minX, y: minY, width: maxX - minX, height: maxY - minY }, strategy };
}

// Re-anchor an axis-aligned box (an area annotation) stored as two corners:
// top-left tracks the element, width/height scale with it.
export function reprojectBox({
  target,
  startX,
  startY,
  endX,
  endY,
  ctx,
}: {
  target: TargetElement | undefined;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  ctx?: AnchorContext;
}): { x: number; y: number; width: number; height: number; strategy: AnchorStrategy | null } {
  const storedX = Math.min(startX, endX);
  const storedY = Math.min(startY, endY);
  const { x, y, scaleX, scaleY, strategy } = applyAnchorDelta(target, { docX: storedX, docY: storedY }, ctx);
  return {
    x,
    y,
    width: Math.abs(endX - startX) * scaleX,
    height: Math.abs(endY - startY) * scaleY,
    strategy,
  };
}

// No-op for now — the previous `currentWidth/capturedWidth` heuristic drifted
// badly on long pages (page height doesn't track viewport width). Canvas ops
// stay at their captured doc coords; signature is kept so callers can adopt a
// future per-op element anchor without churn.
export function captureScale(_captureViewport: CaptureViewport | undefined): number {
  return 1;
}
