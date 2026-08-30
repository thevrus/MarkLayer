import { useCallback, useState } from 'preact/hooks';
import { captureTarget, pickElementAtPoint } from '../lib/selector';
import { activeTool, pushOp, rootComments } from '../lib/state';
import { CommentPin } from './CommentPin';
import { CommentPopover } from './CommentPopover';

interface PopoverState {
  x: number;
  y: number;
  el: Element | null;
}

export function CommentLayer() {
  const [popover, setPopover] = useState<PopoverState | null>(null);

  const onClick = useCallback((e: MouseEvent) => {
    if (activeTool.value !== 'comment') return;
    const x = e.clientX + scrollX;
    const y = e.clientY + scrollY;
    setPopover({ x, y, el: pickElementAtPoint(e.clientX, e.clientY) });
  }, []);

  return (
    <div
      class="fixed inset-0 z-2147483646 pointer-events-none
             font-[-apple-system,BlinkMacSystemFont,'Geist',system-ui,sans-serif]"
      onClick={onClick}
      style={{
        pointerEvents: activeTool.value === 'comment' ? 'auto' : 'none',
        cursor: activeTool.value === 'comment' ? 'crosshair' : 'default',
      }}
    >
      {/* Placed pins */}
      {rootComments.value.map((c) => (
        <CommentPin key={c.id} op={c} />
      ))}

      {/* Input popover */}
      {popover && (
        <CommentPopover
          at={{ x: popover.x, y: popover.y }}
          anchorAt={{ x: popover.x - scrollX, y: popover.y - scrollY }}
          capture={() => ({
            target: popover.el ? captureTarget({ el: popover.el, anchor: { x: popover.x, y: popover.y } }) : undefined,
            captureViewport: { width: window.innerWidth, height: window.innerHeight },
          })}
          push={pushOp}
          onClose={() => setPopover(null)}
        />
      )}
    </div>
  );
}
