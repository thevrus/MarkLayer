import { type CommentPriority, cn } from '@marklayer/types';
import { useCallback, useRef, useState } from 'preact/hooks';
import { submitBtn, textareaCls, trim } from '../lib/buttons';
import { geist } from '../lib/geist';
import { glass } from '../lib/glass';
import { pushReply } from '../lib/state';
import { timeAgo } from '../lib/time';
import type { CommentOp } from '../lib/types';
import { PriorityBadge } from './PriorityPicker';

/**
 * The parts every annotation thread card is assembled from — comment pins and
 * selection highlights, extension and viewer alike. A selection carries the same
 * thread a comment does, so it reads the same wherever it opens instead of each
 * surface growing its own header and its own reply box.
 */

const DISC_SIZES = { sm: 'w-4 h-4 text-micro', md: 'w-5 h-5 text-meta' } as const;

/** A thread's identity disc: a comment's number, or a person's initial. */
export function ThreadDisc({
  label,
  color,
  size = 'md',
}: {
  label: string;
  color: string;
  size?: keyof typeof DISC_SIZES;
}) {
  return (
    <div
      class={cn(
        'rounded-full text-white font-medium grid place-items-center shrink-0',
        'shadow-[inset_0_1px_0_oklch(1_0_0/0.15)]',
        DISC_SIZES[size],
      )}
      style={{ background: color }}
    >
      {label}
    </div>
  );
}

/**
 * Card shell for a hover card floating over the proxied page in the viewer. The
 * extension's cards sit inside a shadow root over an unknown page and use
 * `geist.surfaceSmall` instead; here the page underneath is ours to sit on.
 */
export const threadCard = trim(`
  bg-(--ds-background-100) border border-(--ds-gray-alpha-400) rounded-xl
  [box-shadow:0_0_0_0.5px_oklch(0_0_0/0.5),0_6px_24px_oklch(0_0_0/0.35),0_16px_48px_oklch(0_0_0/0.25)]
`);

/** Author, time and priority row that opens a thread card. */
export function ThreadHeader({
  label,
  color,
  author,
  ts,
  priority,
}: {
  /** What sits in the disc — a comment's number, or an author's initial. */
  label: string;
  color: string;
  author: string | undefined;
  ts: number;
  priority: CommentPriority | null | undefined;
}) {
  return (
    <div class="flex items-center gap-2.5 px-3.5 pt-3 pb-2">
      <ThreadDisc label={label} color={color} />
      <span class="text-meta text-(--ds-gray-1000) font-semibold flex-1 truncate">{author || 'Anonymous'}</span>
      {priority && <PriorityBadge priority={priority} />}
      <span class="text-meta text-(--ds-gray-900) font-medium tabular-nums">{timeAgo(ts)}</span>
    </div>
  );
}

/** The thread's replies, indented under the root annotation. */
export function ThreadReplies({ replies }: { replies: CommentOp[] }) {
  if (replies.length === 0) return null;
  return (
    <>
      <div class={cn(geist.divider, 'mx-3')} />
      {replies.map((reply) => (
        <div key={reply.id} class="px-3.5 py-2 border-l-2 border-(--ds-gray-alpha-400) ml-3">
          <div class="flex items-center gap-2 mb-1">
            <ThreadDisc size="sm" color={reply.color} label={(reply.author || '?').charAt(0).toUpperCase()} />
            <span class="text-meta text-(--ds-gray-1000) font-semibold truncate">{reply.author || 'Anonymous'}</span>
            <span class="text-meta text-(--ds-gray-900) tabular-nums">{timeAgo(reply.ts)}</span>
          </div>
          <p class="m-0 text-(--ds-gray-1000) text-ui leading-body wrap-break-word whitespace-pre-wrap">{reply.text}</p>
        </div>
      ))}
    </>
  );
}

const replyBtn = trim(`
  text-meta font-medium px-3 py-1.5 rounded-lg cursor-pointer
  border border-(--ds-gray-alpha-400) bg-(--ds-gray-alpha-100) text-(--ds-gray-1000)
  transition-[background-color,border-color] duration-150 ease-out
  hover:border-(--ds-gray-700)
`);

/**
 * Reply box for any thread. `parent` is what the reply hangs off: its id plus the
 * document point the reply inherits, so a selection's replies land on the
 * selection's own text rather than at the top of the page.
 */
export function ReplyComposer({ parent }: { parent: { id: string; x: number; y: number } }) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLTextAreaElement | null>(null);

  // Focus from the ref callback rather than an effect: the textarea only exists
  // once `open` flips, so there is nothing to focus at the click that opens it.
  const mount = useCallback((el: HTMLTextAreaElement | null) => {
    boxRef.current = el;
    el?.focus();
  }, []);

  const submit = () => {
    const text = boxRef.current?.value.trim();
    if (!text) return;
    pushReply(parent, text);
    setOpen(false);
  };

  if (!open)
    return (
      <div class="flex items-center gap-2 px-3.5 py-2.5">
        <button type="button" onClick={() => setOpen(true)} class={replyBtn}>
          Reply
        </button>
      </div>
    );

  return (
    <div class="px-3 pt-2 pb-2.5">
      <textarea
        name="reply"
        ref={mount}
        placeholder="Reply…"
        rows={1}
        class={cn(textareaCls, 'w-full min-h-8 max-h-20', glass.font)}
        style={{ fieldSizing: 'content', boxSizing: 'border-box' }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            setOpen(false);
          }
        }}
      />
      <div class="flex items-center justify-end gap-2 mt-1.5">
        <button
          type="button"
          onClick={() => setOpen(false)}
          class={cn(geist.bareBtn, geist.bareBtnQuiet, 'font-medium px-1')}
        >
          Cancel
        </button>
        <button type="button" onClick={submit} class={submitBtn}>
          Reply
        </button>
      </div>
    </div>
  );
}
