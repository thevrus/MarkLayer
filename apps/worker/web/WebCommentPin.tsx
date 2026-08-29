import { TriageSection, useTriageHold } from '@ext/components/CommentTriage';
import { PriorityBadge, PriorityPin } from '@ext/components/PriorityPicker';
import { applyAnchorDelta } from '@ext/lib/anchor';
import { submitBtn } from '@ext/lib/buttons';
import { geist } from '@ext/lib/geist';
import { glass } from '@ext/lib/glass';
import {
  copyText,
  deleteOp,
  getCommentStatus,
  getReplies,
  openContextMenu,
  pushReply,
  STATUS_STYLES,
  setOpStatus,
} from '@ext/lib/state';
import { timeAgo } from '@ext/lib/time';
import type { CommentOp } from '@ext/lib/types';
import { cn } from '@marklayer/types';
import { Check, HelpCircle, Loader2 } from 'lucide-preact';
import { useRef, useState } from 'preact/hooks';
import { cssScale, iframeMutationTick } from './signals';

interface Props {
  op: CommentOp;
  scale: number;
  scrollY: number;
  /** Iframe contentDocument so element selectors resolve against the proxied page. */
  frameDoc?: Document | null;
}

export function WebCommentPin({ op, scale: s, scrollY, frameDoc }: Props) {
  // Subscribe to iframe DOM mutations so we re-resolve the anchor when the
  // proxied page lazy-loads or reflows. No-op for ops without a target.
  iframeMutationTick.value;
  const {
    x: docX,
    y: docY,
    strategy,
  } = frameDoc
    ? applyAnchorDelta(op.target, { docX: op.x, docY: op.y }, { doc: frameDoc, win: frameDoc.defaultView ?? undefined })
    : { x: op.x, y: op.y, strategy: null };
  const left = docX * s;
  const top = docY * s - scrollY;
  const cs = cssScale.value;
  const flipH = (left + 320) * cs > window.innerWidth;
  const flipV = (top + 400) * cs > window.innerHeight;
  const status = getCommentStatus(op);
  const resolved = status === 'resolved';
  const inProgress = status === 'in_progress';
  const dismissed = status === 'dismissed';
  const styles = STATUS_STYLES[status];
  const showBadge = status !== 'open';
  const replies = getReplies(op.id);
  const [showReply, setShowReply] = useState(false);
  const triage = useTriageHold();
  const replyRef = useRef<HTMLTextAreaElement>(null);

  if (op.parentId)
    // Don't render reply comments as pins — they're shown inside the parent's card
    return null;

  const submitReply = () => {
    const txt = replyRef.current?.value.trim();
    if (!txt) return;
    pushReply(op, txt);
    setShowReply(false);
  };

  const onContextMenu = (e: MouseEvent) => {
    openContextMenu(e, [
      {
        label: resolved ? 'Reopen' : 'Resolve',
        icon: 'check',
        onClick: () => setOpStatus(op.id, resolved ? 'open' : 'resolved'),
      },
      { label: 'Copy text', icon: 'copy', onClick: () => copyText(op.text, 'Comment copied') },
      { label: 'Delete', icon: 'clear', danger: true, onClick: () => deleteOp(op.id) },
    ]);
  };

  return (
    <div
      class={cn('absolute pointer-events-auto cursor-pointer hover:z-50 group/pin', triage.rootCls, glass.font)}
      style={{ left, top }}
      data-anchor-drift={strategy === 'text' ? 'text' : undefined}
      onContextMenu={onContextMenu}
    >
      <div class="relative -translate-x-1/2 -translate-y-1/2">
        {/* Pin dot */}
        <div
          // A marker on someone else's page: flat fill, a surface-coloured ring
          // to separate it from whatever is behind, and one tight shadow. The
          // ring thickens on hover instead of the pin growing.
          class="w-7 h-7 rounded-full text-white text-meta font-semibold
                 grid place-items-center
                 shadow-[0_0_0_2px_var(--ds-background-100),0_1px_2px_oklch(0_0_0/0.25)]
                 transition-[box-shadow] duration-150 ease-out
                 group-hover/pin:shadow-[0_0_0_3px_var(--ds-background-100),0_1px_2px_oklch(0_0_0/0.3)]"
          style={{ background: op.color, opacity: styles.pinOpacity }}
        >
          {op.num}
          {showBadge && (
            <div
              role="img"
              aria-label={styles.label}
              class="absolute -bottom-1 -right-1 w-4 h-4 rounded-full text-white grid place-items-center [box-shadow:0_0_0_1.5px_var(--ds-background-100)]"
              style={{ background: styles.bg }}
            >
              {resolved && <Check size={9} strokeWidth={2.5} aria-hidden="true" />}
              {inProgress && <Loader2 size={9} strokeWidth={2.75} class="animate-spin" aria-hidden="true" />}
              {dismissed && <HelpCircle size={9} strokeWidth={2.5} aria-hidden="true" />}
            </div>
          )}
          {replies.length > 0 && !resolved && !dismissed && (
            <div class="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-(--ds-background-100) text-micro font-medium text-(--ds-gray-1000) grid place-items-center [box-shadow:0_0_0_1.5px_var(--ds-background-100)]">
              {replies.length}
            </div>
          )}
          {op.priority && <PriorityPin priority={op.priority} />}
        </div>

        {/* Hover card. The pin-to-card gap is padding on this wrapper, not a
            positional offset — as dead space it drops :hover mid-crossing and the
            card vanishes before the pointer can reach the reply controls. */}
        <div
          class={cn(
            'absolute',
            flipV ? 'bottom-0' : 'top-0',
            flipH ? 'right-full pr-2.5' : 'left-full pl-2.5',
            'pointer-events-none group-hover/pin:pointer-events-auto',
            triage.wrapCls,
          )}
        >
          <div
            class={cn(
              'bg-[var(--ds-background-100)] border border-[var(--ds-gray-alpha-400)]',
              'shadow-[0_0_0_0.5px_oklch(0_0_0/0.5),0_6px_24px_oklch(0_0_0/0.35),0_16px_48px_oklch(0_0_0/0.25)]',
              'rounded-xl',
              'w-[300px]',
              'opacity-0',
              flipH ? 'translate-x-[6px]' : 'translate-x-[-6px]',
              'transition-[opacity,translate] duration-150 ease-out',
              'group-hover/pin:opacity-100 group-hover/pin:translate-x-0',
              triage.cardCls,
              'max-h-[400px] overflow-y-auto',
            )}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Root comment */}
            <div class="flex items-center gap-2.5 pt-3 px-3.5 pb-2">
              <div
                class="w-5 h-5 rounded-full text-white text-meta font-medium grid place-items-center shrink-0
                     shadow-[inset_0_1px_0_oklch(1_0_0/0.15)]"
                style={{ background: op.color }}
              >
                {op.num}
              </div>
              <span class="text-meta text-(--ds-gray-1000) font-semibold tracking-wide flex-1">
                {op.author || 'Anonymous'}
              </span>
              {op.priority && <PriorityBadge priority={op.priority} />}
              <span class="text-meta text-(--ds-gray-900) font-medium tabular-nums">{timeAgo(op.ts)}</span>
            </div>

            {(op.assignedAgent || dismissed) && (
              <div class="flex items-center gap-1.5 px-3.5 pb-1.5">
                {op.assignedAgent && (
                  <span
                    class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-meta font-medium"
                    style={{ background: 'oklch(0.7 0.16 60 / 0.15)', color: styles.color }}
                  >
                    {inProgress && <Loader2 size={9} strokeWidth={2.75} class="animate-spin" aria-hidden="true" />}
                    {op.assignedAgent}
                  </span>
                )}
                {dismissed && op.dismissReason && (
                  <span class="text-meta text-(--ds-gray-900)">{op.dismissReason}</span>
                )}
              </div>
            )}

            <div class="pt-1 px-3.5 pb-2.5">
              <p class="m-0 text-(--ds-gray-1000) text-ui leading-body break-words whitespace-pre-wrap">{op.text}</p>
            </div>

            {/* Replies */}
            {replies.length > 0 && (
              <div>
                <div class={cn(geist.divider, 'mx-3')} />
                {replies.map((reply) => (
                  <div key={reply.id} class="px-3.5 py-2 border-l-2 border-(--ds-gray-alpha-400) ml-3">
                    <div class="flex items-center gap-2 mb-1">
                      <div
                        class="w-4 h-4 rounded-full text-white text-micro font-medium grid place-items-center shrink-0"
                        style={{ background: reply.color }}
                      >
                        {(reply.author || '?').charAt(0).toUpperCase()}
                      </div>
                      <span class="text-meta text-(--ds-gray-1000) font-semibold">{reply.author || 'Anonymous'}</span>
                      <span class="text-meta text-(--ds-gray-900) tabular-nums">{timeAgo(reply.ts)}</span>
                    </div>
                    <p class="m-0 text-(--ds-gray-1000) text-ui leading-body break-words whitespace-pre-wrap">
                      {reply.text}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {/* Divider */}
            <div class={cn(geist.divider, 'mx-3')} />

            <TriageSection
              opId={op.id}
              status={status}
              assignee={op.assignee ?? null}
              onOpenChange={triage.onOpenChange}
            />

            <div class={cn(geist.divider, 'mx-3')} />

            {/* Reply input */}
            {showReply ? (
              <div class="pt-2 px-3 pb-2.5">
                <textarea
                  name="reply"
                  ref={replyRef}
                  placeholder="Reply…"
                  rows={1}
                  class={cn(
                    'w-full bg-(--ds-gray-alpha-100) border border-(--ds-gray-alpha-400) rounded-lg px-3 py-2',
                    'text-(--ds-gray-1000) text-ui leading-relaxed',
                    'resize-none outline-none min-h-8 max-h-[80px]',
                    'caret-ml-accent',
                    'focus:border-ml-accent/50 focus:bg-(--ds-gray-alpha-100)',
                    'placeholder:text-(--ds-gray-900)',
                    glass.font,
                  )}
                  style={{ fieldSizing: 'content', boxSizing: 'border-box' }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      submitReply();
                    } else if (e.key === 'Escape') {
                      setShowReply(false);
                    }
                  }}
                />
                <div class="flex items-center justify-end gap-2 mt-1.5">
                  <button
                    type="button"
                    onClick={() => setShowReply(false)}
                    class={cn(geist.ctlSm, geist.ctlIdle, 'w-auto px-2.5 text-ui font-medium')}
                  >
                    Cancel
                  </button>
                  <button type="button" onClick={submitReply} class={submitBtn}>
                    Reply
                  </button>
                </div>
              </div>
            ) : (
              <div class="flex items-center gap-2 pt-2 px-3.5 pb-2.5">
                <button
                  type="button"
                  onClick={() => {
                    setShowReply(true);
                    setTimeout(() => replyRef.current?.focus(), 50);
                  }}
                  class="text-meta font-medium px-3 py-1.5 rounded-lg cursor-pointer
                       border border-(--ds-gray-alpha-400) bg-(--ds-gray-alpha-100)
                       text-(--ds-gray-1000) hover:text-(--ds-gray-1000) hover:bg-(--ds-gray-alpha-100)
                       transition-[color,background-color,border-color] duration-150"
                >
                  Reply
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
