import { bindKeymap } from '@ext/lib/keymap';
import { color, lineWidth } from '@ext/lib/prefs';
import { createStrokeEngine } from '@ext/lib/stroke-engine';
import { activeTool } from '@ext/lib/tool-state';
import type { Point } from '@ext/lib/types';
import { useSignalEffect } from '@preact/signals';
import { useCallback, useMemo } from 'preact/hooks';
import { iframeScrollY, pushDeviceOp } from '../viewer-state';

const clientOf = (e: MouseEvent): Point => ({ x: e.clientX, y: e.clientY });

/** The viewer's adapter onto the shared stroke engine: the frame's coordinates, and mouse input. */
export function useStrokeInput({
  canvasRef,
  clientToDoc,
}: {
  canvasRef: { current: HTMLCanvasElement | null };
  clientToDoc: (client: Point) => Point;
}) {
  const engine = useMemo(
    () =>
      createStrokeEngine({
        context: () => canvasRef.current?.getContext('2d') ?? null,
        toDoc: clientToDoc,
        offset: () => ({ x: 0, y: iframeScrollY.peek() }),
        tool: () => activeTool.peek(),
        color: () => color.peek(),
        lineWidth: () => lineWidth.peek(),
        commit: pushDeviceOp,
      }),
    [],
  );

  useSignalEffect(() => {
    const onMove = (e: MouseEvent) => engine.move({ client: clientOf(e), shift: e.shiftKey });
    const onUp = (e: MouseEvent) => engine.up({ client: clientOf(e), shift: e.shiftKey });
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    // Keys in the frame reach the host window as `ml-key`, so this hears Shift from either side.
    const unbind = bindKeymap({
      scope: window,
      bindings: [
        { keys: 'Shift', on: () => engine.setShift(true) },
        { keys: 'Shift', event: 'keyup', on: () => engine.setShift(false) },
      ],
    });
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      unbind();
    };
  });

  const startDrawing = useCallback((e: MouseEvent) => {
    engine.down({ client: clientOf(e), shift: e.shiftKey });
  }, []);

  return { startDrawing, repainted: engine.resnapshot };
}
