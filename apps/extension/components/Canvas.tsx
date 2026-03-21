import { useSignalEffect } from '@preact/signals';
import { nanoid } from 'nanoid';
import { useCallback, useEffect, useRef } from 'preact/hooks';
import { hexToRgba, redrawCanvas, simplify } from '../lib/renderer';
import {
  activeTool,
  color,
  FREEHAND,
  isDrawingActive,
  isDrawingTool,
  lineWidth,
  operations,
  pushOp,
  SHAPES,
  undoRedoFlash,
} from '../lib/state';
import type { FreehandOp, Point } from '../lib/types';

export function Canvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const startPt = useRef<Point>({ x: 0, y: 0 });
  const snapshot = useRef<ImageData | null>(null);
  const currentPath = useRef<FreehandOp | null>(null);

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
      const d = docXY(e);
      startPt.current = d;

      const ctx = getCtx();
      if (!ctx) return;
      applyTool(ctx);

      if (FREEHAND.has(tool)) {
        currentPath.current = {
          id: nanoid(),
          tool: tool as FreehandOp['tool'],
          points: [{ x: d.x, y: d.y }],
          color: tool === 'highlight' ? hexToRgba(color.value, 0.4) : color.value,
          lineWidth: ctx.lineWidth,
          compositeOperation: ctx.globalCompositeOperation as GlobalCompositeOperation,
        };
      } else if (SHAPES.has(tool)) {
        const canvas = canvasRef.current!;
        snapshot.current = ctx.getImageData(0, 0, canvas.width, canvas.height);
      }
      const c = clientXY(e);
      ctx.beginPath();
      ctx.moveTo(c.x, c.y);
    },
    [applyTool],
  );

  const onMove = useCallback((e: MouseEvent | TouchEvent) => {
    if (!drawing.current) return;
    if ('cancelable' in e && e.cancelable) e.preventDefault();
    const tool = activeTool.value;
    const d = docXY(e);
    const c = clientXY(e);
    const ctx = getCtx();
    if (!ctx) return;

    const vsx = startPt.current.x - scrollX;
    const vsy = startPt.current.y - scrollY;

    if (FREEHAND.has(tool)) {
      currentPath.current?.points.push({ x: d.x, y: d.y });
      ctx.lineTo(c.x, c.y);
      ctx.stroke();
    } else if (snapshot.current && SHAPES.has(tool)) {
      ctx.putImageData(snapshot.current, 0, 0);
      ctx.beginPath();
      switch (tool) {
        case 'rectangle':
          ctx.strokeRect(vsx, vsy, c.x - vsx, c.y - vsy);
          break;
        case 'circle': {
          const r = Math.hypot(c.x - vsx, c.y - vsy);
          ctx.arc(vsx, vsy, r, 0, Math.PI * 2);
          ctx.stroke();
          break;
        }
        case 'line':
        case 'arrow': {
          ctx.moveTo(vsx, vsy);
          ctx.lineTo(c.x, c.y);
          ctx.stroke();
          if (tool === 'arrow') {
            const angle = Math.atan2(c.y - vsy, c.x - vsx);
            const headLen = Math.max(10, ctx.lineWidth * 4);
            ctx.beginPath();
            ctx.moveTo(c.x, c.y);
            ctx.lineTo(c.x - headLen * Math.cos(angle - Math.PI / 6), c.y - headLen * Math.sin(angle - Math.PI / 6));
            ctx.moveTo(c.x, c.y);
            ctx.lineTo(c.x - headLen * Math.cos(angle + Math.PI / 6), c.y - headLen * Math.sin(angle + Math.PI / 6));
            ctx.stroke();
          }
          break;
        }
      }
    }
  }, []);

  const onUp = useCallback(
    (e: MouseEvent | TouchEvent) => {
      if ('button' in e && e.button !== 0) return;
      if (!drawing.current) return;
      drawing.current = false;
      isDrawingActive.value = false;
      const tool = activeTool.value;
      const d = docXY(e);
      const s = startPt.current;
      const ctx = getCtx();

      if (FREEHAND.has(tool) && currentPath.current) {
        currentPath.current.points.push({ x: d.x, y: d.y });
        if (currentPath.current.points.length > 1) {
          currentPath.current.points = simplify(currentPath.current.points, 1.5);
          pushOp(currentPath.current);
        }
        currentPath.current = null;
      } else if (SHAPES.has(tool)) {
        if (snapshot.current && ctx) {
          ctx.putImageData(snapshot.current, 0, 0);
          snapshot.current = null;
        }
        const base = { id: nanoid(), color: color.value, lineWidth: lineWidth.value };
        if (tool === 'circle') {
          const r = Math.hypot(d.x - s.x, d.y - s.y);
          if (r > 0) pushOp({ ...base, tool: 'circle', centerX: s.x, centerY: s.y, radius: r });
        } else if (tool === 'rectangle') {
          if (s.x !== d.x && s.y !== d.y)
            pushOp({ ...base, tool: 'rectangle', startX: s.x, startY: s.y, endX: d.x, endY: d.y });
        } else if (tool === 'line' || tool === 'arrow') {
          if (s.x !== d.x || s.y !== d.y)
            pushOp({ ...base, tool: 'line', arrow: tool === 'arrow', startX: s.x, startY: s.y, endX: d.x, endY: d.y });
        }
      }

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
      canvas.width = innerWidth;
      canvas.height = innerHeight;
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
      cancelAnimationFrame(scrollRaf);
      scrollRaf = requestAnimationFrame(() => redrawCanvas(canvas, operations.value));
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchend', onUp);
      window.removeEventListener('scroll', onScroll);
    };
  }, [onMove, onUp]);

  useSignalEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) redrawCanvas(canvas, operations.value);
  });

  useSignalEffect(() => {
    const v = undoRedoFlash.value;
    if (v > 0) canvasRef.current?.animate([{ opacity: 0.3 }, { opacity: 1 }], { duration: 400, easing: 'ease-out' });
  });

  const tool = activeTool.value;
  const showCanvas = isDrawingTool(tool) && tool !== 'comment' && tool !== 'selection';

  return (
    <canvas
      ref={canvasRef}
      data-marklayer-canvas
      onMouseDown={onDown}
      onTouchStart={onDown}
      class="fixed inset-0 z-[2147483645]"
      style={{
        pointerEvents: showCanvas ? 'auto' : 'none',
        cursor: showCanvas ? 'crosshair' : 'default',
      }}
    />
  );
}
