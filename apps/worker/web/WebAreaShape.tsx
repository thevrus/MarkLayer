import { applyAnchorDelta } from '@ext/lib/anchor';
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
  const storedX = Math.min(op.startX, op.endX);
  const storedY = Math.min(op.startY, op.endY);
  const { x, y, strategy } = frameDoc
    ? applyAnchorDelta(
        op.target,
        { docX: storedX, docY: storedY },
        { doc: frameDoc, win: frameDoc.defaultView ?? undefined },
      )
    : { x: storedX, y: storedY, strategy: null };
  const w = Math.abs(op.endX - op.startX);
  const h = Math.abs(op.endY - op.startY);
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
        <div class="w-3 h-3 rounded-full ring-2 ring-(--ml-glass-bg)" style={{ background: stroke }} />
        <div
          class={cn(
            'absolute left-3 top-0 hidden group-hover/area:block z-10 w-[240px]',
            glass.surfaceSmall,
            glass.font,
            'p-3',
          )}
        >
          <span class="text-[10.5px] text-ml-glass-fg/65 font-bold uppercase tracking-[0.08em]">Area</span>
          {op.comment ? (
            <p
              class="text-[12.5px] text-ml-glass-fg/85 m-0 mt-1 leading-relaxed whitespace-pre-wrap"
              style={{ textDecoration: resolved ? 'line-through' : 'none', opacity: resolved ? 0.5 : 1 }}
            >
              {op.comment}
            </p>
          ) : (
            <p class="text-[12px] text-ml-glass-fg/55 m-0 mt-1 italic">No comment</p>
          )}
          <div class="flex items-center justify-between mt-2">
            <span class="text-[10px] text-ml-glass-fg/55 font-medium">{op.author}</span>
            <div class="flex items-center gap-3">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  deleteOp(op.id);
                }}
                class="text-[10.5px] font-medium text-(--ml-state-red)/70 hover:text-(--ml-state-red) bg-transparent border-none cursor-pointer p-0 transition-colors"
              >
                Delete
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setOpStatus(op.id, resolved ? 'open' : 'resolved');
                }}
                class="text-[10.5px] font-medium text-ml-glass-fg/60 hover:text-ml-glass-fg bg-transparent border-none cursor-pointer p-0 transition-colors"
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
