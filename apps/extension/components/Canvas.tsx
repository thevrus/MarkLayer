import { batch, useSignalEffect } from '@preact/signals';
import { nanoid } from 'nanoid';
import { useCallback, useEffect, useRef } from 'preact/hooks';
import { tinykeys } from 'tinykeys';
import { applyAnchorDelta } from '../lib/anchor';
import { circleHitsRect, constrainEnd, hexToRgba, redrawCanvas, renderOp, simplify } from '../lib/renderer';
import {
  activeTool,
  areas,
  color,
  comments,
  deleteOp,
  FREEHAND,
  inspects,
  isDrawingActive,
  isDrawingTool,
  lineWidth,
  operations,
  pushOp,
  SHAPES,
  selections,
  undoRedoFlash,
} from '../lib/state';
import type { FreehandOp, Point } from '../lib/types';

export function Canvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const eraserRef = useRef<HTMLDivElement>(null);
  const drawing = useRef(false);
  const startPt = useRef<Point>({ x: 0, y: 0 });
  const snapshot = useRef<ImageData | null>(null);
  const currentPath = useRef<FreehandOp | null>(null);
  // Captured at onDown so shapes record the viewport the user *started*
  // drawing on — matches freehand timing and stays stable if the window
  // resizes mid-stroke.
  const captureSize = useRef<{ width: number; height: number }>({ width: 0, height: 0 });
  // Tracks DOM-op IDs already deleted by this eraser stroke so a single
  // pass over the same op doesn't double-fire deleteOp during a long drag.
  const erasedIds = useRef<Set<string>>(new Set());
  // Snapshot of every DOM op's hit-test geometry, computed once at eraser
  // onDown. Avoids per-move `resolveAnchorPoint` (which forces layout via
  // `getBoundingClientRect`) — on a 500-annotation page that's a 5-10ms
  // layout thrash per move event.
  const eraserTargets = useRef<Array<{ id: string; rects: Array<{ x: number; y: number; w: number; h: number }> }>>([]);
  const shiftHeld = useRef(false);
  const lastClient = useRef<Point | null>(null);

  const getCtx = () => canvasRef.current?.getContext('2d', { willReadFrequently: true }) ?? null;

  const clientXY = (e: MouseEvent | TouchEvent): Point => {
    const s = 'touches' in e ? (e.touches[0] ?? e.changedTouches[0]) : e;
    return { x: s.clientX, y: s.clientY };
  };

  const docXY = (e: MouseEvent | TouchEvent): Point => {
    const { x, y } = clientXY(e);
    return { x: x + scrollX, y: y + scrollY };
  };

  const applyTool = useCallback((ctx: CanvasRenderingContext2D) => {
    ctx.lineCap = ctx.lineJoin = 'round';
    const tool = activeTool.value;
    const c = color.value;
    const lw = lineWidth.value;
    switch (tool) {
      case 'eraser':
        ctx.globalCompositeOperation = 'destination-out';
        ctx.lineWidth = Math.max(5, lw * 1.5);
        ctx.strokeStyle = 'black';
        break;
      case 'highlight':
        ctx.globalCompositeOperation = 'source-over';
        ctx.lineWidth = Math.max(8, lw * 2);
        ctx.strokeStyle = ctx.fillStyle = hexToRgba(c, 0.4);
        break;
      default:
        ctx.globalCompositeOperation = 'source-over';
        ctx.lineWidth = lw;
        ctx.strokeStyle = ctx.fillStyle = c;
    }
  }, []);

  const onDown = useCallback(
    (e: MouseEvent | TouchEvent) => {
      const tool = activeTool.value;
      if ('button' in e && e.button !== 0) return;
      if (tool === 'navigate' || tool === 'comment') return;
      if ('touches' in e) e.preventDefault();

      drawing.current = true;
      isDrawingActive.value = true;
      const c = clientXY(e);
      const d = { x: c.x + scrollX, y: c.y + scrollY };
      startPt.current = d;
      lastClient.current = c;
      shiftHeld.current = e.shiftKey;
      captureSize.current = { width: innerWidth, height: innerHeight };
      if (tool === 'eraser') {
        erasedIds.current.clear();
        eraserTargets.current = snapshotEraserTargets();
      }

      const ctx = getCtx();
      if (!ctx) return;
      applyTool(ctx);

      if (FREEHAND.has(tool) || SHAPES.has(tool)) {
        const canvas = canvasRef.current!;
        snapshot.current = ctx.getImageData(0, 0, canvas.width, canvas.height);
      }
      if (FREEHAND.has(tool)) {
        currentPath.current = {
          id: nanoid(),
          tool,
          points: [{ x: d.x, y: d.y }],
          color: tool === 'highlight' ? hexToRgba(color.value, 0.4) : color.value,
          lineWidth: ctx.lineWidth,
          compositeOperation: ctx.globalCompositeOperation,
          captureViewport: captureSize.current,
        };
      }
      ctx.beginPath();
      ctx.moveTo(c.x, c.y);
    },
    [applyTool],
  );

  // Snapshot anchored op geometry on onDown so per-move hit-tests don't pay
  // the layout cost of resolving anchors. Ops added mid-stroke fall out of
  // scope until the next stroke.
  const snapshotEraserTargets = useCallback(() => {
    const out: typeof eraserTargets.current = [];
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
      if (!op.rects.length) continue;
      const first = op.rects[0];
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
  }, []);

  const eraseTouchingDomOps = useCallback((docX: number, docY: number, radius: number) => {
    const seen = erasedIds.current;
    for (const t of eraserTargets.current) {
      if (seen.has(t.id)) continue;
      for (const r of t.rects) {
        if (circleHitsRect(docX, docY, radius, r.x, r.y, r.w, r.h)) {
          seen.add(t.id);
          deleteOp(t.id);
          break;
        }
      }
    }
  }, []);

  // Leave `currentPath.points` alone while Shift is held — toggling Shift off
  // resumes accumulation from the current cursor rather than from the start.
  const renderFreehandPreview = useCallback(() => {
    const tool = activeTool.value;
    if (!FREEHAND.has(tool)) return;
    if (!snapshot.current) return;
    const ctx = getCtx();
    const path = currentPath.current;
    if (!ctx || !path) return;
    ctx.putImageData(snapshot.current, 0, 0);
    if (shiftHeld.current && lastClient.current) {
      const start = path.points[0];
      const c = lastClient.current;
      const end = constrainEnd(tool, start.x, start.y, c.x + scrollX, c.y + scrollY);
      renderOp(ctx, { ...path, points: [start, end] }, scrollX, scrollY);
    } else if (path.points.length > 1) {
      renderOp(ctx, path, scrollX, scrollY);
    }
  }, []);

  const renderShapePreview = useCallback(() => {
    const tool = activeTool.value;
    if (!SHAPES.has(tool)) return;
    if (!snapshot.current) return;
    const ctx = getCtx();
    const c = lastClient.current;
    if (!ctx || !c) return;
    const vsx = startPt.current.x - scrollX;
    const vsy = startPt.current.y - scrollY;
    const { x: ex, y: ey } = shiftHeld.current ? constrainEnd(tool, vsx, vsy, c.x, c.y) : { x: c.x, y: c.y };

    ctx.putImageData(snapshot.current, 0, 0);
    ctx.beginPath();
    switch (tool) {
      case 'rectangle':
        ctx.strokeRect(vsx, vsy, ex - vsx, ey - vsy);
        break;
      case 'circle': {
        const r = Math.hypot(ex - vsx, ey - vsy);
        ctx.arc(vsx, vsy, r, 0, Math.PI * 2);
        ctx.stroke();
        break;
      }
      case 'line':
      case 'arrow': {
        ctx.moveTo(vsx, vsy);
        ctx.lineTo(ex, ey);
        ctx.stroke();
        if (tool === 'arrow') {
          const angle = Math.atan2(ey - vsy, ex - vsx);
          const headLen = Math.max(10, ctx.lineWidth * 4);
          ctx.beginPath();
          ctx.moveTo(ex, ey);
          ctx.lineTo(ex - headLen * Math.cos(angle - Math.PI / 6), ey - headLen * Math.sin(angle - Math.PI / 6));
          ctx.moveTo(ex, ey);
          ctx.lineTo(ex - headLen * Math.cos(angle + Math.PI / 6), ey - headLen * Math.sin(angle + Math.PI / 6));
          ctx.stroke();
        }
        break;
      }
    }
  }, []);

  const onMove = useCallback(
    (e: MouseEvent | TouchEvent) => {
      if (!drawing.current) return;
      if ('cancelable' in e && e.cancelable) e.preventDefault();
      const tool = activeTool.value;
      const c = clientXY(e);
      const d = { x: c.x + scrollX, y: c.y + scrollY };
      const ctx = getCtx();
      if (!ctx) return;

      lastClient.current = c;
      shiftHeld.current = e.shiftKey;

      if (tool === 'eraser') {
        // Eraser visual diameter — keep in sync with onEraserMove cursor.
        const eraserRadius = (Math.max(5, lineWidth.value * 1.5) * 2.5) / 2;
        eraseTouchingDomOps(d.x, d.y, eraserRadius);
      }

      if (FREEHAND.has(tool)) {
        if (!shiftHeld.current) currentPath.current?.points.push(d);
        renderFreehandPreview();
      } else if (SHAPES.has(tool)) {
        renderShapePreview();
      }
    },
    [eraseTouchingDomOps, renderFreehandPreview, renderShapePreview],
  );

  const onUp = useCallback(
    (e: MouseEvent | TouchEvent) => {
      if ('button' in e && e.button !== 0) return;
      if (!drawing.current) return;
      drawing.current = false;
      const tool = activeTool.value;
      const dRaw = docXY(e);
      const s = startPt.current;
      const d = shiftHeld.current ? constrainEnd(tool, s.x, s.y, dRaw.x, dRaw.y) : dRaw;
      const ctx = getCtx();
      if (tool === 'eraser') {
        eraserTargets.current = [];
        erasedIds.current.clear();
      }

      // Batch the active-flip with pushOp so the redraw effect fires once
      // (with the new op present) instead of twice — once before pushOp with
      // a now-stale ops array, once after.
      batch(() => {
        isDrawingActive.value = false;

        if (FREEHAND.has(tool) && currentPath.current) {
          snapshot.current = null;
          if (shiftHeld.current) {
            currentPath.current.points = [currentPath.current.points[0], { x: d.x, y: d.y }];
          } else {
            currentPath.current.points.push({ x: d.x, y: d.y });
          }
          if (currentPath.current.points.length > 1) {
            // Eraser uses a tighter tolerance so the destination-out mask
            // doesn't lose pinpoint accuracy near edges, but still gets
            // most of the wire/storage savings of simplification.
            const tol = tool === 'eraser' ? 0.5 : 1.5;
            currentPath.current.points = simplify(currentPath.current.points, tol);
            pushOp(currentPath.current);
          }
          currentPath.current = null;
        } else if (SHAPES.has(tool)) {
          if (snapshot.current && ctx) {
            ctx.putImageData(snapshot.current, 0, 0);
            snapshot.current = null;
          }
          const base = {
            id: nanoid(),
            color: color.value,
            lineWidth: lineWidth.value,
            captureViewport: captureSize.current,
          };
          if (tool === 'circle') {
            const r = Math.hypot(d.x - s.x, d.y - s.y);
            if (r > 0) pushOp({ ...base, tool: 'circle', centerX: s.x, centerY: s.y, radius: r });
          } else if (tool === 'rectangle') {
            if (s.x !== d.x && s.y !== d.y)
              pushOp({ ...base, tool: 'rectangle', startX: s.x, startY: s.y, endX: d.x, endY: d.y });
          } else if (tool === 'line' || tool === 'arrow') {
            if (s.x !== d.x || s.y !== d.y)
              pushOp({
                ...base,
                tool: 'line',
                arrow: tool === 'arrow',
                startX: s.x,
                startY: s.y,
                endX: d.x,
                endY: d.y,
              });
          }
        }
      });

      if (ctx) {
        ctx.beginPath();
        applyTool(ctx);
      }
    },
    [applyTool],
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
    let scrollRaf = 0;
    const onScroll = () => {
      // Bail if a stroke is in progress — the snapshot+preview compositing
      // would clobber the in-progress stroke. The drag will repaint on next
      // pointer move, and the post-release useSignalEffect will redraw.
      if (drawing.current) return;
      cancelAnimationFrame(scrollRaf);
      scrollRaf = requestAnimationFrame(() => redrawCanvas(canvas, operations.value));
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    const onEraserMove = (e: MouseEvent) => {
      const el = eraserRef.current;
      if (!el) return;
      if (activeTool.value !== 'eraser') {
        el.style.display = 'none';
        return;
      }
      const size = Math.max(5, lineWidth.value * 1.5) * 2.5;
      el.style.display = 'block';
      el.style.left = `${e.clientX}px`;
      el.style.top = `${e.clientY}px`;
      el.style.width = `${size}px`;
      el.style.height = `${size}px`;
    };
    window.addEventListener('mousemove', onEraserMove);
    const setShift = (next: boolean) => {
      if (shiftHeld.current === next) return;
      shiftHeld.current = next;
      if (!drawing.current) return;
      const tool = activeTool.value;
      if (SHAPES.has(tool)) renderShapePreview();
      else if (FREEHAND.has(tool)) renderFreehandPreview();
    };
    const unbindShiftDown = tinykeys(window, { Shift: () => setShift(true) });
    const unbindShiftUp = tinykeys(window, { Shift: () => setShift(false) }, { event: 'keyup' });
    return () => {
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchend', onUp);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('mousemove', onEraserMove);
      unbindShiftDown();
      unbindShiftUp();
    };
  }, [onMove, onUp, renderShapePreview, renderFreehandPreview]);

  useSignalEffect(() => {
    const ops = operations.value;
    // Subscribe to isDrawingActive so the redraw fires once on release —
    // mid-stroke remote ops/undo would otherwise clobber the snapshot
    // preview. The trailing redraw replays everything including the
    // just-finished stroke and any peer ops that arrived during the drag.
    if (isDrawingActive.value) return;
    const canvas = canvasRef.current;
    if (canvas) redrawCanvas(canvas, ops);
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
  const showCanvas =
    isDrawingTool(tool) &&
    tool !== 'comment' &&
    tool !== 'selection' &&
    tool !== 'inspect' &&
    tool !== 'measure' &&
    tool !== 'text' &&
    tool !== 'area';

  return (
    <>
      <canvas
        ref={canvasRef}
        data-marklayer-canvas
        onMouseDown={onDown}
        onTouchStart={onDown}
        class="fixed inset-0 z-2147483645"
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
