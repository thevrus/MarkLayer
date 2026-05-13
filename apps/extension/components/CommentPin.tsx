import { cn } from '@marklayer/types';
import { Check, HelpCircle, Loader2 } from 'lucide-preact';
import { applyAnchorDelta } from '../lib/anchor';
import { glass } from '../lib/glass';
import { type ParsedInspectorComment, parseInspectorComment } from '../lib/selector';
import {
  copyText,
  deleteOp,
  getCommentStatus,
  hostMutationTick,
  openContextMenu,
  STATUS_STYLES,
  scrollTick,
  setOpStatus,
} from '../lib/state';
import { timeAgo } from '../lib/time';
import type { CommentOp } from '../lib/types';

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
          class="text-ml-glass-fg text-[13px] leading-[1.55] wrap-break-word whitespace-pre-wrap m-0 font-medium"
          style={{ textDecoration: resolved ? 'line-through' : 'none', opacity: resolved ? 0.55 : 1 }}
        >
          {parsed.task}
        </p>
      )}

      {parsed.fields.length > 0 && (
        <dl class="grid grid-cols-[64px_1fr] gap-x-3 gap-y-1 items-baseline text-[11.5px] m-0">
          {parsed.fields.map(([label, value]) => {
            const isCode = label === 'Selector';
            return (
              <div key={label} class="contents">
                <dt class="text-[10px] text-ml-glass-fg/55 font-semibold uppercase tracking-[0.06em] tabular-nums">
                  {label}
                </dt>
                <dd
                  class={cn(
                    'text-ml-glass-fg/85 m-0 wrap-break-word',
                    isCode &&
                      'font-mono text-[11px] bg-ml-glass-fg/4 border border-ml-glass-fg/12 rounded-md px-1.5 py-0.5',
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
          class="m-0 text-[10.5px] font-mono leading-snug text-ml-glass-fg/80
                 bg-(--ml-syntax-bg) border border-ml-glass-fg/10 rounded-lg
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
      class={cn('absolute pointer-events-auto cursor-pointer', 'group/pin', glass.font)}
      style={{ left, top }}
      data-doc-x={op.x}
      data-doc-y={op.y}
      data-anchor-drift={strategy === 'text' ? 'text' : undefined}
      onContextMenu={onContextMenu}
    >
      <div class="relative -translate-x-1/2 -translate-y-1/2">
        {/* Pin dot */}
        <div
          class="w-7 h-7 rounded-full text-white text-[11px] font-semibold
                 grid place-items-center
                 shadow-[0_0_0_2.5px_oklch(0_0_0/0.2),0_2px_10px_oklch(0_0_0/0.35),inset_0_1px_0_oklch(1_0_0/0.2)]
                 transition-all duration-200 ease-out
                 group-hover/pin:scale-[1.15] group-hover/pin:shadow-[0_0_0_2.5px_oklch(1_0_0/0.12),0_4px_20px_oklch(0_0_0/0.45),inset_0_1px_0_oklch(1_0_0/0.25)]"
          style={{
            background: `linear-gradient(to bottom, color-mix(in oklch, ${op.color} 100%, white 20%), ${op.color})`,
            opacity: styles.pinOpacity,
          }}
        >
          {op.num}
          {status !== 'open' && (
            <div
              role="img"
              aria-label={styles.label}
              class="absolute -bottom-1 -right-1 w-4 h-4 rounded-full text-white grid place-items-center shadow-sm border border-ml-glass-fg/80"
              style={{ background: styles.bg }}
            >
              {status === 'resolved' && <Check size={9} strokeWidth={2.5} aria-hidden="true" />}
              {status === 'in_progress' && (
                <Loader2 size={9} strokeWidth={2.75} class="animate-spin" aria-hidden="true" />
              )}
              {status === 'dismissed' && <HelpCircle size={9} strokeWidth={2.5} aria-hidden="true" />}
            </div>
          )}
        </div>

        {/* Hover card */}
        <div
          class={cn(
            'absolute',
            flipV ? 'bottom-0' : 'top-0',
            flipH ? 'right-[calc(100%+10px)]' : 'left-[calc(100%+10px)]',
            glass.surfaceSmall,
            inspector ? 'w-[320px]' : 'w-max max-w-[280px] min-w-[160px]',
            'opacity-0 scale-90 pointer-events-none',
            flipH ? 'translate-x-[6px]' : 'translate-x-[-6px]',
            'transition-all duration-200 ease-out',
            'group-hover/pin:opacity-100 group-hover/pin:scale-100 group-hover/pin:translate-x-0 group-hover/pin:pointer-events-auto',
            'overflow-hidden',
          )}
        >
          {/* Header */}
          <div class="flex items-center gap-2.5 px-3.5 pt-3 pb-2">
            <div
              class="w-5 h-5 rounded-full text-white text-[9px] font-bold grid place-items-center shrink-0
                     shadow-[inset_0_1px_0_oklch(1_0_0/0.15)]"
              style={{ background: op.color }}
            >
              {op.num}
            </div>
            <span class="text-[10.5px] text-ml-glass-fg/65 font-medium tabular-nums tracking-wide">
              {timeAgo(op.ts)}
            </span>
          </div>

          <div class={cn(glass.divider, 'mx-3')} />

          {/* Body */}
          <div class="px-3.5 py-3 max-h-[50vh] overflow-y-auto overscroll-contain">
            {inspector ? (
              <InspectorCommentBody parsed={inspector} resolved={resolved} />
            ) : (
              <p
                class="text-ml-glass-fg/90 text-[13px] leading-[1.55] wrap-break-word whitespace-pre-wrap m-0"
                style={{ textDecoration: resolved ? 'line-through' : 'none', opacity: resolved ? 0.55 : 1 }}
              >
                {op.text}
              </p>
            )}
          </div>

          <div class={cn(glass.divider, 'mx-3')} />

          {/* Footer */}
          <div class="px-3.5 py-2 flex items-center gap-1.5">
            <span class="text-[10.5px] text-ml-glass-fg/55 font-medium">Click to reply</span>
          </div>
        </div>
      </div>
    </div>
  );
}
