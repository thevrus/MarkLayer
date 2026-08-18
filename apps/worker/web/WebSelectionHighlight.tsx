import { PriorityBadge } from '@ext/components/PriorityPicker';
import { reprojectRects } from '@ext/lib/anchor';
import { glass } from '@ext/lib/glass';
import { hexToRgba } from '@ext/lib/renderer';
import { copyText, deleteOp, openContextMenu, setOpStatus } from '@ext/lib/state';
import type { SelectionOp } from '@ext/lib/types';
import { cn } from '@marklayer/types';
import { iframeMutationTick } from './signals';

interface Props {
  op: SelectionOp;
  scale: number;
  scrollY: number;
  frameDoc?: Document | null;
}

export function WebSelectionHighlight({ op, scale: s, scrollY, frameDoc }: Props) {
  iframeMutationTick.value; // re-resolve anchor when iframe DOM mutates
  if (!op.rects.length) return null;
  const resolved = op.status === 'resolved';
  // Doc-space anchoring only; `s` (viewer cssScale zoom) is applied on top of
  // the result below, never in place of it.
  const anchored = reprojectRects({
    target: op.target,
    rects: op.rects,
    ctx: frameDoc ? { doc: frameDoc, win: frameDoc.defaultView ?? undefined } : undefined,
  });
  if (!anchored) return null;
  const { rects: scaledRects, bounds, strategy } = anchored;

  return (
    <div class="group/sel">
      {/* Colored highlight rects */}
      {scaledRects.map((r, i) => (
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
          left: bounds.x * s,
          top: bounds.y * s - scrollY,
          width: bounds.width * s,
          height: bounds.height * s,
        }}
        data-anchor-drift={strategy === 'text' ? 'text' : undefined}
        onContextMenu={(e) =>
          openContextMenu(e, [
            {
              label: resolved ? 'Reopen' : 'Resolve',
              icon: 'check',
              onClick: () => setOpStatus(op.id, resolved ? 'open' : 'resolved'),
            },
            { label: 'Copy text', icon: 'copy', onClick: () => copyText(op.text, 'Selection copied') },
            { label: 'Delete', icon: 'clear', danger: true, onClick: () => deleteOp(op.id) },
          ])
        }
      >
        {/* Hover card */}
        <div
          class={cn(
            'absolute left-full top-0 ml-2 hidden group-hover/sel:block z-10 w-[240px]',
            glass.surfaceSmall,
            glass.font,
            'p-3',
          )}
        >
          {op.priority && (
            <div class="mb-1.5">
              <PriorityBadge priority={op.priority} />
            </div>
          )}
          <p class="text-[11.5px] text-ml-glass-fg/65 m-0 mb-1 italic line-clamp-3 leading-relaxed">"{op.text}"</p>
          {op.comment && (
            <p
              class="text-[12.5px] text-ml-glass-fg/85 m-0 mt-1.5 leading-relaxed whitespace-pre-wrap"
              style={{ textDecoration: resolved ? 'line-through' : 'none', opacity: resolved ? 0.5 : 1 }}
            >
              {op.comment}
            </p>
          )}
          <div class="flex items-center justify-between mt-2">
            <span class="text-[10px] text-ml-glass-fg/60 font-medium">{op.author}</span>
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
  );
}
