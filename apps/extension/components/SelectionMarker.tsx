import { type CommentStatus, isClosed } from '@marklayer/types/ops';
import { cn } from '@marklayer/ui/cn';
import type { ComponentChildren } from 'preact';
import { openContextMenu } from '../lib/context-menu';
import { geist } from '../lib/geist';
import { glass } from '../lib/glass';
import { deleteOp, getReplies, setOpStatus } from '../lib/ops';
import { STATUS_STYLES } from '../lib/status-ui';
import { copyText } from '../lib/toasts';
import type { SelectionOp } from '../lib/types';
import { TriageSection } from './CommentTriage';
import { DiagnosisAction } from './DiagnosisAction';
import { Reactions } from './Reactions';
import { SuggestionDiff } from './SelectionEdit';
import { ReplyComposer, ThreadHeader, ThreadReplies } from './ThreadCard';

/** A selection's disc and hover card, shared by the extension and the viewer. Placement is the host's. */
export function SelectionMarker({
  op,
  status,
  x,
  y,
  flipH,
  flipV,
  lift,
  drifted,
  cardClass,
  onDelete,
  upload,
  resolveUrl,
  children,
}: {
  op: SelectionOp;
  status: CommentStatus;
  x: number;
  y: number;
  flipH: boolean;
  flipV: boolean;
  /** Held open, by a card interaction or hover intent on the highlight. */
  lift: boolean;
  /** Anchored by text fingerprint alone, so the mark may have moved. */
  drifted: boolean;
  /** The card's surface and height cap, which differ between host page and viewer. */
  cardClass: string;
  onDelete?: () => void;
  upload: (file: File | Blob) => Promise<string | null>;
  resolveUrl: (id: string) => string;
  /** The comment's text. */
  children: ComponentChildren;
}) {
  const resolved = isClosed(status);
  // Replies hang off the selection's stored anchor, not the reprojected one.
  const replyAnchor = op.rects[0];

  return (
    // The marker is the only interactive part: the highlight itself stays
    // pointer-transparent so an annotated page keeps its own links and text selection.
    <div
      class={cn('absolute pointer-events-auto hover:z-50 group/sel', lift && 'z-50')}
      style={{ left: x, top: y }}
      data-anchor-drift={drifted ? 'text' : undefined}
      data-marker
      data-held={lift || undefined}
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
        // Same treatment as a comment pin, at the size a word can carry: one
        // flat fill, a surface ring to lift it off whatever is behind, and a
        // ring that thickens on hover rather than a dot that grows.
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

      {/* The marker-to-card gap is padding on this wrapper, not an offset — as
          dead space it drops :hover mid-crossing and the card goes before the
          pointer reaches the reply box. */}
      <div
        class={cn(
          'absolute',
          flipV ? 'bottom-0' : 'top-0',
          flipH ? 'right-full pr-2.5' : 'left-full pl-2.5',
          'pointer-events-none group-hover/sel:pointer-events-auto',
          lift && 'pointer-events-auto',
        )}
      >
        <div
          class={cn(
            cardClass,
            glass.font,
            'w-[300px] overflow-y-auto overscroll-contain',
            'opacity-0',
            flipH ? 'translate-x-[6px]' : 'translate-x-[-6px]',
            'transition-[opacity,translate] duration-150 ease-out',
            'group-hover/sel:opacity-100 group-hover/sel:translate-x-0',
            lift && 'opacity-100 translate-x-0',
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <ThreadHeader
            label={(op.author || '?').charAt(0).toUpperCase()}
            color={op.color}
            author={op.author}
            ts={op.ts}
            priority={op.priority}
            onDelete={onDelete}
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
                {children}
              </p>
            )}
            <Reactions class="mt-2" opId={op.id} reactions={op.reactions} />
            <DiagnosisAction op={op} />
          </div>

          <ThreadReplies replies={getReplies(op.id)} resolveUrl={resolveUrl} />

          <div class={cn(geist.divider, 'mx-3')} />

          <TriageSection opId={op.id} status={status} assignee={op.assignee ?? null} />

          <div class={cn(geist.divider, 'mx-3')} />

          {replyAnchor && (
            <ReplyComposer
              parent={{ id: op.id, x: replyAnchor.x, y: replyAnchor.y }}
              upload={upload}
              resolveUrl={resolveUrl}
            />
          )}
        </div>
      </div>
    </div>
  );
}
