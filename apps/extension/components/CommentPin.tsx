import { clsx } from 'clsx';
import { glass } from '../lib/glass';
import { timeAgo } from '../lib/time';
import type { CommentOp } from '../lib/types';

export function CommentPin({ op }: { op: CommentOp }) {
  return (
    <div
      class={clsx('absolute pointer-events-auto cursor-pointer', 'group/pin', glass.font)}
      style={{ left: op.x - scrollX, top: op.y - scrollY }}
      data-doc-x={op.x}
      data-doc-y={op.y}
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
          }}
        >
          {op.num}
        </div>

        {/* Hover card */}
        <div
          class={clsx(
            'absolute top-0 left-[calc(100%+10px)]',
            glass.surfaceSmall,
            'w-max max-w-[280px] min-w-[160px]',
            'opacity-0 scale-90 translate-x-[-6px] pointer-events-none',
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
            <span class="text-[10px] text-white/30 font-medium tracking-wide">{timeAgo(op.ts)}</span>
          </div>

          <div class={clsx(glass.divider, 'mx-3')} />

          {/* Body */}
          <div class="px-3.5 py-3">
            <p class="text-white/75 text-[12.5px] leading-[1.55] break-words whitespace-pre-wrap m-0">{op.text}</p>
          </div>

          <div class={clsx(glass.divider, 'mx-3')} />

          {/* Footer */}
          <div class="px-3.5 py-2 flex items-center gap-1.5">
            <span class="text-[10px] text-white/20 font-medium">Click to reply</span>
          </div>
        </div>
      </div>
    </div>
  );
}
