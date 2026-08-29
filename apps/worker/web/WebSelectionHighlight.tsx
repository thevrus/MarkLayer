import { PriorityBadge } from '@ext/components/PriorityPicker';
import { SuggestionDiff } from '@ext/components/SelectionEdit';
import { reprojectRects } from '@ext/lib/anchor';
import { geist } from '@ext/lib/geist';
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
            geist.surfaceSmall,
            glass.font,
            'p-3',
          )}
        >
          {op.priority && (
            <div class="mb-1.5">
              <PriorityBadge priority={op.priority} />
            </div>
          )}
          {op.suggestion ? (
            <SuggestionDiff text={op.text} suggestion={op.suggestion} resolved={resolved} class="mb-1" />
          ) : (
            <p class="text-meta text-(--ds-gray-900) m-0 mb-1 line-clamp-3 leading-relaxed">{op.text}</p>
          )}
          {op.comment && (
            <p
              class="text-ui text-(--ds-gray-1000) m-0 mt-1.5 leading-relaxed whitespace-pre-wrap"
              style={{ textDecoration: resolved ? 'line-through' : 'none', opacity: resolved ? 0.5 : 1 }}
            >
              {op.comment}
            </p>
          )}
          <div class="flex items-center justify-between mt-2">
            <span class="text-meta text-(--ds-gray-900) font-medium">{op.author}</span>
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
  );
}
