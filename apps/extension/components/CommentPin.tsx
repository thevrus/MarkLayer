import { cn } from '@marklayer/types';
import { Check, HelpCircle, Loader2 } from 'lucide-preact';
import { applyAnchorDelta } from '../lib/anchor';
import { geist } from '../lib/geist';
import { glass } from '../lib/glass';
import { type ParsedInspectorComment, parseInspectorComment } from '../lib/selector';
import {
  copyText,
  deleteOp,
  getCommentStatus,
  getReplies,
  hostMutationTick,
  openContextMenu,
  STATUS_STYLES,
  scrollTick,
  setOpStatus,
} from '../lib/state';
import type { CommentOp } from '../lib/types';
import { TriageSection, useTriageHold } from './CommentTriage';
import { PriorityPin } from './PriorityPicker';
import { ReplyComposer, ThreadHeader, ThreadReplies } from './ThreadCard';

/**
 * Strip the leading `tag:` segment from an inspector field value when it's
 * wrapped in backticks. We display the tag itself separately as a chip; the
 * remainder (id, classes, etc.) gets the code style.
 */
function unwrapInline(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('`') && trimmed.endsWith('`')) return trimmed.slice(1, -1);
  return trimmed;
}

function InspectorCommentBody({ parsed, resolved }: { parsed: ParsedInspectorComment; resolved: boolean }) {
  return (
    <div class="flex flex-col gap-2.5">
      {parsed.task && (
        <p
          class="text-(--ds-gray-1000) text-ui leading-body wrap-break-word whitespace-pre-wrap m-0 font-medium"
          style={{ textDecoration: resolved ? 'line-through' : 'none', opacity: resolved ? 0.55 : 1 }}
        >
          {parsed.task}
        </p>
      )}

      {parsed.fields.length > 0 && (
        <dl class="grid grid-cols-[64px_1fr] gap-x-3 gap-y-1 items-baseline text-meta m-0">
          {parsed.fields.map(([label, value]) => {
            const isCode = label === 'Selector';
            return (
              <div key={label} class="contents">
                <dt class="text-meta text-(--ds-gray-900) font-medium tabular-nums">{label}</dt>
                <dd
                  class={cn(
                    'text-(--ds-gray-1000) m-0 wrap-break-word',
                    isCode &&
                      'font-mono text-meta bg-(--ds-gray-alpha-100) border border-(--ds-gray-alpha-400) rounded-md px-1.5 py-0.5',
                  )}
                >
                  {isCode ? unwrapInline(value) : value}
                </dd>
              </div>
            );
          })}
        </dl>
      )}

      {parsed.markup && (
        <pre
          class="m-0 text-meta font-mono leading-snug text-(--ds-gray-1000)
                 bg-(--ml-syntax-bg) border border-(--ds-gray-alpha-400) rounded-lg
                 px-2 py-1.5 overflow-x-auto max-h-32 whitespace-pre-wrap wrap-break-word"
        >
          {parsed.markup}
        </pre>
      )}
    </div>
  );
}

export function CommentPin({ op }: { op: CommentOp }) {
  scrollTick.value; // subscribe so positions track host-page scroll without parent re-renders
  hostMutationTick.value; // re-resolve anchor on SPA route / DOM reflow
  const { x: docX, y: docY, strategy } = applyAnchorDelta(op.target, { docX: op.x, docY: op.y });
  const left = docX - scrollX;
  const top = docY - scrollY;
  const cardWidth = 320;
  const flipH = left + cardWidth + 20 > window.innerWidth;
  const flipV = top > window.innerHeight / 2;
  const status = getCommentStatus(op);
  const styles = STATUS_STYLES[status];
  const inspector = parseInspectorComment(op.text);
  const resolved = status === 'resolved' || status === 'dismissed';
  const replies = getReplies(op.id);
  const triage = useTriageHold();

  const onContextMenu = (e: MouseEvent) =>
    openContextMenu(e, [
      {
        label: resolved ? 'Reopen' : 'Resolve',
        icon: 'check',
        onClick: () => setOpStatus(op.id, resolved ? 'open' : 'resolved'),
      },
      ...(inspector?.task
        ? [{ label: 'Copy task', icon: 'copy', onClick: () => copyText(inspector.task ?? '', 'Task copied') }]
        : []),
      { label: 'Copy text', icon: 'copy', onClick: () => copyText(op.text, 'Comment copied') },
      { label: 'Delete', icon: 'clear', danger: true, onClick: () => deleteOp(op.id) },
    ]);

  return (
    <div
      class={cn('absolute pointer-events-auto cursor-pointer hover:z-50', triage.rootCls, 'group/pin', glass.font)}
      style={{ left, top }}
      data-doc-x={op.x}
      data-doc-y={op.y}
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
          {status !== 'open' && (
            <div
              role="img"
              aria-label={styles.label}
              class="absolute -bottom-1 -right-1 w-4 h-4 rounded-full text-white grid place-items-center [box-shadow:0_0_0_1.5px_var(--ds-background-100)]"
              style={{ background: styles.bg }}
            >
              {status === 'resolved' && <Check size={9} strokeWidth={2.5} aria-hidden="true" />}
              {status === 'in_progress' && (
                <Loader2 size={9} strokeWidth={2.75} class="animate-spin" aria-hidden="true" />
              )}
              {status === 'dismissed' && <HelpCircle size={9} strokeWidth={2.5} aria-hidden="true" />}
            </div>
          )}
          {op.priority && <PriorityPin priority={op.priority} />}
        </div>

        {/* Hover card. The pin-to-card gap is padding on this wrapper, not a
            positional offset — as dead space it drops :hover mid-crossing and the
            card vanishes before the pointer arrives. */}
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
              geist.surfaceSmall,
              inspector ? 'w-[320px]' : 'w-[300px]',
              'max-h-[70vh] overflow-y-auto overscroll-contain',
              'opacity-0',
              flipH ? 'translate-x-[6px]' : 'translate-x-[-6px]',
              'transition-[opacity,translate] duration-150 ease-out',
              'group-hover/pin:opacity-100 group-hover/pin:translate-x-0',
              triage.cardCls,
            )}
            onClick={(e) => e.stopPropagation()}
          >
            <ThreadHeader
              label={String(op.num)}
              color={op.color}
              author={op.author}
              ts={op.ts}
              priority={op.priority}
            />

            <div class={cn(geist.divider, 'mx-3')} />

            {/* Body */}
            <div class="px-3.5 py-3">
              {inspector ? (
                <InspectorCommentBody parsed={inspector} resolved={resolved} />
              ) : (
                <p
                  class="text-(--ds-gray-1000) text-ui leading-body wrap-break-word whitespace-pre-wrap m-0"
                  style={{ textDecoration: resolved ? 'line-through' : 'none', opacity: resolved ? 0.55 : 1 }}
                >
                  {op.text}
                </p>
              )}
            </div>

            <ThreadReplies replies={replies} />

            <div class={cn(geist.divider, 'mx-3')} />

            <TriageSection
              opId={op.id}
              status={status}
              assignee={op.assignee ?? null}
              onOpenChange={triage.onOpenChange}
            />

            <div class={cn(geist.divider, 'mx-3')} />

            <ReplyComposer parent={op} />
          </div>
        </div>
      </div>
    </div>
  );
}
