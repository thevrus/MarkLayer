import { cn } from '@marklayer/ui/cn';
import type { ComponentChildren } from 'preact';
import type { ContextMenuItem } from '../lib/context-menu';
import { geist } from '../lib/geist';
import { glass } from '../lib/glass';
import { deleteOp, setOpStatus } from '../lib/ops';
import { hexToRgba } from '../lib/renderer';
import { copyText } from '../lib/toasts';
import type { AreaOp } from '../lib/types';
import { MentionText } from './MentionText';
import { PriorityBadge } from './PriorityPicker';

/** How a placed area paints, resolved or not. */
export function areaPaint(op: AreaOp) {
  const resolved = op.status === 'resolved';
  return {
    resolved,
    stroke: resolved ? 'var(--color-ml-resolved)' : op.color,
    fill: resolved ? 'color-mix(in oklch, var(--color-ml-resolved) 8%, transparent)' : hexToRgba(op.color, 0.12),
  };
}

export function areaMenuItems(op: AreaOp): ContextMenuItem[] {
  const resolved = op.status === 'resolved';
  return [
    {
      label: resolved ? 'Reopen' : 'Resolve',
      icon: 'check',
      onClick: () => setOpStatus(op.id, resolved ? 'open' : 'resolved'),
    },
    ...(op.comment
      ? [{ label: 'Copy comment', icon: 'copy' as const, onClick: () => copyText(op.comment ?? '', 'Comment copied') }]
      : []),
    { label: 'Delete', icon: 'clear', danger: true, onClick: () => deleteOp(op.id) },
  ];
}

/** An area's hover card, shown from a `group/area` parent. `class` places it, `children` sit under the note. */
export function AreaCard({
  op,
  class: className,
  children,
}: {
  op: AreaOp;
  class: string;
  children?: ComponentChildren;
}) {
  const resolved = op.status === 'resolved';
  return (
    <div
      class={cn(
        'absolute hidden group-hover/area:block z-10 w-[240px]',
        className,
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
      {children}
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
  );
}
