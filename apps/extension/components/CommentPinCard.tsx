import { agentLabel, isAgentAuthored } from '@marklayer/types/agents';
import { isClosed } from '@marklayer/types/ops';
import { cn } from '@marklayer/ui/cn';
import { Check, CheckCheck, HelpCircle, Loader2 } from 'lucide-preact';
import type { CSSProperties } from 'preact';
import { AgentMark } from '../lib/agents';
import { CardHold, useHoldLatch } from '../lib/card-hold';
import { flashRing } from '../lib/checkFix';
import { openContextMenu } from '../lib/context-menu';
import { geist } from '../lib/geist';
import { glass } from '../lib/glass';
import { host } from '../lib/host-config';
import { deleteOp, getReplies, setOpStatus } from '../lib/ops';
import { type ParsedInspectorComment, parseInspectorComment } from '../lib/selector';
import { getCommentStatus, STATUS_LABELS, STATUS_STYLES } from '../lib/status-ui';
import { copyText } from '../lib/toasts';
import type { CommentOp } from '../lib/types';
import { AgentFixBanner } from './AgentFixBanner';
import { CommentMedia } from './CommentMedia';
import { TriageSection } from './CommentTriage';
import { MentionText } from './MentionText';
import { PriorityPin } from './PriorityPicker';
import { Reactions } from './Reactions';
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

function InspectorCommentBody({ parsed, closed }: { parsed: ParsedInspectorComment; closed: boolean }) {
  return (
    <div class="flex flex-col gap-2.5">
      {parsed.task && (
        <p
          class="text-(--ds-gray-1000) text-ui leading-body wrap-break-word whitespace-pre-wrap m-0 font-medium"
          style={{ textDecoration: closed ? 'line-through' : 'none', opacity: closed ? 0.55 : 1 }}
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

/**
 * A comment on the page: the pin and its hover card. Hosts own where it sits and how
 * it reaches files; everything a person sees or does here is the same on both.
 */
export function CommentPinCard({
  op,
  left,
  top,
  flipH,
  flipV,
  drifted,
  cardClass,
  pinStyle,
  canDelete,
  onPinClick,
  upload,
  resolveUrl,
}: {
  op: CommentOp;
  left: number;
  top: number;
  flipH: boolean;
  flipV: boolean;
  /** Anchored by text fingerprint alone, so the mark may have moved. */
  drifted: boolean;
  /** The card's surface and height cap, which differ between host page and viewer. */
  cardClass: string;
  pinStyle?: CSSProperties;
  canDelete: boolean;
  /** For a host with no hover: the pin takes the click and no card opens. */
  onPinClick?: (e: MouseEvent) => void;
  upload: (file: File | Blob) => Promise<string | null>;
  resolveUrl: (id: string) => string;
}) {
  const status = getCommentStatus(op);
  const closed = isClosed(status);
  const dismissed = status === 'dismissed';
  const inProgress = status === 'in_progress';
  const styles = STATUS_STYLES[status];
  const inspector = parseInspectorComment(op.text);
  const replies = getReplies(op.id);
  const hold = useHoldLatch();
  const { triage } = host.capabilities;

  const onContextMenu = (e: MouseEvent) =>
    openContextMenu(e, [
      {
        label: closed ? 'Reopen' : 'Resolve',
        icon: 'check',
        onClick: () => setOpStatus(op.id, closed ? 'open' : 'resolved'),
      },
      // Only once the work is claimed done: approving is the requester agreeing
      // with a fix, so offering it on an open thread would skip the fix.
      ...(status === 'resolved'
        ? [{ label: 'Approve', icon: 'check' as const, onClick: () => setOpStatus(op.id, 'approved') }]
        : []),
      ...(inspector?.task
        ? [{ label: 'Copy task', icon: 'copy' as const, onClick: () => copyText(inspector.task ?? '', 'Task copied') }]
        : []),
      { label: 'Copy text', icon: 'copy', onClick: () => copyText(op.text, 'Comment copied') },
      { label: 'Delete', icon: 'clear', danger: true, onClick: () => deleteOp(op.id) },
    ]);

  return (
    <CardHold value={hold.report}>
      <div
        class={cn('absolute pointer-events-auto cursor-pointer hover:z-50', hold.rootCls, 'group/pin', glass.font)}
        style={{ left, top }}
        data-anchor-drift={drifted ? 'text' : undefined}
        data-marker
        data-held={hold.held || undefined}
        onContextMenu={onContextMenu}
        onClick={onPinClick}
      >
        <div class="relative -translate-x-1/2 -translate-y-1/2">
          <div
            // A marker on someone else's page: flat fill, a surface-coloured ring
            // to separate it from whatever is behind, and one tight shadow. The
            // ring thickens on hover instead of the pin growing.
            class="relative w-7 h-7 rounded-full text-white text-meta font-semibold
                 grid place-items-center pointer-coarse:after:absolute pointer-coarse:after:-inset-2
                 shadow-[0_0_0_2px_var(--ds-background-100),0_1px_2px_oklch(0_0_0/0.25)]
                 transition-[box-shadow] duration-150 ease-out
                 group-hover/pin:shadow-[0_0_0_3px_var(--ds-background-100),0_1px_2px_oklch(0_0_0/0.3)]"
            style={{ background: op.color, opacity: styles.pinOpacity, ...pinStyle, ...flashRing(op) }}
          >
            {op.num}
            {status !== 'open' && (
              <div
                role="img"
                aria-label={STATUS_LABELS[status]}
                class="absolute -bottom-1 -right-1 w-4 h-4 rounded-full text-white grid place-items-center [box-shadow:0_0_0_1.5px_var(--ds-background-100)]"
                style={{ background: styles.bg }}
              >
                {status === 'resolved' && <Check size={9} strokeWidth={2.5} aria-hidden="true" />}
                {status === 'approved' && <CheckCheck size={9} strokeWidth={2.5} aria-hidden="true" />}
                {inProgress && <Loader2 size={9} strokeWidth={2.75} class="animate-spin" aria-hidden="true" />}
                {dismissed && <HelpCircle size={9} strokeWidth={2.5} aria-hidden="true" />}
              </div>
            )}
            {replies.length > 0 && !closed && (
              <div class="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-(--ds-background-100) text-micro font-medium text-(--ds-gray-1000) grid place-items-center [box-shadow:0_0_0_1.5px_var(--ds-background-100)]">
                {replies.length}
              </div>
            )}
            {op.priority && <PriorityPin priority={op.priority} />}
          </div>

          {/* Hover card. The pin-to-card gap is padding on this wrapper, not a
            positional offset — as dead space it drops :hover mid-crossing and the
            card vanishes before the pointer arrives. */}
          {!onPinClick && (
            <div
              class={cn(
                'absolute',
                flipV ? 'bottom-0' : 'top-0',
                flipH ? 'right-full pr-2.5' : 'left-full pl-2.5',
                'pointer-events-none group-hover/pin:pointer-events-auto',
                hold.wrapCls,
              )}
            >
              <div
                class={cn(
                  cardClass,
                  inspector ? 'w-[320px]' : 'w-[300px]',
                  'overflow-y-auto',
                  'opacity-0',
                  flipH ? 'translate-x-[6px]' : 'translate-x-[-6px]',
                  'transition-[opacity,translate] duration-150 ease-out',
                  'group-hover/pin:opacity-100 group-hover/pin:translate-x-0',
                  hold.cardCls,
                )}
                onClick={(e) => e.stopPropagation()}
              >
                <ThreadHeader
                  label={String(op.num)}
                  color={op.color}
                  author={isAgentAuthored(op) && op.author ? agentLabel(op.author) : op.author}
                  ts={op.ts}
                  priority={op.priority}
                  onDelete={canDelete ? () => deleteOp(op.id) : undefined}
                />

                {(op.assignedAgent || (dismissed && op.dismissReason)) && (
                  <div class="flex items-center gap-1.5 px-3.5 pb-1.5">
                    {op.assignedAgent && (
                      // Same treatment as PriorityBadge, and for the same reason: the tinted
                      // capsule made this the loudest thing in the card and set the label in
                      // `styles.color`, which is `transparent` while a thread is open — so an
                      // agent's own annotation drew an empty amber box where its name should be.
                      <span class="text-meta inline-flex items-center gap-1 font-medium text-(--ds-gray-900)">
                        {inProgress ? (
                          <Loader2
                            size={10}
                            strokeWidth={2.75}
                            class="animate-spin"
                            style={{ color: styles.color }}
                            aria-hidden="true"
                          />
                        ) : (
                          <AgentMark id={op.assignedAgent} size={11} />
                        )}
                        {agentLabel(op.assignedAgent)}
                      </span>
                    )}
                    {dismissed && op.dismissReason && (
                      <span class="text-meta text-(--ds-gray-900)">{op.dismissReason}</span>
                    )}
                  </div>
                )}

                <div class={cn(geist.divider, 'mx-3')} />

                <div class="px-3.5 py-3">
                  {inspector ? (
                    <InspectorCommentBody parsed={inspector} closed={closed} />
                  ) : (
                    <p
                      class="text-(--ds-gray-1000) text-ui leading-body wrap-break-word whitespace-pre-wrap m-0"
                      style={{ textDecoration: closed ? 'line-through' : 'none', opacity: closed ? 0.55 : 1 }}
                    >
                      <MentionText text={op.text} mentions={op.mentions} />
                    </p>
                  )}
                  <CommentMedia op={op} resolveUrl={resolveUrl} />
                  <Reactions class="mt-2" opId={op.id} reactions={op.reactions} />
                </div>

                <ThreadReplies replies={replies} resolveUrl={resolveUrl} />

                <AgentFixBanner op={op} />

                <div class={cn(geist.divider, 'mx-3')} />

                {triage && (
                  <>
                    <TriageSection opId={op.id} status={status} assignee={op.assignee ?? null} />
                    <div class={cn(geist.divider, 'mx-3')} />
                  </>
                )}

                <ReplyComposer parent={op} upload={upload} resolveUrl={resolveUrl} />
              </div>
            </div>
          )}
        </div>
      </div>
    </CardHold>
  );
}
