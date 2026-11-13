import { cn } from '@marklayer/ui/cn';
import { useSignalEffect } from '@preact/signals';
import { useCallback, useState } from 'preact/hooks';
import { applyAnchorDelta } from '../lib/anchor';
import { checkRequest, flashAnnotation } from '../lib/checkFix';
import { commentContext } from '../lib/comment-context';
import { host } from '../lib/host-config';
import { hostMutationTick, scrollTick } from '../lib/host-mutations';
import { activeLayer } from '../lib/layers';
import { operations, pushOp, rootComments } from '../lib/ops';
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
  target: CommentOp['target'];
  captureViewport: NonNullable<CommentOp['captureViewport']>;
  /** The screenshot around the pin, taken at the click so it shows what was clicked. */
  snapshot: Promise<string | null>;
  visualContext: NonNullable<CommentOp['visualContext']>;
}

export function CommentLayer() {
  scrollTick.value;
  hostMutationTick.value;
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
    const visualContext = commentContext({
      pin: { x, y },
      viewport: { ...topLeft, width: innerWidth, height: innerHeight },
      layerId: activeLayer.peek(),
      ops: operations.peek(),
    });
    const el = pickElementAtPoint(e.clientX, e.clientY);
    // 锚点、视口和截图使用点击时的同一份几何，避免 Post 前缩放混入新布局。
    const target = el ? captureTarget({ el, anchor: { x, y } }) : undefined;
    const captureViewport = { width: window.innerWidth, height: window.innerHeight };
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
    setPopover({ x, y, target, captureViewport, snapshot, visualContext });
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
            // Without a captured element there is no geometry to reproject; keep
            // the stored document point and let the browser map CSS px at zoom.
            anchorAt={toClient(applyAnchorDelta(popover.target, { docX: popover.x, docY: popover.y }))}
            capture={() => ({
              target: popover.target,
              captureViewport: popover.captureViewport,
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
