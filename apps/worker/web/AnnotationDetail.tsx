import { Avatar } from '@ext/components/Avatar';
import { TriageSection } from '@ext/components/CommentTriage';
import { PRIORITY_LEVELS, PRIORITY_META } from '@ext/components/PriorityPicker';
import { SuggestionDiff } from '@ext/components/SelectionEdit';
import { submitBtn, textareaCls } from '@ext/lib/buttons';
import { geist } from '@ext/lib/geist';
import { glass } from '@ext/lib/glass';
import { color, copyText, getCommentStatus, getReplies, localUser, pushReply, setOpPriority } from '@ext/lib/state';
import { timeAgo } from '@ext/lib/time';
import type { AnnotationOp, CommentPriority, DrawOp } from '@ext/lib/types';
import { cn, isAnnotationOp } from '@marklayer/types';
import { ClipboardCopy, Crosshair, Minus } from 'lucide-preact';
import type { ComponentChildren } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { type AnnotationItem, itemAnchor } from './annotationItems';
import { DEVICE_LABELS } from './shared';

/** Local time, spelled out — the detail view has the room the list row does not. */
const stamp = (ts: number) =>
  new Date(ts).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

/** Just the path, so a long share URL doesn't push the rest of the line off the panel. */
function pagePath(url: string): string {
  try {
    const { pathname, search, hash } = new URL(url);
    return `${pathname}${search}${hash}` || '/';
  } catch {
    return url;
  }
}

function Section({ label, children }: { label: string; children: ComponentChildren }) {
  return (
    <div class="px-4 py-3 border-b border-(--ds-gray-alpha-400)">
      <span class={cn(geist.sectionLabel, 'block mb-1.5')}>{label}</span>
      {children}
    </div>
  );
}

/**
 * Priority as a row of levels rather than the composer's click-through cycle:
 * on an annotation that already exists you are usually correcting a level, and a
 * cycle makes you walk past three wrong ones to get there. Muted at rest so the
 * four signal colours don't all shout at once — only the chosen level is tinted.
 */
function PriorityRow({ op }: { op: AnnotationOp }) {
  const current = op.priority ?? null;
  const name = `priority-${op.id}`;
  // Real radios rather than buttons wearing role="radio": the group then gets
  // arrow-key traversal and single-selection semantics from the platform.
  const option = ({
    value,
    label,
    glyph,
    tint,
  }: {
    value: CommentPriority | null;
    label: string;
    glyph: ComponentChildren;
    /** Absent for "no priority", which has no level colour to carry. */
    tint?: string;
  }) => {
    const on = current === value;
    return (
      <label
        key={label}
        title={label}
        data-pressed={on && !tint ? '' : undefined}
        class={cn(
          geist.segment,
          `has-[:focus-visible]:outline-solid has-[:focus-visible]:outline-2
           has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-(--ds-focus-color)`,
        )}
        style={on && tint ? { color: tint, background: `color-mix(in oklch, ${tint} 16%, transparent)` } : undefined}
      >
        <input
          type="radio"
          name={name}
          class="sr-only"
          checked={on}
          onChange={() => setOpPriority({ opId: op.id, priority: value })}
        />
        {glyph}
        <span class="sr-only">{label}</span>
      </label>
    );
  };

  return (
    <div class="px-4 py-3 border-b border-(--ds-gray-alpha-400) flex items-center justify-between gap-3">
      <span class={geist.sectionLabel}>Priority</span>
      <div class={geist.track} role="radiogroup" aria-label="Priority">
        {option({
          value: null,
          label: 'No priority',
          glyph: <Minus size={14} strokeWidth={2.25} aria-hidden="true" />,
        })}
        {PRIORITY_LEVELS.map((level) => {
          const meta = PRIORITY_META[level];
          return option({
            value: level,
            label: `${meta.label} priority`,
            glyph: <meta.Icon size={14} strokeWidth={2.25} aria-hidden="true" />,
            tint: meta.color,
          });
        })}
      </div>
    </div>
  );
}

/**
 * Where and on what the annotation was made — the question a reviewer asks first
 * about a bug report, and the one the list row has no width to answer.
 */
function ContextSection({ op }: { op: DrawOp }) {
  const meta = op.tool === 'comment' ? op.meta : undefined;
  const viewport = meta?.viewport ?? op.captureViewport;
  const env: string[] = [];
  if (meta?.browser) env.push(meta.browser);
  if (meta?.os) env.push(meta.os);
  if (op.device) env.push(DEVICE_LABELS[op.device]);
  if (viewport) env.push(`${Math.round(viewport.width)} × ${Math.round(viewport.height)}`);
  const selector = 'target' in op ? op.target?.selector : undefined;
  if (!meta?.url && !env.length && !selector) return null;

  return (
    <Section label="Context">
      {meta?.url && (
        <p class="text-ui text-(--ds-gray-1000) m-0 truncate" title={meta.url}>
          {pagePath(meta.url)}
        </p>
      )}
      {env.length > 0 && <p class="text-meta text-(--ds-gray-900) m-0 mt-0.5 tabular-nums">{env.join(' · ')}</p>}
      {selector && (
        <p class="text-meta text-(--ds-gray-900) m-0 mt-1 font-mono truncate" title={selector}>
          {selector}
        </p>
      )}
    </Section>
  );
}

function Replies({ op }: { op: { id: string; x: number; y: number } }) {
  const [replying, setReplying] = useState(false);
  const replyRef = useRef<HTMLTextAreaElement>(null);
  const replies = getReplies(op.id);

  const submit = () => {
    const text = replyRef.current?.value.trim();
    if (!text) return;
    pushReply(op, text);
    if (replyRef.current) replyRef.current.value = '';
    setReplying(false);
  };

  return (
    <div class="px-4 py-3">
      {replies.length > 0 && (
        <span class={cn(geist.sectionLabel, 'block mb-1.5')}>
          {replies.length} {replies.length === 1 ? 'reply' : 'replies'}
        </span>
      )}
      {replies.map((reply) => (
        <div key={reply.id} class="flex gap-2 py-2">
          <Avatar name={reply.author || '?'} color={reply.color} size="sm" style={{ marginTop: 2 }} />
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <span class="text-meta text-(--ds-gray-1000) font-semibold truncate">{reply.author || 'Anonymous'}</span>
              <span class="text-meta text-(--ds-gray-900) tabular-nums">{timeAgo(reply.ts)}</span>
            </div>
            <p
              class="text-ui text-(--ds-gray-1000) leading-relaxed m-0 mt-0.5"
              style={{ wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}
            >
              {reply.text}
            </p>
          </div>
        </div>
      ))}

      {replying ? (
        <div class="flex gap-2 mt-1">
          <Avatar name={localUser.name} color={color.value} size="sm" style={{ marginTop: 6 }} />
          <div class="flex-1">
            <textarea
              name="reply"
              ref={replyRef}
              placeholder="Write a reply…"
              rows={1}
              class={cn(textareaCls, glass.font, 'w-full min-h-8 max-h-[140px]')}
              style={{ fieldSizing: 'content', boxSizing: 'border-box' }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                } else if (e.key === 'Escape') {
                  // Closes the composer only — the panel's own Escape still steps
                  // back to the list, so this stops here rather than bubbling.
                  e.preventDefault();
                  e.stopPropagation();
                  setReplying(false);
                }
              }}
            />
            <div class="flex items-center justify-end gap-2 mt-1.5">
              <button
                type="button"
                onClick={() => setReplying(false)}
                class={cn(geist.ctlSm, geist.ctlIdle, 'w-auto px-2.5 text-ui font-medium')}
              >
                Cancel
              </button>
              <button type="button" onClick={submit} class={submitBtn}>
                Reply
              </button>
            </div>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            setReplying(true);
            setTimeout(() => replyRef.current?.focus(), 50);
          }}
          class={cn(
            geist.field,
            'w-full flex items-center px-3 mt-1 text-left text-ui text-(--ds-gray-700) cursor-text',
            'hover:border-(--ds-gray-700)',
          )}
        >
          Reply…
        </button>
      )}
    </div>
  );
}

/** The body of the annotation, in whatever shape its tool actually produced. */
function DetailBody({ item }: { item: AnnotationItem }) {
  if (item.kind === 'comment') {
    return (
      <p
        class="text-body text-(--ds-gray-1000) leading-body m-0"
        style={{ wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}
      >
        {item.op.text}
      </p>
    );
  }

  if (item.kind === 'text') {
    return (
      <p class="text-body leading-body m-0" style={{ color: item.op.color, wordBreak: 'break-word' }}>
        {item.op.text}
      </p>
    );
  }

  if (item.kind === 'area') {
    const { op } = item;
    return (
      <>
        {op.comment ? (
          <p
            class="text-body text-(--ds-gray-1000) leading-body m-0"
            style={{ wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}
          >
            {op.comment}
          </p>
        ) : (
          <p class="text-ui text-(--ds-gray-900) m-0">No comment on this area.</p>
        )}
        <p class="text-meta text-(--ds-gray-900) m-0 mt-1.5 tabular-nums">
          {Math.round(Math.abs(op.endX - op.startX))} × {Math.round(Math.abs(op.endY - op.startY))} px
        </p>
      </>
    );
  }

  const { op } = item;
  return (
    <>
      {op.suggestion ? (
        <>
          <SuggestionDiff text={op.text} suggestion={op.suggestion} />
          <button
            type="button"
            onClick={() => copyText(op.suggestion ?? '', 'Replacement copied')}
            class={cn(
              geist.field,
              'w-full flex items-center justify-center gap-1.5 mt-2.5 px-3',
              'text-ui font-medium text-(--ds-gray-1000) cursor-pointer',
              'hover:bg-(--ds-gray-alpha-100) hover:border-(--ds-gray-700)',
            )}
          >
            <ClipboardCopy size={14} strokeWidth={1.75} aria-hidden="true" />
            Copy replacement
          </button>
        </>
      ) : (
        <p class="text-body text-(--ds-gray-1000) leading-body m-0" style={{ wordBreak: 'break-word' }}>
          "{op.text}"
        </p>
      )}
      {op.comment && (
        <p
          class="text-ui text-(--ds-gray-900) leading-relaxed m-0 mt-2"
          style={{ wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}
        >
          {op.comment}
        </p>
      )}
    </>
  );
}

/**
 * One annotation on its own, stepped through with the header's counter. The list
 * answers "what is there"; this answers "what do I do about this one", which is
 * why triage, context and replies live here and not in a 340px-wide row.
 */
export function AnnotationDetail({
  item,
  onScrollTo,
}: {
  item: AnnotationItem;
  onScrollTo: (x: number, y: number) => void;
}) {
  const { op } = item;
  const annotation = isAnnotationOp(op) ? op : null;
  const author = 'author' in op ? op.author : undefined;
  const ts = 'ts' in op ? op.ts : undefined;
  const anchor = itemAnchor(item);

  return (
    <div class="flex-1 overflow-y-auto">
      <div class="px-4 pt-3.5 pb-3 border-b border-(--ds-gray-alpha-400)">
        <div class="flex items-center gap-2 mb-2">
          {item.kind === 'comment' ? (
            <div
              class="w-6 h-6 rounded-full text-white text-meta font-medium tabular-nums grid place-items-center shrink-0
                     shadow-[inset_0_1px_0_oklch(1_0_0/0.15)]"
              style={{ background: op.color }}
            >
              {item.op.num}
            </div>
          ) : (
            <Avatar name={author || '?'} color={op.color} />
          )}
          <div class="min-w-0 flex-1">
            <span class="text-ui text-(--ds-gray-1000) font-semibold block truncate">{author || 'Anonymous'}</span>
            {ts !== undefined && <span class="text-meta text-(--ds-gray-900) block">{stamp(ts)}</span>}
          </div>
          <button
            type="button"
            onClick={() => onScrollTo(anchor.x, anchor.y)}
            title="Scroll the page to this annotation"
            class={cn(geist.ctlSm, geist.ctlIdle)}
          >
            <Crosshair size={15} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>
        <DetailBody item={item} />
      </div>

      {annotation && (
        <>
          <TriageSection
            opId={annotation.id}
            status={getCommentStatus(annotation)}
            assignee={annotation.assignee ?? null}
            class="px-4 py-3 border-b border-(--ds-gray-alpha-400)"
          />
          <PriorityRow op={annotation} />
        </>
      )}

      <ContextSection op={op} />

      {/* Every annotation that owns triage owns a thread, so a selection or an
          area takes replies on the same terms a comment does — anchored to the
          point the row already scrolls to. */}
      {annotation && <Replies op={{ id: annotation.id, x: anchor.x, y: anchor.y }} />}
    </div>
  );
}
