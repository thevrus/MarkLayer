import { TriageSection, useTriageHold } from '@ext/components/CommentTriage';
import { SuggestionDiff } from '@ext/components/SelectionEdit';
import { ReplyComposer, ThreadHeader, ThreadReplies, threadCard } from '@ext/components/ThreadCard';
import { reprojectRects } from '@ext/lib/anchor';
import { geist } from '@ext/lib/geist';
import { glass } from '@ext/lib/glass';
import { hexToRgba } from '@ext/lib/renderer';
import {
  copyText,
  deleteOp,
  getCommentStatus,
  getReplies,
  openContextMenu,
  STATUS_STYLES,
  setOpStatus,
} from '@ext/lib/state';
import type { SelectionOp } from '@ext/lib/types';
import { cn } from '@marklayer/types';
import { cssScale, iframeMutationTick } from './signals';

interface Props {
  op: SelectionOp;
  scale: number;
  scrollY: number;
  frameDoc?: Document | null;
}

export function WebSelectionHighlight({ op, scale: s, scrollY, frameDoc }: Props) {
  iframeMutationTick.value; // re-resolve anchor when iframe DOM mutates
  const status = getCommentStatus(op);
  const resolved = status === 'resolved' || status === 'dismissed';
  const triage = useTriageHold();
  // Doc-space anchoring only; `s` (viewer cssScale zoom) is applied on top of
  // the result below, never in place of it.
  const anchored = reprojectRects({
    target: op.target,
    rects: op.rects,
    ctx: frameDoc ? { doc: frameDoc, win: frameDoc.defaultView ?? undefined } : undefined,
  });
  if (!op.rects.length || !anchored) return null;
  const { x: anchorX, y: anchorY, rects: scaledRects, strategy } = anchored;

  // Parked in the margin beside the first line, not on the corner of it: a disc
  // centred on the anchor sits on the selection's own first letter, which is the
  // one character the quote can least afford to lose.
  const firstRect = scaledRects[0];
  const markerX = Math.max(2, anchorX * s - 22);
  const markerY = anchorY * s - scrollY + (firstRect ? (firstRect.height * s) / 2 - 8 : -8);
  const cs = cssScale.value;
  const flipH = (markerX + 340) * cs > window.innerWidth;
  const flipV = (markerY + 400) * cs > window.innerHeight;
  // Replies hang off the selection's stored anchor, not the reprojected one.
  const replyAnchor = op.rects[0];

  return (
    <>
      {/* Colored highlight rects */}
      {scaledRects.map((r, i) => (
        <div
          key={`${op.id}-${i}`}
          class="absolute pointer-events-none"
          style={{
            left: r.x * s,
            top: r.y * s - scrollY,
            width: r.width * s,
            height: r.height * s,
            background: resolved
              ? 'color-mix(in oklch, var(--color-ml-resolved) 10%, transparent)'
              : hexToRgba(op.color, 0.25),
            borderRadius: 2,
          }}
        />
      ))}

      {/* The marker is the interactive part, so the page underneath keeps its own
          text selection — the same trade the extension's highlights make. */}
      <div
        class={cn('absolute pointer-events-auto group/sel', triage.rootCls)}
        style={{ left: markerX, top: markerY }}
        data-anchor-drift={strategy === 'text' ? 'text' : undefined}
        onContextMenu={(e) =>
          openContextMenu(e, [
            {
              label: resolved ? 'Reopen' : 'Resolve',
              icon: 'check',
              onClick: () => setOpStatus(op.id, resolved ? 'open' : 'resolved'),
            },
            { label: 'Copy text', icon: 'copy', onClick: () => copyText(op.text, 'Selection copied') },
            { label: 'Delete', icon: 'clear', danger: true, onClick: () => deleteOp(op.id) },
          ])
        }
      >
        <div
          class="w-4 h-4 rounded-full cursor-pointer
                 shadow-[0_0_0_2px_var(--ds-background-100),0_1px_2px_oklch(0_0_0/0.25)]
                 transition-[box-shadow] duration-150 ease-out
                 group-hover/sel:shadow-[0_0_0_3px_var(--ds-background-100),0_1px_2px_oklch(0_0_0/0.3)]"
          style={{
            background: status === 'open' ? op.color : STATUS_STYLES[status].bg,
            opacity: STATUS_STYLES[status].pinOpacity,
          }}
          role="img"
          aria-label={`Selection by ${op.author || 'Anonymous'}`}
        />

        {/* Gap as padding, not an offset: dead space between marker and card drops
            :hover mid-crossing and the card leaves before the pointer lands. */}
        <div
          class={cn(
            'absolute',
            flipV ? 'bottom-0' : 'top-0',
            flipH ? 'right-full pr-2.5' : 'left-full pl-2.5',
            'pointer-events-none group-hover/sel:pointer-events-auto',
            triage.wrapCls,
          )}
        >
          <div
            class={cn(
              threadCard,
              glass.font,
              'w-[300px] max-h-[400px] overflow-y-auto overscroll-contain',
              'opacity-0',
              flipH ? 'translate-x-[6px]' : 'translate-x-[-6px]',
              'transition-[opacity,translate] duration-150 ease-out',
              'group-hover/sel:opacity-100 group-hover/sel:translate-x-0',
              triage.cardCls,
            )}
            onClick={(e) => e.stopPropagation()}
          >
            <ThreadHeader
              label={(op.author || '?').charAt(0).toUpperCase()}
              color={op.color}
              author={op.author}
              ts={op.ts}
              priority={op.priority}
            />

            <div class={cn(geist.divider, 'mx-3')} />

            <div class="px-3.5 py-3">
              {op.suggestion ? (
                <SuggestionDiff text={op.text} suggestion={op.suggestion} resolved={resolved} />
              ) : (
                <p class="text-meta text-(--ds-gray-900) m-0 line-clamp-3 leading-relaxed">"{op.text}"</p>
              )}
              {op.comment && (
                <p
                  class="text-ui text-(--ds-gray-1000) m-0 mt-2 leading-body wrap-break-word whitespace-pre-wrap"
                  style={{ textDecoration: resolved ? 'line-through' : 'none', opacity: resolved ? 0.55 : 1 }}
                >
                  {op.comment}
                </p>
              )}
            </div>

            <ThreadReplies replies={getReplies(op.id)} />

            <div class={cn(geist.divider, 'mx-3')} />

            <TriageSection
              opId={op.id}
              status={status}
              assignee={op.assignee ?? null}
              onOpenChange={triage.onOpenChange}
            />

            <div class={cn(geist.divider, 'mx-3')} />

            {replyAnchor && <ReplyComposer parent={{ id: op.id, x: replyAnchor.x, y: replyAnchor.y }} />}
          </div>
        </div>
      </div>
    </>
  );
}
