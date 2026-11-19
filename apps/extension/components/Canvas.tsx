import { useSignalEffect } from '@preact/signals';
import { useCallback, useEffect, useMemo, useRef } from 'preact/hooks';
import { tinykeys } from 'tinykeys';
import { applyAnchorDelta } from '../lib/anchor';
import { scrollTick } from '../lib/host-mutations';
import { areas, comments, deleteOp, inspects, operations, pushOp, selections, undoRedoFlash } from '../lib/ops';
import { color, lineWidth } from '../lib/prefs';
import { circleHitsRect, eraserDiameter, redrawCanvas } from '../lib/renderer';
import { scrollOffset, toDoc } from '../lib/scroller';
import { createStrokeEngine, type EraserHooks } from '../lib/stroke-engine';
import { activeTool, isDrawingActive } from '../lib/tool-state';
import { toolPaintsCanvas } from '../lib/tools';
import type { Point } from '../lib/types';

/**
 * Every DOM op's hit-test geometry, taken once at eraser press: resolving anchors per
 * move forces layout, 5-10ms a move on a 500-annotation page. Ops added mid-stroke
 * wait for the next stroke.
 */
function eraserTargets() {
  const out: Array<{ id: string; rects: Array<{ x: number; y: number; w: number; h: number }> }> = [];
  for (const op of comments.value) {
    const { x, y } = applyAnchorDelta(op.target, { docX: op.x, docY: op.y });
    out.push({ id: op.id, rects: [{ x, y, w: 0, h: 0 }] });
  }
  for (const op of areas.value) {
    const sx = Math.min(op.startX, op.endX);
    const sy = Math.min(op.startY, op.endY);
    const { dx, dy } = applyAnchorDelta(op.target, { docX: sx, docY: sy });
    out.push({
      id: op.id,
      rects: [{ x: sx + dx, y: sy + dy, w: Math.abs(op.endX - op.startX), h: Math.abs(op.endY - op.startY) }],
    });
  }
  for (const op of selections.value) {
    const first = op.rects[0];
    if (!first) continue;
    const { dx, dy } = applyAnchorDelta(op.target, { docX: first.x, docY: first.y });
    out.push({
      id: op.id,
      rects: op.rects.map((r) => ({ x: r.x + dx, y: r.y + dy, w: r.width, h: r.height })),
    });
  }
  for (const op of inspects.value) {
    const r = op.rect;
    out.push({ id: op.id, rects: [{ x: r.x, y: r.y, w: r.width, h: r.height }] });
  }
  return out;
}

/** Erasing DOM ops: each goes once per stroke, however long the drag lingers over it. */
function domEraser(): EraserHooks {
  let targets: ReturnType<typeof eraserTargets> = [];
  const erased = new Set<string>();
  return {
    begin: () => {
      erased.clear();
      targets = eraserTargets();
    },
    at: ({ at, radius }) => {
      for (const t of targets) {
        if (erased.has(t.id)) continue;
        if (t.rects.some((r) => circleHitsRect(at.x, at.y, radius, r.x, r.y, r.w, r.h))) {
          erased.add(t.id);
          deleteOp(t.id);
        }
      }
    },
    end: () => {
      targets = [];
      erased.clear();
    },
  };
}

const clientXY = (e: MouseEvent | TouchEvent): Point => {
  const s = 'touches' in e ? (e.touches[0] ?? e.changedTouches[0]) : e;
  // A touch event with neither list populated shouldn't reach here; fall back to
  // the origin rather than throwing mid-gesture.
  return s ? { x: s.clientX, y: s.clientY } : { x: 0, y: 0 };
};

export function Canvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const eraserRef = useRef<HTMLDivElement>(null);

  const engine = useMemo(
    () =>
      createStrokeEngine({
        context: () => canvasRef.current?.getContext('2d', { willReadFrequently: true }) ?? null,
        toDoc,
        offset: () => scrollOffset(window),
        tool: () => activeTool.value,
        color: () => color.value,
        lineWidth: () => lineWidth.value,
        commit: pushOp,
        // The viewport the stroke *started* on, stable if the window resizes mid-stroke.
        captureViewport: () => ({ width: innerWidth, height: innerHeight }),
        eraser: domEraser(),
      }),
    [],
  );

  const onDown = useCallback(
    (e: MouseEvent | TouchEvent) => {
      if ('button' in e && e.button !== 0) return;
      if (engine.down({ client: clientXY(e), shift: e.shiftKey }) && 'touches' in e) e.preventDefault();
    },
    [engine],
  );

  const onMove = useCallback(
    (e: MouseEvent | TouchEvent) => {
      if (!engine.drawing) return;
      if ('cancelable' in e && e.cancelable) e.preventDefault();
      engine.move({ client: clientXY(e), shift: e.shiftKey });
    },
    [engine],
  );

  const onUp = useCallback(
    (e: MouseEvent | TouchEvent) => {
      if ('button' in e && e.button !== 0) return;
      engine.up({ client: clientXY(e), shift: e.shiftKey });
    },
    [engine],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      // Size the drawing buffer at DPR so strokes are sharp on Retina/4K. CSS
      // size is driven by `class="fixed inset-0"` (viewport), so the larger
      // buffer is downscaled to fit. Setting `width`/`height` resets all ctx
      // state — re-apply the DPR transform every resize.
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(innerWidth * dpr);
      canvas.height = Math.floor(innerHeight * dpr);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      redrawCanvas(canvas, operations.value);
    };
    resize();
    window.addEventListener('resize', resize);
    window.addEventListener('mousemove', onMove, { passive: false });
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchend', onUp);
    const onEraserMove = (e: MouseEvent) => {
      const el = eraserRef.current;
      if (!el) return;
      if (activeTool.value !== 'eraser') {
        el.style.display = 'none';
        return;
      }
      const size = eraserDiameter(lineWidth.value);
      el.style.display = 'block';
      el.style.left = `${e.clientX}px`;
      el.style.top = `${e.clientY}px`;
      el.style.width = `${size}px`;
      el.style.height = `${size}px`;
    };
    window.addEventListener('mousemove', onEraserMove);
    const unbindShiftDown = tinykeys(window, { Shift: () => engine.setShift(true) });
    const unbindShiftUp = tinykeys(window, { Shift: () => engine.setShift(false) }, { event: 'keyup' });
    return () => {
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchend', onUp);
      window.removeEventListener('mousemove', onEraserMove);
      unbindShiftDown();
      unbindShiftUp();
    };
  }, [engine, onMove, onUp]);

  useSignalEffect(() => {
    const ops = operations.value;
    // scrollTick is the sole scroll-driven redraw path, and it is already
    // rAF-coalesced by the shared listener in host-mutations.ts. hostMutationTick is
    // deliberately not subscribed: only comment, selection and area ops anchor
    // to an element (`isAnchorableOp`), and all three render as DOM, so a host
    // mutation can never move a canvas pixel. Subscribing would make any page
    // with one comment repaint identical pixels on every DOM change.
    scrollTick.value;
    // Subscribe to isDrawingActive so a redraw fires on release too: it replays
    // the just-finished stroke and any peer ops that arrived during the drag.
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!isDrawingActive.value) {
      redrawCanvas(canvas, ops);
      return;
    }
    // A scroll mid-stroke leaves the snapshot at the old offset: re-take it so the
    // committed marks move with the page under the pen.
    if (!engine.drawing) return;
    redrawCanvas(canvas, ops);
    engine.resnapshot();
  });

  useSignalEffect(() => {
    const v = undoRedoFlash.value;
    if (v > 0) canvasRef.current?.animate([{ opacity: 0.3 }, { opacity: 1 }], { duration: 400, easing: 'ease-out' });
  });

  // Hide eraser cursor immediately on tool change (keyboard shortcuts don't trigger mousemove)
  useSignalEffect(() => {
    if (activeTool.value !== 'eraser' && eraserRef.current) {
      eraserRef.current.style.display = 'none';
    }
  });

  const tool = activeTool.value;
  const showCanvas = toolPaintsCanvas(tool);

  return (
    <>
      <canvas
        ref={canvasRef}
        data-marklayer-canvas
        onMouseDown={onDown}
        onTouchStart={onDown}
        class="fixed inset-0 size-full z-2147483645"
        style={{
          pointerEvents: showCanvas ? 'auto' : 'none',
          cursor: showCanvas ? (tool === 'eraser' ? 'none' : 'crosshair') : 'default',
        }}
      />
      <div
        ref={eraserRef}
        class="fixed pointer-events-none z-2147483646 rounded-full"
        style={{
          display: 'none',
          transform: 'translate(-50%, -50%)',
          border: '1.5px solid rgba(120, 120, 120, 0.8)',
          boxShadow: '0 0 0 1px rgba(255, 255, 255, 0.5)',
        }}
      />
    </>
  );
}
