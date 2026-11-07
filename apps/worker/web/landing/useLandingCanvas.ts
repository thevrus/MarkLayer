import { operations, undoRedoFlash } from '@ext/lib/ops';
import { color, lineWidth } from '@ext/lib/prefs';
import { inView, opBounds, renderOp } from '@ext/lib/renderer';
import { createStrokeEngine } from '@ext/lib/stroke-engine';
import { activeTool } from '@ext/lib/tool-state';
import type { Point } from '@ext/lib/types';
import { useSignalEffect } from '@preact/signals';
import { useCallback, useMemo, useRef } from 'preact/hooks';
import { pushDeviceOp } from '../viewer-state';

const clientOf = (e: MouseEvent): Point => ({ x: e.clientX, y: e.clientY });

/**
 * The landing page's drawing surface: the product's own canvas and stroke engine,
 * writing to the real op stream. Only the coordinate space is the page's own: the
 * page is the document, so there is no iframe or scale to undo.
 */
export function useLandingCanvas(): {
  canvasRef: { current: HTMLCanvasElement | null };
  onDown: (e: MouseEvent) => void;
} {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engine = useMemo(
    () =>
      createStrokeEngine({
        context: () => canvasRef.current?.getContext('2d') ?? null,
        toDoc: ({ x, y }) => ({ x: x + window.scrollX, y: y + window.scrollY }),
        offset: () => ({ x: 0, y: 0 }),
        tool: () => activeTool.peek(),
        color: () => color.peek(),
        lineWidth: () => lineWidth.peek(),
        commit: pushDeviceOp,
      }),
    [],
  );

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
    engine.resnapshot();
  }, []);

  const onDown = useCallback((e: MouseEvent) => {
    engine.down({ client: clientOf(e), shift: e.shiftKey });
  }, []);

  useSignalEffect(() => {
    operations.value;
    renderAll();
  });

  useSignalEffect(() => {
    const v = undoRedoFlash.value;
    if (v > 0) canvasRef.current?.animate([{ opacity: 0.3 }, { opacity: 1 }], { duration: 400, easing: 'ease-out' });
  });

  useSignalEffect(() => {
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
  });

  useSignalEffect(() => {
    const onMove = (e: MouseEvent) => engine.move({ client: clientOf(e), shift: e.shiftKey });
    const onUp = (e: MouseEvent) => engine.up({ client: clientOf(e), shift: e.shiftKey });
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  });

  return { canvasRef, onDown };
}
