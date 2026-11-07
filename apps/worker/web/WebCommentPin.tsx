import { CommentPinCard } from '@ext/components/CommentPinCard';
import { threadCard } from '@ext/components/ThreadCard';
import { localUser } from '@ext/lib/identity';
import { fileUrl, uploadFile } from '@ext/lib/share';
import type { CommentOp } from '@ext/lib/types';
import { canReply } from '@marklayer/types/ops';
import { cn } from '@marklayer/ui/cn';
import { cardFlip, resolveAnchors } from './iframeOverlay';
import { openAnnotation } from './viewer-actions';
import { compactChrome, cssScale, hoverless, iframeMutationTick } from './viewer-state';

interface Props {
  op: CommentOp;
  scrollY: number;
  /** Iframe contentDocument so element selectors resolve against the proxied page. */
  frameDoc?: Document | null;
}

export function WebCommentPin({ op, scrollY, frameDoc }: Props) {
  // Subscribe to iframe DOM mutations so we re-resolve the anchor when the
  // proxied page lazy-loads or reflows. No-op for ops without a target.
  iframeMutationTick.value;
  const {
    x: docX,
    y: docY,
    strategy,
  } = frameDoc
    ? resolveAnchors({ target: op.target, pdf: op.pdf, docX: op.x, docY: op.y, doc: frameDoc })
    : { x: op.x, y: op.y, strategy: null };
  const left = docX;
  const top = docY - scrollY;
  const { flipH, flipV } = cardFlip({ x: left, y: top, reach: { x: 320, y: 400 } });

  // Don't render reply comments as pins — they're shown inside the parent's card
  if (!canReply(op)) return null;

  return (
    <CommentPinCard
      op={op}
      left={left}
      top={top}
      flipH={flipH}
      flipV={flipV}
      drifted={strategy === 'text'}
      cardClass={cn(threadCard, 'max-h-[400px]')}
      // A phone fits a desktop page at a quarter size; the pin is a control, not
      // part of the page, so it keeps its own size to stay tappable. The dot only:
      // a narrow desktop window still hovers, and its card must not grow with it.
      // A string, since Preact suffixes a bare number with px.
      pinStyle={compactChrome.value ? { scale: String(1 / cssScale.value) } : undefined}
      canDelete={op.authorId === localUser.id}
      onPinClick={
        hoverless.value
          ? (e) => {
              // The overlay under the pin places a new comment on a tap.
              e.stopPropagation();
              openAnnotation(op.id);
            }
          : undefined
      }
      upload={uploadFile}
      resolveUrl={fileUrl}
    />
  );
}
