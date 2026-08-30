import { PriorityBadge } from '@ext/components/PriorityPicker';
import { geist } from '@ext/lib/geist';
import { glass } from '@ext/lib/glass';
import {
  areas,
  focusedAnnotationId,
  getCommentStatus,
  getReplies,
  inspects,
  rootComments,
  STATUS_LABELS,
  selections,
  setOpStatus,
} from '@ext/lib/state';
import type { AnnotationOp } from '@ext/lib/types';
import { type CommentStatus, cn, commentStatusSchema } from '@marklayer/types';
import { MessageSquare, X } from 'lucide-preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { tinykeys } from 'tinykeys';
import { capture } from './analytics';
import { opAnchor, opBody, opLabel } from './annotationItems';
import { showBoard } from './signals';
import { useViewerFrame } from './viewerFrame';

/** Columns are the status enum itself, so a status added later gets a column for free. */
const COLUMNS = commentStatusSchema.options;

/** Where a card sits in COLUMNS — the arrow keys move by one step along this. */
const columnIndex = (s: CommentStatus) => COLUMNS.indexOf(s);

interface BoardCard {
  op: AnnotationOp;
  /** What the card calls itself, since only comments carry a number. */
  label: string;
  /** One line of the annotation's own words, or empty when it has none yet. */
  body: string;
  status: CommentStatus;
  anchor: { x: number; y: number };
  replies: number;
}

function cardFor(op: AnnotationOp): BoardCard {
  return {
    op,
    label: opLabel(op),
    body: opBody(op),
    status: getCommentStatus(op),
    anchor: opAnchor(op),
    // Only a comment has a thread; the other kinds are the whole annotation.
    replies: op.tool === 'comment' ? getReplies(op.id).length : 0,
  };
}

function Card({ card, onOpen, onDragStart }: { card: BoardCard; onOpen: () => void; onDragStart: () => void }) {
  const move = (dir: -1 | 1) => {
    const next = COLUMNS[columnIndex(card.status) + dir];
    if (next) setOpStatus(card.op.id, next);
  };

  /**
   * When a drag releases, the browser can still fire a click on the card it
   * started from — which would open the annotation and close the board out from
   * under a drop that just succeeded. The timestamp is the only thing that
   * separates "released a drag here" from "clicked here".
   */
  const draggedAt = useRef(0);

  return (
    <button
      type="button"
      draggable
      onDragStart={(e) => {
        draggedAt.current = Date.now();
        onDragStart();
        // Firefox refuses to start a drag without data on the transfer.
        e.dataTransfer?.setData('text/plain', card.op.id);
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
      }}
      // A board is a grid, so the keyboard moves a card the way the grid reads:
      // left and right along the columns. Dragging is the mouse's version of the
      // same thing, not the only way to do it.
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          move(-1);
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          move(1);
        }
      }}
      onDragEnd={() => {
        draggedAt.current = Date.now();
      }}
      onClick={() => {
        if (Date.now() - draggedAt.current < 250) return;
        onOpen();
      }}
      aria-label={`${card.label}: ${card.body || 'no text'}. ${STATUS_LABELS[card.status]}. Arrow keys to move between columns.`}
      class={cn(
        'group w-full cursor-grab appearance-none border-none bg-transparent p-0 text-left select-none active:cursor-grabbing',
        'rounded-lg border border-(--ds-gray-alpha-400) bg-(--ds-background-100) p-3',
        'transition-colors duration-100 hover:border-(--ds-gray-600)',
        'focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ds-focus-color)',
      )}
    >
      <div class="flex items-center gap-2 mb-1.5">
        <span class="w-2 h-2 rounded-full shrink-0" style={{ background: card.op.color }} aria-hidden="true" />
        <span class="text-meta font-semibold text-(--ds-gray-1000) truncate">{card.label}</span>
        {card.op.priority && <PriorityBadge priority={card.op.priority} />}
      </div>
      {card.body && <p class="m-0 text-ui text-(--ds-gray-1000) leading-relaxed line-clamp-3">{card.body}</p>}
      {(card.replies > 0 || card.op.assignee) && (
        <div class="mt-2 flex items-center gap-3 text-meta text-(--ds-gray-900)">
          {card.replies > 0 && (
            <span class="flex items-center gap-1 font-medium">
              <MessageSquare size={11} aria-hidden="true" />
              {card.replies}
            </span>
          )}
          {card.op.assignee && <span class="truncate font-medium">{card.op.assignee}</span>}
        </div>
      )}
    </button>
  );
}

function Column({
  status,
  cards,
  onDrop,
  onOpen,
  onDragStart,
}: {
  status: CommentStatus;
  cards: BoardCard[];
  onDrop: () => void;
  onOpen: (card: BoardCard) => void;
  onDragStart: (card: BoardCard) => void;
}) {
  const [over, setOver] = useState(false);

  return (
    <section
      // The whole column is the drop target, not a sliver at the bottom, so a
      // card released anywhere over it lands.
      // Unconditionally: a dragover that does not preventDefault is a refusal,
      // and whether a drag is ours is decided at drop time, from the ref. Gating
      // this on render state cannot work — the ref that holds the dragged id
      // does not re-render the column, so the guard was always a frame stale and
      // the drop never became legal.
      onDragOver={(e) => {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        onDrop();
      }}
      class={cn(
        'flex min-w-0 flex-1 flex-col rounded-xl border p-2 transition-colors duration-100',
        over
          ? 'border-(--color-ml-accent) bg-(--ds-gray-alpha-100)'
          : 'border-(--ds-gray-alpha-400) bg-(--ds-gray-alpha-100)/40',
      )}
    >
      <header class="flex items-center justify-between gap-2 px-1.5 pb-2 pt-1">
        <h3 class="m-0 text-meta font-semibold text-(--ds-gray-1000)">{STATUS_LABELS[status]}</h3>
        <span class="text-meta tabular-nums text-(--ds-gray-900)">{cards.length}</span>
      </header>
      <div class="flex flex-col gap-2 overflow-y-auto">
        {cards.map((card) => (
          <Card key={card.op.id} card={card} onOpen={() => onOpen(card)} onDragStart={() => onDragStart(card)} />
        ))}
        {cards.length === 0 && <p class="m-0 px-1.5 py-3 text-meta text-(--ds-gray-900)">Nothing here.</p>}
      </div>
    </section>
  );
}

/**
 * Every annotation that carries triage state, laid out by status.
 *
 * A second rendering of the annotation panel's data rather than a store of its
 * own: the columns are the status enum, moving a card calls the same
 * `setOpStatus` a pin does, and the change reaches peers the same way.
 */
export function AnnotationBoard() {
  const {
    actions: { scrollToAnnotation },
  } = useViewerFrame();
  const draggingId = useRef<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!showBoard.value) return;
    closeRef.current?.focus();
    return tinykeys(window, {
      Escape: () => {
        showBoard.value = false;
      },
    });
  }, [showBoard.value]);

  if (!showBoard.value) return null;

  const cards = [...rootComments.value, ...areas.value, ...selections.value, ...inspects.value].map(cardFor);

  const open = (card: BoardCard) => {
    focusedAnnotationId.value = card.op.id;
    scrollToAnnotation(card.anchor.x, card.anchor.y);
    showBoard.value = false;
  };

  const dropOn = (status: CommentStatus) => {
    const id = draggingId.current;
    draggingId.current = null;
    if (!id) return;
    setOpStatus(id, status);
    capture('board_card_moved', { status });
  };

  return (
    <div
      class={cn(
        'fixed inset-0 z-2147483647 flex flex-col bg-(--ds-background-100)',
        glass.font,
        'animate-[fadeIn_140ms_ease-out]',
      )}
      role="dialog"
      aria-modal="true"
      aria-label="Annotation board"
    >
      <header class="flex shrink-0 items-center justify-between gap-4 border-b border-(--ds-gray-alpha-400) px-5 py-3">
        <div class="flex items-baseline gap-3">
          <h2 class="m-0 text-body font-semibold tracking-ui text-(--ds-gray-1000)">Board</h2>
          <span class="text-meta text-(--ds-gray-900)">
            {cards.length} annotation{cards.length === 1 ? '' : 's'} · drag a card, or focus one and use the arrow keys
          </span>
        </div>
        <button
          ref={closeRef}
          type="button"
          onClick={() => {
            showBoard.value = false;
          }}
          aria-label="Close board"
          class={cn(geist.ctl, geist.ctlIdle)}
        >
          <X size={16} strokeWidth={1.5} aria-hidden="true" />
        </button>
      </header>

      <div class="flex min-h-0 flex-1 gap-3 overflow-x-auto p-4">
        {COLUMNS.map((status) => (
          <Column
            key={status}
            status={status}
            cards={cards.filter((c) => c.status === status)}
            onDrop={() => dropOn(status)}
            onOpen={open}
            onDragStart={(card) => {
              draggingId.current = card.op.id;
            }}
          />
        ))}
      </div>
    </div>
  );
}
