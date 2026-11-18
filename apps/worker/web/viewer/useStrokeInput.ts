import { bindKeymap } from '@ext/lib/keymap';
import { bindStrokeMoves, strokeDown } from '@ext/lib/pointer-stroke';
import { color, lineWidth } from '@ext/lib/prefs';
import { createStrokeEngine } from '@ext/lib/stroke-engine';
import { activeTool } from '@ext/lib/tool-state';
import type { Point } from '@ext/lib/types';
import { useSignalEffect } from '@preact/signals';
import { useCallback, useMemo } from 'preact/hooks';
import { iframeScrollY, pushDeviceOp } from '../viewer-state';

/** The viewer's adapter onto the shared stroke engine: the frame's coordinates, and pointer input (mouse, touch, pen). */
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
    const unbindMoves = bindStrokeMoves(engine);
    // Keys in the frame reach the host window as `ml-key`, so this hears Shift from either side.
    const unbind = bindKeymap({
      scope: window,
      bindings: [
        { keys: 'Shift', on: () => engine.setShift(true) },
        { keys: 'Shift', event: 'keyup', on: () => engine.setShift(false) },
      ],
    });
    return () => {
      unbindMoves();
      unbind();
    };
  });

  const startDrawing = useCallback((e: PointerEvent) => strokeDown({ engine, e }), []);

  return { startDrawing, repainted: engine.resnapshot };
}
