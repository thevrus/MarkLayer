import { cn } from '@marklayer/types';
import { signal, useSignalEffect } from '@preact/signals';
import { glass } from '../lib/glass';
import { Icon } from '../lib/icons';
import { copyText, deleteOp, inspects, openContextMenu, STATUS_STYLES, setOpStatus } from '../lib/state';
import type { InspectOp } from '../lib/types';

// Bumped on window scroll so each marker repositions. Module-level so a single
// listener serves every marker — same pattern as AreaLayer.
const scrollTick = signal(0);

function InspectorMarker({ op }: { op: InspectOp }) {
  scrollTick.value; // subscribe — repositions when window scrolls
  const status = op.status ?? 'open';
  const styles = STATUS_STYLES[status];
  const resolved = status === 'resolved' || status === 'dismissed';

  // Anchor at the top-left corner of the saved element rect, viewport-relative.
  // Marker shows a small pin even after the page reflows; the saved rect goes
  // stale by design (the inspect op is a snapshot), so we don't try to re-find
  // the live element.
  const x = op.rect.x - scrollX;
  const y = op.rect.y - scrollY;
  const w = op.rect.width;
  const h = op.rect.height;

  const flipH = x + w + 280 > innerWidth;
  const flipV = y + 280 > innerHeight;

  const onContextMenu = (e: MouseEvent) =>
    openContextMenu(e, [
      {
        label: resolved ? 'Reopen' : 'Resolve',
        icon: 'check',
        onClick: () => setOpStatus(op.id, resolved ? 'open' : 'resolved'),
      },
      { label: 'Copy markdown', icon: 'copy', onClick: () => copyText(op.markdown, 'Markdown copied') },
      ...(op.comment
        ? [{ label: 'Copy task', icon: 'copy', onClick: () => copyText(op.comment ?? '', 'Task copied') }]
        : []),
      { label: 'Delete', icon: 'clear', danger: true, onClick: () => deleteOp(op.id) },
    ]);

  const stroke = resolved ? 'var(--color-ml-resolved)' : op.color;

  return (
    <>
      {/* Faint outline of the original element rect — gives spatial context for the pin */}
      <div
        class="absolute pointer-events-none rounded-[3px]"
        style={{
          left: x,
          top: y,
          width: w,
          height: h,
          boxShadow: `inset 0 0 0 1px ${stroke}`,
          opacity: resolved ? 0.35 : 0.55,
        }}
      />
      {/* The pin itself — small, anchored at top-left, captures the context menu */}
      <div
        class="absolute pointer-events-auto group/inspect"
        style={{ left: x - 6, top: y - 6, width: 16, height: 16 }}
        onContextMenu={onContextMenu}
      >
        <div
          class="w-4 h-4 rounded-md inline-flex items-center justify-center ring-2 ring-(--ml-glass-bg) shadow-[0_1px_2px_oklch(0_0_0/0.25)]"
          style={{ background: stroke, opacity: styles.pinOpacity }}
        >
          <span class="text-[9px] font-bold text-white leading-none">
            <Icon name="terminal" size={9} />
          </span>
        </div>
        <div
          class={cn(
            'absolute hidden group-hover/inspect:block z-10 w-[260px]',
            flipV ? 'bottom-4' : 'top-4',
            flipH ? 'right-4' : 'left-4',
            glass.surfaceSmall,
            glass.font,
            'p-3',
          )}
        >
          <div class="flex items-center justify-between gap-2 mb-1">
            <span class="text-[10.5px] text-ml-glass-fg/65 font-bold uppercase tracking-[0.08em]">Inspect</span>
            {status !== 'open' && (
              <span
                class="text-[9.5px] font-bold uppercase tracking-[0.06em] px-1.5 py-0.5 rounded"
                style={{ background: `color-mix(in oklch, ${styles.bg} 18%, transparent)`, color: styles.color }}
              >
                {styles.label}
              </span>
            )}
          </div>
          <code
            class="block text-[10.5px] text-ml-glass-fg/85 bg-ml-glass-fg/4 border border-ml-glass-fg/12
                     rounded-lg px-2 py-1.5 wrap-break-word font-mono leading-snug max-h-12 overflow-hidden mb-2"
          >
            {op.selector}
          </code>
          {op.comment ? (
            <p
              class="text-[12px] text-ml-glass-fg/85 m-0 leading-relaxed whitespace-pre-wrap"
              style={{ textDecoration: resolved ? 'line-through' : 'none', opacity: resolved ? 0.55 : 1 }}
            >
              {op.comment}
            </p>
          ) : (
            <p class="text-[11.5px] text-ml-glass-fg/55 m-0 italic">No task description</p>
          )}
          <div class="flex items-center justify-between mt-2">
            <span class="text-[10px] text-ml-glass-fg/55 font-medium">{op.author ?? 'Anonymous'}</span>
            {op.assignedAgent && <span class="text-[10px] text-ml-glass-fg/55 font-medium">→ {op.assignedAgent}</span>}
          </div>
        </div>
      </div>
    </>
  );
}

export function InspectorMarkerLayer() {
  const ops = inspects.value;
  // One window-level scroll listener for the whole layer — each marker subscribes
  // to the tick rather than registering its own listener. Only attached while
  // there are markers to avoid waking subscribers on empty pages.
  useSignalEffect(() => {
    if (!inspects.value.length) return;
    const onScroll = () => {
      scrollTick.value++;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  });

  if (!ops.length) return null;
  return (
    <div
      class="fixed inset-0 z-2147483646 pointer-events-none
             font-[-apple-system,BlinkMacSystemFont,'Geist',system-ui,sans-serif]"
    >
      {ops.map((op) => (
        <InspectorMarker key={op.id} op={op} />
      ))}
    </div>
  );
}
