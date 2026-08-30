import { PriorityBadge } from '@ext/components/PriorityPicker';
import { StatusDot } from '@ext/components/StatusDot';
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
        'group w-full cursor-grab appearance-none border-none p-0 text-left select-none active:cursor-grabbing',
        // The hairline is the shadow's first layer, Geist-style, so hover can
        // firm the edge up without the box ever changing size or lifting.
        'rounded-lg bg-(--ds-background-100) p-3 [box-shadow:var(--ds-shadow-border-small)]',
        'transition-shadow duration-150 ease-out hover:[box-shadow:0_0_0_1px_var(--ds-gray-alpha-500)]',
        'focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ds-focus-color)',
      )}
    >
      <div class="flex items-center gap-2">
        <span class="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: card.op.color }} aria-hidden="true" />
        <span class="min-w-0 truncate text-meta font-medium text-(--ds-gray-900)">{card.label}</span>
        {card.op.priority && <PriorityBadge priority={card.op.priority} class="ml-auto shrink-0" />}
      </div>
      {card.body && <p class="m-0 mt-1.5 text-ui text-(--ds-gray-1000) leading-body line-clamp-3">{card.body}</p>}
      {(card.replies > 0 || card.op.assignee) && (
        <div class="mt-2 flex items-center gap-3 text-meta text-(--ds-gray-900)">
          {card.replies > 0 && (
            <span class="flex items-center gap-1 tabular-nums">
              <MessageSquare size={11} strokeWidth={1.75} aria-hidden="true" />
              {card.replies}
            </span>
          )}
          {card.op.assignee && <span class="min-w-0 truncate">{card.op.assignee}</span>}
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
        // A recessed track the cards sit in, not a second bordered box around
        // them: the column reads by its surface, the card by its own hairline.
        'flex min-w-60 flex-1 basis-0 flex-col rounded-xl bg-(--ds-gray-alpha-100)',
        'transition-shadow duration-150 ease-out',
        over && '[box-shadow:inset_0_0_0_1px_var(--ds-blue-800)]',
      )}
    >
      {/* px-5, not the track's own px-2: the header's dot and label then sit on
          the same two axes as every card's, since a card adds 12px of its own. */}
      <header class="flex shrink-0 items-center gap-2 h-9 px-5">
        <StatusDot status={status} />
        <h3 class="m-0 min-w-0 truncate text-meta font-medium tracking-ui text-(--ds-gray-1000)">
          {STATUS_LABELS[status]}
        </h3>
        <span class="ml-auto text-meta tabular-nums text-(--ds-gray-900)">{cards.length}</span>
      </header>
      {/* The empty column says nothing — its own surface is the drop target, and
          five copies of "Nothing here." is five times the same non-information.
          The floor keeps a short column a target you can actually hit. */}
      {/* `pt-0.5` clears the cut: a card's hairline is an outset box-shadow, and
          with no top padding `overflow-y-auto` sliced the first card's top edge
          flat while the other three sides kept their radius. */}
      <div class="flex min-h-24 flex-col gap-2 overflow-y-auto px-2 pt-0.5 pb-2">
        {cards.map((card) => (
          <Card key={card.op.id} card={card} onOpen={() => onOpen(card)} onDragStart={() => onDragStart(card)} />
        ))}
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
      <header class={cn(geist.bar, 'flex h-14 shrink-0 items-center gap-3 px-5')}>
        {/* Baselines, not centres: the count is a subtitle to the title, and the
            controls to their right are boxes that centre on the bar instead. */}
        <div class="flex items-baseline gap-2.5">
          <h2 class="m-0 text-body font-semibold tracking-ui text-(--ds-gray-1000)">Board</h2>
          <span class="text-meta tabular-nums text-(--ds-gray-900)">
            {cards.length} annotation{cards.length === 1 ? '' : 's'}
          </span>
        </div>
        {/* The hint the header used to spell out in a sentence. Drag is the
            card's own affordance; the keys are the part nobody would guess. */}
        {cards.length > 0 && (
          <span class="ml-auto hidden items-center gap-1.5 text-meta text-(--ds-gray-900) md:inline-flex">
            <kbd class={geist.kbd}>←</kbd>
            <kbd class={geist.kbd}>→</kbd>
            move a focused card
          </span>
        )}
        <button
          ref={closeRef}
          type="button"
          onClick={() => {
            showBoard.value = false;
          }}
          aria-label="Close board"
          class={cn(geist.ctl, geist.ctlIdle, cards.length > 0 ? 'ml-1' : 'ml-auto')}
        >
          <X size={16} strokeWidth={1.5} aria-hidden="true" />
        </button>
      </header>

      {cards.length === 0 ? (
        // Five empty columns is a board asking to be filled by a page that has
        // nothing on it yet. One line, on the way back to the page.
        <div class="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
          <MessageSquare size={24} strokeWidth={1.5} class="text-(--ds-gray-700)" aria-hidden="true" />
          <span class="text-ui font-medium text-(--ds-gray-1000)">Nothing to triage yet</span>
          <span class="text-meta text-(--ds-gray-900)">Comments, areas and selections land here as you make them</span>
        </div>
      ) : (
        <div class="flex min-h-0 flex-1 gap-3 overflow-x-auto px-5 py-4">
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
      )}
    </div>
  );
}
