import { cn } from '@marklayer/ui/cn';
import { applyAnchorDelta } from '../lib/anchor';
import { geist } from '../lib/geist';
import { host } from '../lib/host-config';
import { hostMutationTick, scrollTick } from '../lib/host-mutations';
import { toClient } from '../lib/scroller';
import { fileUrl, uploadFile } from '../lib/share';
import type { CommentOp } from '../lib/types';
import { CommentPinCard } from './CommentPinCard';

const CARD_WIDTH = 320;

export function CommentPin({ op }: { op: CommentOp }) {
  scrollTick.value; // subscribe so positions track host-page scroll without parent re-renders
  hostMutationTick.value; // re-resolve anchor on SPA route / DOM reflow
  const { x: docX, y: docY, strategy } = applyAnchorDelta(op.target, { docX: op.x, docY: op.y });
  const { x: left, y: top } = toClient({ x: docX, y: docY });

  return (
    <CommentPinCard
      op={op}
      left={left}
      top={top}
      flipH={left + CARD_WIDTH + 20 > window.innerWidth}
      flipV={top > window.innerHeight / 2}
      drifted={strategy === 'text'}
      cardClass={cn(geist.surfaceSmall, 'max-h-[70vh] overscroll-contain')}
      canDelete={host.capabilities.triage}
      upload={uploadFile}
      resolveUrl={fileUrl}
    />
  );
}
