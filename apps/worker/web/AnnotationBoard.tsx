import { Menu } from '@base-ui/react/menu';
import { Avatar } from '@ext/components/Avatar';
import { CheckMark } from '@ext/components/CommentTriage';
import { MentionText } from '@ext/components/MentionText';
import { PriorityBadge } from '@ext/components/PriorityPicker';
import { StatusDot } from '@ext/components/StatusDot';
import { track } from '@ext/lib/analytics';
import { geist } from '@ext/lib/geist';
import { glass } from '@ext/lib/glass';
import {
  areas,
  focusedAnnotationId,
  getCommentStatus,
  getReplies,
  inspects,
  localUser,
  peers,
  rootComments,
  STATUS_LABELS,
  selections,
  setOpAssignee,
  setOpStatus,
} from '@ext/lib/state';
import { timeAgo } from '@ext/lib/time';
import type { AnnotationOp } from '@ext/lib/types';
import {
  COMMENT_PRIORITIES,
  type CommentStatus,
  cn,
  commentStatusSchema,
  type DeviceMode,
  deviceModeSchema,
} from '@marklayer/types';
import { signal } from '@preact/signals';
import { ArrowDownUp, Ellipsis, ListFilter, LocateFixed, MessageSquare, Mic, Paperclip, Video, X } from 'lucide-preact';
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { tinykeys } from 'tinykeys';
import { capture } from './analytics';
import { opAnchor, opBody, opLabel } from './annotationItems';
import { pageUrl } from './projects';
import { DEVICE_ICONS, DEVICE_LABELS } from './shared';
import { isReadonly, showBoard } from './signals';
import { useViewerFrame } from './viewerFrame';

/** Columns are the status enum itself, so a status added later gets a column for free. */
const COLUMNS = commentStatusSchema.options;

/** Where a card sits in COLUMNS — the arrow keys move by one step along this. */
const columnIndex = (s: CommentStatus) => COLUMNS.indexOf(s);

const SORTS = {
  newest: 'Newest',
  oldest: 'Oldest',
  priority: 'Priority',
  page: 'Page order',
} as const;
type Sort = keyof typeof SORTS;
const isSort = (v: string): v is Sort => v in SORTS;

/** RadioGroup values for the assignee filter that are not a person's name. */
const ANYONE = '\u0000anyone';
const MINE = '\u0000mine';
const UNASSIGNED = '\u0000unassigned';
const ASSIGNEE_BUCKET: Record<string, string> = { [ANYONE]: 'anyone', [MINE]: 'mine', [UNASSIGNED]: 'unassigned' };
const ANY_DEVICE = 'any';
const FALLBACK_COLOR = 'var(--ds-gray-700)';

// Module scope, so closing the board to look at a pin and reopening it keeps the view.
const sortBy = signal<Sort>('newest');
const assigneeFilter = signal<string>(ANYONE);
const deviceFilter = signal<DeviceMode | typeof ANY_DEVICE>(ANY_DEVICE);
const draggingId = signal<string | null>(null);

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
    // A text edit draws its own diff below, so its body is only the note beside it.
    body: op.tool === 'selection' && op.suggestion ? (op.comment ?? '') : opBody(op),
    status: getCommentStatus(op),
    anchor: opAnchor(op),
    // Only a comment has a thread; the other kinds are the whole annotation.
    replies: op.tool === 'comment' ? getReplies(op.id).length : 0,
  };
}

/** Ops written before `device` existed were all drawn at desktop width. */
const deviceOf = (op: AnnotationOp): DeviceMode => op.device ?? 'desktop';

const priorityRank = (op: AnnotationOp) => (op.priority ? COMMENT_PRIORITIES.indexOf(op.priority) : -1);

function compareCards(sort: Sort) {
  return (a: BoardCard, b: BoardCard) => {
    if (sort === 'oldest') return a.op.ts - b.op.ts;
    if (sort === 'page') return a.anchor.y - b.anchor.y || a.anchor.x - b.anchor.x;
    if (sort === 'priority') return priorityRank(b.op) - priorityRank(a.op) || b.op.ts - a.op.ts;
    return b.op.ts - a.op.ts;
  };
}

function matchesFilter(card: BoardCard): boolean {
  const who = assigneeFilter.value;
  const assignee = card.op.assignee ?? null;
  if (who === MINE && assignee !== localUser.name) return false;
  if (who === UNASSIGNED && assignee !== null) return false;
  if (who !== ANYONE && who !== MINE && who !== UNASSIGNED && assignee !== who) return false;
  return deviceFilter.value === ANY_DEVICE || deviceOf(card.op) === deviceFilter.value;
}

/**
 * Everyone a card could be handed to, with the colour each one wears: you, the
 * people in the room, and anyone who wrote or holds a card on this board. The
 * last two keep an absent teammate assignable from the board they worked on.
 */
function rosterFor(cards: BoardCard[]): Map<string, string> {
  const roster = new Map<string, string>([[localUser.name, localUser.color]]);
  for (const p of peers.value.values()) if (p.name && !roster.has(p.name)) roster.set(p.name, p.color);
  for (const { op } of cards) if (op.author && !roster.has(op.author)) roster.set(op.author, op.color);
  for (const { op } of cards) if (op.assignee && !roster.has(op.assignee)) roster.set(op.assignee, FALLBACK_COLOR);
  return roster;
}

// Fixed height, so a row with an avatar and a row without one are the same row.
const itemCls = cn(
  'flex h-8 items-center gap-2 px-2.5 text-meta font-medium leading-none',
  glass.menuItem,
  glass.menuItemHighlight,
);
const groupLabelCls = cn(geist.sectionLabel, 'px-2.5 pt-2 pb-1');

/** The 16px leading column every card-menu row has, so dots, avatars and blanks share one text axis. */
function Lead({ children }: { children?: ComponentChildren }) {
  return <span class="flex w-4 shrink-0 items-center justify-center">{children}</span>;
}

function BoardMenu({
  trigger,
  triggerClass,
  label,
  align = 'end',
  children,
}: {
  trigger: ComponentChildren;
  triggerClass: string;
  label: string;
  align?: 'start' | 'end';
  children: ComponentChildren;
}) {
  return (
    <Menu.Root>
      <Menu.Trigger aria-label={label} className={triggerClass}>
        {trigger}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align={align} sideOffset={4} collisionPadding={8} className="z-2147483647">
          <Menu.Popup
            className={cn(
              'min-w-44 max-h-(--available-height) overflow-y-auto',
              glass.menuPopup,
              geist.surface,
              glass.font,
            )}
          >
            {children}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

function CardMenu({ card, roster, onOpen }: { card: BoardCard; roster: Map<string, string>; onOpen: () => void }) {
  return (
    <BoardMenu
      label={`Actions for ${card.label}`}
      // Out of the way until the card is hovered or focused; always there on a
      // touch screen, which has no hover to reveal it with.
      triggerClass={cn(
        geist.ctlXs,
        geist.ctlIdle,
        '-my-1 -mr-1 pointer-events-auto opacity-0 group-hover:opacity-100 group-focus-within:opacity-100',
        'data-popup-open:opacity-100 pointer-coarse:opacity-100 transition-[opacity,background-color,color]',
      )}
      trigger={<Ellipsis size={14} strokeWidth={1.75} aria-hidden="true" />}
    >
      <Menu.Item className={itemCls} onClick={onOpen}>
        <Lead>
          <LocateFixed size={13} strokeWidth={1.75} class="text-(--ds-gray-900)" aria-hidden="true" />
        </Lead>
        Show on page
      </Menu.Item>
      <Menu.Group>
        <Menu.GroupLabel className={groupLabelCls}>Status</Menu.GroupLabel>
        <Menu.RadioGroup
          value={card.status}
          onValueChange={(value: string) => {
            const parsed = commentStatusSchema.safeParse(value);
            if (!parsed.success) return;
            setOpStatus(card.op.id, parsed.data);
            capture('board_card_moved', { status: parsed.data, via: 'menu' });
          }}
        >
          {COLUMNS.map((s) => (
            <Menu.RadioItem key={s} value={s} closeOnClick className={itemCls}>
              <Lead>
                <StatusDot status={s} />
              </Lead>
              {STATUS_LABELS[s]}
              <CheckMark />
            </Menu.RadioItem>
          ))}
        </Menu.RadioGroup>
      </Menu.Group>
      <Menu.Group>
        <Menu.GroupLabel className={groupLabelCls}>Assignee</Menu.GroupLabel>
        <Menu.RadioGroup
          value={card.op.assignee ?? UNASSIGNED}
          onValueChange={(value: string) =>
            setOpAssignee({ opId: card.op.id, assignee: value === UNASSIGNED ? null : value })
          }
        >
          <Menu.RadioItem value={UNASSIGNED} closeOnClick className={itemCls}>
            <Lead />
            Unassigned
            <CheckMark />
          </Menu.RadioItem>
          {[...roster].map(([name, color]) => (
            <Menu.RadioItem key={name} value={name} closeOnClick className={itemCls}>
              <Lead>
                <Avatar name={name} color={color} size="sm" />
              </Lead>
              <span class="min-w-0 truncate">{name === localUser.name ? `${name} (you)` : name}</span>
              <CheckMark />
            </Menu.RadioItem>
          ))}
        </Menu.RadioGroup>
      </Menu.Group>
    </BoardMenu>
  );
}

/** What else the annotation carries, counted, so a card says "there is a recording" without playing it. */
function Media({ op }: { op: AnnotationOp }) {
  if (op.tool !== 'comment' && op.tool !== 'area') return null;
  const files = op.attachments?.length ?? 0;
  return (
    <>
      {op.tool === 'comment' && op.voice && <Mic size={12} strokeWidth={1.75} />}
      {op.tool === 'comment' && op.video && <Video size={12} strokeWidth={1.75} />}
      {files > 0 && (
        <span class="flex items-center gap-1 tabular-nums">
          <Paperclip size={11} strokeWidth={1.75} />
          {files}
        </span>
      )}
    </>
  );
}

function Card({
  card,
  roster,
  readonly,
  onOpen,
}: {
  card: BoardCard;
  roster: Map<string, string>;
  readonly: boolean;
  onOpen: () => void;
}) {
  const { op } = card;
  const move = (dir: -1 | 1) => {
    const next = COLUMNS[columnIndex(card.status) + dir];
    if (!next) return;
    setOpStatus(op.id, next);
    track('board_card_moved', { status: next, via: 'keyboard' });
    // The card remounts in its new column, which drops focus to the body. Follow
    // it there, so a second arrow keeps moving the same card.
    requestAnimationFrame(() => {
      const moved = document.querySelector(`[data-card="${CSS.escape(op.id)}"]`);
      if (moved instanceof HTMLElement) moved.focus();
    });
  };

  /**
   * When a drag releases, the browser can still fire a click on the card it
   * started from — which would open the annotation and close the board out from
   * under a drop that just succeeded. The timestamp is the only thing that
   * separates "released a drag here" from "clicked here".
   */
  const draggedAt = useRef(0);
  const author = op.author || 'Anonymous';
  const DeviceIcon = DEVICE_ICONS[deviceOf(op)];
  // The content is drawn under `aria-hidden`, so this one label is the whole card to a screen reader.
  const spoken = [
    `${card.label} by ${author}, ${timeAgo(op.ts)}`,
    card.body,
    op.tool === 'selection' && op.suggestion && `Replace "${op.text}" with "${op.suggestion}"`,
    STATUS_LABELS[card.status],
    op.priority && `${op.priority} priority`,
    op.assignee && `Assigned to ${op.assignee}`,
    card.replies > 0 && `${card.replies} repl${card.replies === 1 ? 'y' : 'ies'}`,
    op.tool === 'comment' && op.voice && 'Voice note',
    op.tool === 'comment' && op.video && 'Video',
    op.tool === 'comment' && op.attachments?.length && `${op.attachments.length} attached`,
    deviceOf(op) !== 'desktop' && DEVICE_LABELS[deviceOf(op)],
    !readonly && 'Arrow keys to move between columns',
  ]
    .filter(Boolean)
    .join('. ');

  return (
    <article
      // A guest's move would land locally and be refused by the room, leaving
      // their board out of step with everyone else's. So a guest gets no move.
      draggable={!readonly}
      onDragStart={(e) => {
        draggedAt.current = Date.now();
        draggingId.value = op.id;
        // Firefox refuses to start a drag without data on the transfer.
        e.dataTransfer?.setData('text/plain', op.id);
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
      }}
      onDragEnd={() => {
        draggedAt.current = Date.now();
        draggingId.value = null;
      }}
      class={cn(
        'group relative rounded-lg bg-(--ds-background-100) p-3 select-none',
        // The hairline is the shadow's first layer, Geist-style, so hover can
        // firm the edge up without the box ever changing size or lifting.
        '[box-shadow:var(--ds-shadow-border-small)] transition-[box-shadow,opacity] duration-150 ease-out',
        'hover:[box-shadow:0_0_0_1px_var(--ds-gray-alpha-500)]',
        !readonly && 'cursor-grab active:cursor-grabbing',
        draggingId.value === op.id && 'opacity-40',
      )}
    >
      {/* The whole card is one button, laid under the content rather than
          wrapped around it, so the menu trigger can be a button of its own. */}
      <button
        type="button"
        onClick={() => {
          if (Date.now() - draggedAt.current < 250) return;
          onOpen();
        }}
        // A board is a grid, so the keyboard moves a card the way the grid reads:
        // left and right along the columns. Dragging is the mouse's version of the
        // same thing, not the only way to do it.
        onKeyDown={(e) => {
          if (readonly) return;
          if (e.key === 'ArrowLeft') {
            e.preventDefault();
            move(-1);
          } else if (e.key === 'ArrowRight') {
            e.preventDefault();
            move(1);
          }
        }}
        data-card={op.id}
        aria-label={spoken}
        class={cn(
          'absolute inset-0 w-full appearance-none rounded-lg border-none bg-transparent p-0',
          readonly ? 'cursor-pointer' : 'cursor-[inherit]',
          'focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ds-focus-color)',
        )}
      />
      <div class="pointer-events-none relative">
        <div class="flex items-center gap-2">
          <span class="flex min-w-0 items-center gap-2" aria-hidden="true">
            <Avatar name={author} color={op.color} size="md" />
            <span class="min-w-0 truncate text-meta font-medium text-(--ds-gray-1000)">{author}</span>
            <span class="shrink-0 text-meta tabular-nums text-(--ds-gray-900)">{timeAgo(op.ts)}</span>
          </span>
          <span class="ml-auto flex shrink-0 items-center">
            {!readonly && <CardMenu card={card} roster={roster} onOpen={onOpen} />}
          </span>
        </div>

        {card.body && (
          <p aria-hidden="true" class="m-0 mt-2 line-clamp-3 text-ui leading-body text-(--ds-gray-1000)">
            <MentionText text={card.body} mentions={op.mentions} />
          </p>
        )}
        {op.tool === 'selection' && op.suggestion && (
          <p aria-hidden="true" class="m-0 mt-2 text-ui leading-body">
            <del class="line-clamp-2 text-(--ds-gray-900) decoration-(--ds-gray-700)">{op.text}</del>
            <ins class="line-clamp-2 text-(--ds-gray-1000) no-underline">{op.suggestion}</ins>
          </p>
        )}

        <div aria-hidden="true" class="mt-2.5 flex h-4 items-center gap-3 text-meta text-(--ds-gray-900)">
          <span class="shrink-0">{card.label}</span>
          {op.priority && <PriorityBadge priority={op.priority} class="shrink-0" />}
          {card.replies > 0 && (
            <span class="flex shrink-0 items-center gap-1 tabular-nums">
              <MessageSquare size={11} strokeWidth={1.75} aria-hidden="true" />
              {card.replies}
            </span>
          )}
          <Media op={op} />
          {/* Desktop is the default; only the exception earns a mark. */}
          {deviceOf(op) !== 'desktop' && (
            <span class="flex shrink-0 items-center gap-1">
              <DeviceIcon size={11} strokeWidth={1.75} aria-hidden="true" />
              {DEVICE_LABELS[deviceOf(op)]}
            </span>
          )}
          {op.assignee && (
            <span class="ml-auto shrink-0">
              <Avatar name={op.assignee} color={roster.get(op.assignee) ?? FALLBACK_COLOR} size="sm" />
            </span>
          )}
        </div>
      </div>
    </article>
  );
}

function Column({
  status,
  cards,
  roster,
  readonly,
  onOpen,
}: {
  status: CommentStatus;
  cards: BoardCard[];
  roster: Map<string, string>;
  readonly: boolean;
  onOpen: (card: BoardCard) => void;
}) {
  const [over, setOver] = useState(false);

  const drop = () => {
    const id = draggingId.value;
    draggingId.value = null;
    // Released over its own column: nothing moved, so nothing to count.
    if (!id || cards.some((c) => c.op.id === id)) return;
    setOpStatus(id, status);
    capture('board_card_moved', { status, via: 'drag' });
  };

  return (
    <section
      // The whole column is the drop target, not a sliver at the bottom, so a
      // card released anywhere over it lands.
      // Unconditionally: a dragover that does not preventDefault is a refusal,
      // and whether a drag is ours is decided at drop time.
      onDragOver={(e) => {
        if (readonly) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        drop();
      }}
      class={cn(
        // A recessed track the cards sit in, not a second bordered box around
        // them: the column reads by its surface, the card by its own hairline.
        'flex min-w-64 flex-1 basis-0 flex-col rounded-xl bg-(--ds-gray-alpha-100)',
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
        <span class="text-meta tabular-nums text-(--ds-gray-900)">{cards.length}</span>
      </header>
      {/* The empty column says nothing — its own surface is the drop target.
          `pt-0.5` clears the cut: a card's hairline is an outset box-shadow, and
          with no top padding `overflow-y-auto` slices the first card's top edge. */}
      <div class="flex min-h-24 flex-col gap-2 overflow-y-auto px-2 pt-0.5 pb-2">
        {cards.map((card) => (
          <Card key={card.op.id} card={card} roster={roster} readonly={readonly} onOpen={() => onOpen(card)} />
        ))}
      </div>
    </section>
  );
}

/** A labelled header control: `ctl`'s states at text width. */
const toolCls = cn(
  'relative inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 appearance-none border-none bg-transparent',
  'cursor-pointer outline-none text-meta font-medium transition-[background-color,color] duration-150',
  'focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-(--ds-focus-color)',
  geist.ctlIdle,
  'data-popup-open:bg-(--ds-gray-alpha-100)',
);

function filterSummary(): string | null {
  const who = assigneeFilter.value;
  const parts: string[] = [];
  if (who === MINE) parts.push('Mine');
  else if (who === UNASSIGNED) parts.push('Unassigned');
  else if (who !== ANYONE) parts.push(who);
  if (deviceFilter.value !== ANY_DEVICE) parts.push(DEVICE_LABELS[deviceFilter.value]);
  return parts.length ? parts.join(', ') : null;
}

function FilterMenu({ cards }: { cards: BoardCard[] }) {
  const summary = filterSummary();
  const assignees = [...new Set(cards.flatMap(({ op }) => (op.assignee ? [op.assignee] : [])))].sort();
  // A filter for one value filters nothing, so the device group waits for a mixed board.
  const devices = new Set(cards.map(({ op }) => deviceOf(op)));

  return (
    <div class="flex items-center">
      <BoardMenu
        label="Filter cards"
        triggerClass={cn(toolCls, summary && 'text-(--ds-gray-1000)')}
        trigger={
          <>
            <ListFilter size={14} strokeWidth={1.75} aria-hidden="true" />
            <span class="max-w-40 truncate">{summary ?? 'Filter'}</span>
          </>
        }
      >
        <Menu.Group>
          <Menu.GroupLabel className={groupLabelCls}>Assignee</Menu.GroupLabel>
          <Menu.RadioGroup
            value={assigneeFilter.value}
            onValueChange={(value: string) => {
              assigneeFilter.value = value;
              track('board_filter_changed', {
                filter: 'assignee',
                value: ASSIGNEE_BUCKET[value] ?? 'person',
              });
            }}
          >
            {[
              [ANYONE, 'Anyone'],
              [MINE, 'Assigned to me'],
              [UNASSIGNED, 'Unassigned'],
              ...assignees.filter((name) => name !== localUser.name).map((name) => [name, name]),
            ].map(([value, text]) => (
              <Menu.RadioItem key={value} value={value} closeOnClick className={itemCls}>
                <span class="min-w-0 truncate">{text}</span>
                <CheckMark />
              </Menu.RadioItem>
            ))}
          </Menu.RadioGroup>
        </Menu.Group>
        {(devices.size > 1 || deviceFilter.value !== ANY_DEVICE) && (
          <Menu.Group>
            <Menu.GroupLabel className={groupLabelCls}>Device</Menu.GroupLabel>
            <Menu.RadioGroup
              value={deviceFilter.value}
              onValueChange={(value: string) => {
                const parsed = deviceModeSchema.safeParse(value);
                deviceFilter.value = parsed.success ? parsed.data : ANY_DEVICE;
                track('board_filter_changed', { filter: 'device', value: deviceFilter.value });
              }}
            >
              <Menu.RadioItem value={ANY_DEVICE} closeOnClick className={itemCls}>
                Any device
                <CheckMark />
              </Menu.RadioItem>
              {deviceModeSchema.options.map((d) => (
                <Menu.RadioItem key={d} value={d} closeOnClick className={itemCls}>
                  {DEVICE_LABELS[d]}
                  <CheckMark />
                </Menu.RadioItem>
              ))}
            </Menu.RadioGroup>
          </Menu.Group>
        )}
      </BoardMenu>
      {summary && (
        <button
          type="button"
          aria-label="Clear filter"
          onClick={() => {
            assigneeFilter.value = ANYONE;
            deviceFilter.value = ANY_DEVICE;
            track('board_filter_cleared');
          }}
          class={cn(geist.ctlSm, geist.ctlIdle)}
        >
          <X size={14} strokeWidth={1.75} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

function SortMenu() {
  return (
    <BoardMenu
      label={`Sort cards, ${SORTS[sortBy.value]}`}
      triggerClass={toolCls}
      trigger={
        <>
          <ArrowDownUp size={14} strokeWidth={1.75} aria-hidden="true" />
          {SORTS[sortBy.value]}
        </>
      }
    >
      <Menu.RadioGroup
        value={sortBy.value}
        onValueChange={(value: string) => {
          if (!isSort(value)) return;
          sortBy.value = value;
          track('board_sort_changed', { sort: value });
        }}
      >
        {Object.entries(SORTS).map(([value, text]) => (
          <Menu.RadioItem key={value} value={value} closeOnClick className={itemCls}>
            {text}
            <CheckMark />
          </Menu.RadioItem>
        ))}
      </Menu.RadioGroup>
    </BoardMenu>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
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
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!showBoard.value) return;
    // A drag whose source card unmounted mid-flight never fires `dragend` to clear this.
    draggingId.value = null;
    closeRef.current?.focus();
    return tinykeys(window, {
      Escape: (e) => {
        // An open menu takes its own Escape; the board closes on the next one.
        if (e.target instanceof Element && e.target.closest('[role="menu"]')) return;
        showBoard.value = false;
      },
    });
  }, [showBoard.value]);

  if (!showBoard.value) return null;

  const readonly = isReadonly.value;
  const all = [...rootComments.value, ...areas.value, ...selections.value, ...inspects.value].map(cardFor);
  const roster = rosterFor(all);
  const shown = all.filter(matchesFilter).sort(compareCards(sortBy.value));
  const host = hostOf(pageUrl.value);

  const open = (card: BoardCard) => {
    focusedAnnotationId.value = card.op.id;
    track('board_card_opened', { tool: card.op.tool });
    scrollToAnnotation(card.anchor.x, card.anchor.y);
    showBoard.value = false;
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
      <header class={cn(geist.bar, 'flex h-14 shrink-0 items-center gap-1 px-5')}>
        {/* Baselines, not centres: the host is a subtitle to the title, and the
            controls to their right are boxes that centre on the bar instead. */}
        <div class="mr-auto flex min-w-0 items-baseline gap-2.5">
          <h2 class="m-0 text-body font-semibold tracking-ui text-(--ds-gray-1000)">Board</h2>
          {host && <span class="min-w-0 truncate text-meta text-(--ds-gray-900)">{host}</span>}
          {shown.length !== all.length && (
            <span class="shrink-0 text-meta tabular-nums text-(--ds-gray-900)">
              {shown.length} of {all.length}
            </span>
          )}
        </div>
        {all.length > 0 && (
          <>
            {/* Drag is the card's own affordance; the keys are the part nobody would guess. */}
            {!readonly && (
              <span class="mr-2 hidden items-center gap-1.5 text-meta text-(--ds-gray-900) xl:inline-flex">
                <kbd class={geist.kbd}>←</kbd>
                <kbd class={geist.kbd}>→</kbd>
                move a focused card
              </span>
            )}
            <FilterMenu cards={all} />
            <SortMenu />
            <span class={geist.sep} aria-hidden="true" />
          </>
        )}
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

      {all.length === 0 ? (
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
              cards={shown.filter((c) => c.status === status)}
              roster={roster}
              readonly={readonly}
              onOpen={open}
            />
          ))}
        </div>
      )}
    </div>
  );
}
