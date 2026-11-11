import { cn } from '@marklayer/ui/cn';
import { useSignalEffect } from '@preact/signals';
import { useCallback, useState } from 'preact/hooks';
import { applyAnchorDelta } from '../lib/anchor';
import { checkRequest, flashAnnotation } from '../lib/checkFix';
import { commentContext } from '../lib/comment-context';
import { host } from '../lib/host-config';
import { operations, pushOp, rootComments } from '../lib/ops';
import { activeLayer } from '../lib/layers';
import { snapshotPin } from '../lib/pin-shot';
import { MARKER_LAYER } from '../lib/popover';
import { color } from '../lib/prefs';
import { scrollPageTo, toClient, toDoc } from '../lib/scroller';
import { captureTarget, pickElementAtPoint } from '../lib/selector';
import { fileUrl, transcribeFile, uploadFile } from '../lib/share';
import { activeTool } from '../lib/tool-state';
import type { CommentOp } from '../lib/types';
import { CommentPin } from './CommentPin';
import { CommentPopover } from './CommentPopover';

interface PopoverState {
  x: number;
  y: number;
  el: Element | null;
  /** The screenshot around the pin, taken at the click so it shows what was clicked. */
  snapshot: Promise<string | null>;
  visualContext: NonNullable<CommentOp['visualContext']>;
}

export function CommentLayer() {
  const [popover, setPopover] = useState<PopoverState | null>(null);

  // The page is the user's own and already live, so a reload would cost their
  // scroll and form state; scrolling to the anchor and lighting the pin is enough.
  useSignalEffect(() => {
    const id = checkRequest.value;
    if (!id) return;
    checkRequest.value = null;
    const op = rootComments.peek().find((c) => c.id === id);
    if (!op) return;
    const { y } = applyAnchorDelta(op.target, { docX: op.x, docY: op.y });
    scrollPageTo(window, { top: Math.max(0, y - window.innerHeight / 3), behavior: 'smooth' });
    flashAnnotation(id);
  });

  const onClick = useCallback((e: MouseEvent) => {
    if (activeTool.value !== 'comment') return;
    const { x, y } = toDoc({ x: e.clientX, y: e.clientY });
    const topLeft = toDoc({ x: 0, y: 0 });
    const visualContext = commentContext({ pin: { x, y }, viewport: { ...topLeft, width: innerWidth, height: innerHeight }, layerId: activeLayer.peek(), ops: operations.peek() });
    const el = pickElementAtPoint(e.clientX, e.clientY);
    const shoot = host.capabilities.capture;
    const snapshot = shoot
      ? snapshotPin({
          shoot,
          pin: { x: e.clientX, y: e.clientY },
          viewport: { x: 0, y: 0, width: innerWidth, height: innerHeight },
          color: color.value,
          upload: uploadFile,
        })
      : Promise.resolve(null);
    setPopover({ x, y, el, snapshot, visualContext });
  }, []);

  return (
    <>
      {/* The click-capture is a sibling, not the pins' parent: MARKER_LAYER lifts above the
          toolbar while a card is held, and a lifted capture would take the toolbar's clicks. */}
      <div
        class="fixed inset-0 z-2147483646"
        onClick={onClick}
        style={{
          pointerEvents: activeTool.value === 'comment' ? 'auto' : 'none',
          cursor: activeTool.value === 'comment' ? 'crosshair' : 'default',
        }}
      />
      <div class={cn(MARKER_LAYER, 'pointer-events-none')}>
        {rootComments.value.map((c) => (
          <CommentPin key={c.id} op={c} />
        ))}

        {popover && (
          <CommentPopover
            at={{ x: popover.x, y: popover.y }}
            anchorAt={toClient(popover)}
            capture={() => ({
              target: popover.el
                ? captureTarget({ el: popover.el, anchor: { x: popover.x, y: popover.y } })
                : undefined,
              captureViewport: { width: window.innerWidth, height: window.innerHeight },
              visualContext: popover.visualContext,
              layerId: popover.visualContext.layerId,
            })}
            push={pushOp}
            onClose={() => setPopover(null)}
            media={{
              upload: uploadFile,
              resolveUrl: fileUrl,
              voice: { transcribe: transcribeFile },
              snapshot: popover.snapshot,
            }}
          />
        )}
      </div>
    </>
  );
}
