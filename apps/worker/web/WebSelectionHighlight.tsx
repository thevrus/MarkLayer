import { glass } from '@ext/lib/glass';
import { hexToRgba } from '@ext/lib/renderer';
import { setOpStatus } from '@ext/lib/state';
import type { SelectionOp } from '@ext/lib/types';
import { clsx } from 'clsx';

interface Props {
  op: SelectionOp;
  scale: number;
  scrollY: number;
}

export function WebSelectionHighlight({ op, scale: s, scrollY }: Props) {
  if (!op.rects.length) return null;
  const resolved = op.status === 'resolved';

  // Compute bounding box of all rects for the hover target
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of op.rects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.width);
    maxY = Math.max(maxY, r.y + r.height);
  }

  return (
    <div class="group/sel">
      {/* Colored highlight rects */}
      {op.rects.map((r, i) => (
        <div
          key={i}
          class="absolute pointer-events-none"
          style={{
            left: r.x * s,
            top: r.y * s - scrollY,
            width: r.width * s,
            height: r.height * s,
            background: resolved ? 'rgba(107,114,128,0.1)' : hexToRgba(op.color, 0.25),
            borderRadius: 2,
          }}
        />
      ))}

      {/* Invisible hover target over the bounding box */}
      <div
        class="absolute pointer-events-auto"
        style={{
          left: minX * s,
          top: minY * s - scrollY,
          width: (maxX - minX) * s,
          height: (maxY - minY) * s,
        }}
      >
        {/* Hover card */}
        <div
          class={clsx(
            'absolute left-full top-0 ml-2 hidden group-hover/sel:block z-10 w-[240px]',
            glass.surfaceSmall,
            glass.font,
            'p-3',
          )}
        >
          <p class="text-[11px] text-ml-glass-fg/40 m-0 mb-1 italic line-clamp-3 leading-relaxed">"{op.text}"</p>
          {op.comment && (
            <p
              class="text-[12px] text-ml-glass-fg/70 m-0 mt-1.5 leading-relaxed whitespace-pre-wrap"
              style={{ textDecoration: resolved ? 'line-through' : 'none', opacity: resolved ? 0.5 : 1 }}
            >
              {op.comment}
            </p>
          )}
          <div class="flex items-center justify-between mt-2">
            <span class="text-[9px] text-ml-glass-fg/25">{op.author}</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setOpStatus(op.id, resolved ? 'open' : 'resolved');
              }}
              class="text-[10px] text-ml-glass-fg/30 hover:text-ml-glass-fg/60 bg-transparent border-none cursor-pointer p-0 transition-colors"
            >
              {resolved ? '↩ Reopen' : '✓ Resolve'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
