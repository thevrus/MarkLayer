import { onCursorMove } from '@ext/lib/presence';
import { emitRipple } from '@ext/lib/realtime';
import { activeTool } from '@ext/lib/tool-state';
import type { Point } from '@ext/lib/types';
import { useEffect } from 'preact/hooks';

/** What the host-side pointer tells the room: this person's cursor, and a ripple where they click on the page. */
export function usePointerBroadcast({
  innerRef,
  canvasCoords,
}: {
  innerRef: { current: HTMLDivElement | null };
  canvasCoords: (e: MouseEvent) => Point;
}) {
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!innerRef.current) return;
      const pos = canvasCoords(e);
      onCursorMove.value?.(pos.x, pos.y, activeTool.value);
    };
    window.addEventListener('mousemove', handler);
    return () => window.removeEventListener('mousemove', handler);
  }, []);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const inner = innerRef.current;
      if (!inner || !(e.target instanceof Node) || !inner.contains(e.target)) return;
      const pos = canvasCoords(e);
      emitRipple.value?.(pos.x, pos.y);
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [canvasCoords]);
}
