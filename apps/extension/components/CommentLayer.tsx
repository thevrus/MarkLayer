import { useCallback, useEffect, useState } from 'preact/hooks';
import { activeTool, comments } from '../lib/state';
import { CommentPin } from './CommentPin';
import { CommentPopover } from './CommentPopover';

export function CommentLayer() {
  const [popover, setPopover] = useState<{ x: number; y: number } | null>(null);
  const [, forceUpdate] = useState(0);

  // Reposition pins on scroll
  useEffect(() => {
    const onScroll = () => forceUpdate((n) => n + 1);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const onClick = useCallback((e: MouseEvent) => {
    if (activeTool.value !== 'comment') return;
    const x = e.clientX + scrollX;
    const y = e.clientY + scrollY;
    setPopover({ x, y });
  }, []);

  return (
    <div
      class="fixed inset-0 z-[2147483646] pointer-events-none
             font-[-apple-system,BlinkMacSystemFont,'Inter',system-ui,sans-serif]"
      onClick={onClick}
      style={{
        pointerEvents: activeTool.value === 'comment' ? 'auto' : 'none',
        cursor: activeTool.value === 'comment' ? 'crosshair' : 'default',
      }}
    >
      {/* Placed pins */}
      {comments.value.map((c) => (
        <CommentPin key={c.id} op={c} />
      ))}

      {/* Input popover */}
      {popover && <CommentPopover x={popover.x} y={popover.y} onClose={() => setPopover(null)} />}
    </div>
  );
}
