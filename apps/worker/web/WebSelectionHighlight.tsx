import { MentionText } from '@ext/components/MentionText';
import { SelectionMarker } from '@ext/components/SelectionMarker';
import { threadCard } from '@ext/components/ThreadCard';
import { reprojectRects } from '@ext/lib/anchor';
import { CardHold, useHoldLatch } from '@ext/lib/card-hold';
import { useMarkHover } from '@ext/lib/mark-hover';
import { hexToRgba } from '@ext/lib/renderer';
import { fileUrl, uploadFile } from '@ext/lib/share';
import { getCommentStatus } from '@ext/lib/status-ui';
import type { SelectionOp } from '@ext/lib/types';
import { isSettled } from '@marklayer/types/ops';
import { cn } from '@marklayer/ui/cn';
import { cardFlip } from './iframeOverlay';
import { iframeMutationTick } from './viewer-state';

interface Props {
  op: SelectionOp;
  scrollY: number;
  frameDoc?: Document | null;
}

export function WebSelectionHighlight({ op, scrollY, frameDoc }: Props) {
  iframeMutationTick.value; // re-resolve anchor when iframe DOM mutates
  const status = getCommentStatus(op);
  const resolved = isSettled(status);
  const hold = useHoldLatch();
  const anchored = reprojectRects({
    target: op.target,
    rects: op.rects,
    ctx: frameDoc ? { doc: frameDoc, win: frameDoc.defaultView ?? undefined } : undefined,
  });
  const peek = useMarkHover(
    anchored?.rects.map((r) => ({ x: r.x, y: r.y - scrollY, width: r.width, height: r.height })) ?? [],
  );
  const lift = hold.held || peek;
  if (!op.rects.length || !anchored) return null;
  const { x: anchorX, y: anchorY, rects, strategy } = anchored;

  // Parked in the margin beside the first line, not on the corner of it: a disc
  // centred on the anchor sits on the selection's own first letter, which is the
  // one character the quote can least afford to lose.
  const firstRect = rects[0];
  const markerX = Math.max(2, anchorX - 22);
  const markerY = anchorY - scrollY + (firstRect ? firstRect.height / 2 - 8 : -8);
  const { flipH, flipV } = cardFlip({ x: markerX, y: markerY, reach: { x: 340, y: 400 } });

  return (
    <CardHold value={hold.report}>
      {rects.map((r, i) => (
        <div
          key={`${op.id}-${i}`}
          class="absolute pointer-events-none"
          style={{
            left: r.x,
            top: r.y - scrollY,
            width: r.width,
            height: r.height,
            background: resolved
              ? 'color-mix(in oklch, var(--color-ml-resolved) 10%, transparent)'
              : hexToRgba(op.color, 0.25),
            borderRadius: 2,
          }}
        />
      ))}

      <SelectionMarker
        op={op}
        status={status}
        x={markerX}
        y={markerY}
        flipH={flipH}
        flipV={flipV}
        lift={lift}
        drifted={strategy === 'text'}
        cardClass={cn(threadCard, 'max-h-[400px]')}
        upload={uploadFile}
        resolveUrl={fileUrl}
      >
        {op.comment && <MentionText text={op.comment} mentions={op.mentions} />}
      </SelectionMarker>
    </CardHold>
  );
}
