import { hexToRgba, inView, opBounds, renderOp, simplify, strokeArrowHead } from '@ext/lib/renderer';
import {
  activeTool,
  color,
  FREEHAND,
  isDrawingActive,
  lineWidth,
  operations,
  SHAPES,
  undoRedoFlash,
} from '@ext/lib/state';
import type { FreehandOp, Point } from '@ext/lib/types';
import { useSignalEffect } from '@preact/signals';
import { nanoid } from 'nanoid';
import { useCallback, useEffect, useRef } from 'preact/hooks';
import { pushDeviceOp, textInput } from '../signals';
import { canvasCoords } from './coords';

/**
 * The landing page's drawing surface: the product's own canvas, on the marketing
 * page, writing to the real op stream.
 *
 * Extracted whole from the page body, which carried this engine plus five other
 * concerns in one 1,277-line component. Nothing here is landing-specific except
 * the coordinate space — the page is the document, so ops are in document space
 * and there is no iframe or scale to undo.
 */
export function useLandingCanvas(): {
  canvasRef: { current: HTMLCanvasElement | null };
  onDown: (e: MouseEvent) => void;
} {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const startPtRef = useRef<Point>({ x: 0, y: 0 });
  const currentPathRef = useRef<FreehandOp | null>(null);
  const snapshotRef = useRef<ImageData | null>(null);

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

  const renderAll = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const canvasW = window.innerWidth;
    const canvasH = document.documentElement.scrollHeight;
    if (canvas.width !== canvasW) canvas.width = canvasW;
    if (canvas.height !== canvasH) canvas.height = canvasH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvasW, canvasH);
    for (const op of operations.value) {
      if (op.tool === 'comment' || op.tool === 'selection') continue;
      if (!inView(opBounds(op), 0, 0, canvasW, canvasH)) continue;
      renderOp(ctx, op, 0, 0);
    }
  }, []);

  const onDown = useCallback(
    (e: MouseEvent) => {
      const tool = activeTool.value;
      if (tool === 'navigate' || tool === 'comment' || tool === 'selection') return;
      if (tool === 'text') {
        textInput.value = canvasCoords(e);
        return;
      }
      drawingRef.current = true;
      isDrawingActive.value = true;
      const pos = canvasCoords(e);
      startPtRef.current = pos;
      const ctx = canvasRef.current?.getContext('2d');
      if (!ctx) return;
      applyTool(ctx);
      if (FREEHAND.has(tool)) {
        ctx.beginPath();
        ctx.moveTo(pos.x, pos.y);
        currentPathRef.current = {
          id: nanoid(),
          tool,
          points: [pos],
          color: tool === 'highlight' ? hexToRgba(color.value, 0.4) : color.value,
          lineWidth: ctx.lineWidth,
          compositeOperation: ctx.globalCompositeOperation,
        };
      } else if (SHAPES.has(tool)) {
        snapshotRef.current = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
      }
    },
    [applyTool],
  );

  const onMove = useCallback(
    (e: MouseEvent) => {
      if (!drawingRef.current) return;
      const tool = activeTool.value;
      const pos = canvasCoords(e);
      const ctx = canvasRef.current?.getContext('2d');
      if (!ctx) return;
      if (FREEHAND.has(tool)) {
        currentPathRef.current?.points.push(pos);
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
      } else if (snapshotRef.current && SHAPES.has(tool)) {
        ctx.putImageData(snapshotRef.current, 0, 0);
        ctx.beginPath();
        const sp = startPtRef.current;
        applyTool(ctx);
        switch (tool) {
          case 'rectangle':
            ctx.strokeRect(sp.x, sp.y, pos.x - sp.x, pos.y - sp.y);
            break;
          case 'circle': {
            const r = Math.hypot(pos.x - sp.x, pos.y - sp.y);
            ctx.arc(sp.x, sp.y, r, 0, Math.PI * 2);
            ctx.stroke();
            break;
          }
          case 'line':
          case 'arrow':
            ctx.moveTo(sp.x, sp.y);
            ctx.lineTo(pos.x, pos.y);
            ctx.stroke();
            if (tool === 'arrow') {
              strokeArrowHead(ctx, { start: sp, end: pos, lineWidth: ctx.lineWidth });
            }
            break;
        }
      }
    },
    [applyTool],
  );

  const onUp = useCallback((e: MouseEvent) => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    isDrawingActive.value = false;
    const tool = activeTool.value;
    const pos = canvasCoords(e);
    const sp = startPtRef.current;
    if (FREEHAND.has(tool) && currentPathRef.current) {
      currentPathRef.current.points.push(pos);
      if (currentPathRef.current.points.length > 1) {
        currentPathRef.current.points = simplify(currentPathRef.current.points, 1.5);
        pushDeviceOp(currentPathRef.current);
      }
      currentPathRef.current = null;
    } else if (SHAPES.has(tool)) {
      snapshotRef.current = null;
      const base = { id: nanoid(), color: color.value, lineWidth: lineWidth.value };
      if (tool === 'circle') {
        const r = Math.hypot(pos.x - sp.x, pos.y - sp.y);
        if (r > 0) pushDeviceOp({ ...base, tool: 'circle', centerX: sp.x, centerY: sp.y, radius: r });
      } else if (tool === 'rectangle') {
        if (sp.x !== pos.x && sp.y !== pos.y)
          pushDeviceOp({
            ...base,
            tool: 'rectangle',
            startX: sp.x,
            startY: sp.y,
            endX: pos.x,
            endY: pos.y,
          });
      } else if (tool === 'line' || tool === 'arrow') {
        if (sp.x !== pos.x || sp.y !== pos.y)
          pushDeviceOp({
            ...base,
            tool: 'line',
            arrow: tool === 'arrow',
            startX: sp.x,
            startY: sp.y,
            endX: pos.x,
            endY: pos.y,
          });
      }
    }
  }, []);

  // Re-render canvas when operations change
  useSignalEffect(() => {
    operations.value;
    renderAll();
  });

  useSignalEffect(() => {
    const v = undoRedoFlash.value;
    if (v > 0) canvasRef.current?.animate([{ opacity: 0.3 }, { opacity: 1 }], { duration: 400, easing: 'ease-out' });
  });

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const onResize = () => {
      clearTimeout(timer);
      timer = setTimeout(renderAll, 100);
    };
    window.addEventListener('resize', onResize);
    const ro = new ResizeObserver(() => renderAll());
    ro.observe(document.body);
    return () => {
      window.removeEventListener('resize', onResize);
      ro.disconnect();
    };
  }, [renderAll]);

  useEffect(() => {
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [onMove, onUp]);

  return { canvasRef, onDown };
}
