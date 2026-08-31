import { MentionText } from '@ext/components/MentionText';
import { PriorityBadge } from '@ext/components/PriorityPicker';
import { reprojectBox } from '@ext/lib/anchor';
import { geist } from '@ext/lib/geist';
import { glass } from '@ext/lib/glass';
import { hexToRgba } from '@ext/lib/renderer';
import { copyText, deleteOp, openContextMenu, setOpStatus } from '@ext/lib/state';
import type { AreaOp } from '@ext/lib/types';
import { cn } from '@marklayer/types';
import { iframeMutationTick } from './signals';

interface Props {
  op: AreaOp;
  scale: number;
  scrollY: number;
  frameDoc?: Document | null;
}

export function WebAreaShape({ op, scale: s, scrollY, frameDoc }: Props) {
  iframeMutationTick.value; // re-resolve anchor when iframe DOM mutates
  const resolved = op.status === 'resolved';
  // Doc-space anchoring applied first, THEN `s` (the viewer's cssScale zoom)
  // multiplies both position and size below — scaling twice by the same factor
  // would double-apply the zoom.
  const {
    x,
    y,
    width: w,
    height: h,
    strategy,
  } = reprojectBox({
    target: op.target,
    startX: op.startX,
    startY: op.startY,
    endX: op.endX,
    endY: op.endY,
    ctx: frameDoc ? { doc: frameDoc, win: frameDoc.defaultView ?? undefined } : undefined,
  });
  const stroke = resolved ? 'var(--color-ml-resolved)' : op.color;
  const fill = resolved ? 'color-mix(in oklch, var(--color-ml-resolved) 8%, transparent)' : hexToRgba(op.color, 0.12);

  return (
    <div class="group/area">
      <div
        class="absolute pointer-events-none rounded-[3px]"
        style={{
          left: x * s,
          top: y * s - scrollY,
          width: w * s,
          height: h * s,
          background: fill,
          boxShadow: `inset 0 0 0 1.5px ${stroke}`,
          opacity: resolved ? 0.7 : 1,
        }}
        data-anchor-drift={strategy === 'text' ? 'text' : undefined}
      />
      <div
        class="absolute pointer-events-auto"
        style={{
          left: x * s - 6,
          top: y * s - scrollY - 6,
          width: 14,
          height: 14,
        }}
        onContextMenu={(e) =>
          openContextMenu(e, [
            {
              label: resolved ? 'Reopen' : 'Resolve',
              icon: 'check',
              onClick: () => setOpStatus(op.id, resolved ? 'open' : 'resolved'),
            },
            ...(op.comment
              ? [{ label: 'Copy comment', icon: 'copy', onClick: () => copyText(op.comment ?? '', 'Comment copied') }]
              : []),
            { label: 'Delete', icon: 'clear', danger: true, onClick: () => deleteOp(op.id) },
          ])
        }
      >
        <div class="w-3 h-3 rounded-full ring-2 ring-(--ds-background-100)" style={{ background: stroke }} />
        <div
          class={cn(
            'absolute left-3 top-0 hidden group-hover/area:block z-10 w-[240px]',
            geist.surfaceSmall,
            glass.font,
            'p-3',
          )}
        >
          <div class="flex items-center justify-between gap-2">
            <span class={geist.sectionLabel}>Area</span>
            {op.priority && <PriorityBadge priority={op.priority} />}
          </div>
          {op.comment ? (
            <p
              class="text-ui text-(--ds-gray-1000) m-0 mt-1 leading-relaxed whitespace-pre-wrap"
              style={{ textDecoration: resolved ? 'line-through' : 'none', opacity: resolved ? 0.5 : 1 }}
            >
              <MentionText text={op.comment} mentions={op.mentions} />
            </p>
          ) : (
            <p class="text-meta text-(--ds-gray-900) m-0 mt-1">No comment</p>
          )}
          <div class="flex items-center justify-between mt-2">
            <span class="text-meta text-(--ds-gray-900) font-medium">{op.author}</span>
            <div class="flex items-center gap-3">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  deleteOp(op.id);
                }}
                class={cn(geist.bareBtn, geist.bareBtnDanger, 'font-medium')}
              >
                Delete
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setOpStatus(op.id, resolved ? 'open' : 'resolved');
                }}
                class={cn(geist.bareBtn, geist.bareBtnQuiet, 'font-medium')}
              >
                {resolved ? 'Reopen' : 'Resolve'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
