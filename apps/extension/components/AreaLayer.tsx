import { cn } from '@marklayer/types';
import { signal, useSignal, useSignalEffect } from '@preact/signals';
import { nanoid } from 'nanoid';
import type { TargetedEvent } from 'preact';
import { useCallback, useRef } from 'preact/hooks';
import { submitBtn, textareaCls } from '../lib/buttons';
import { glass } from '../lib/glass';
import { hexToRgba } from '../lib/renderer';
import { captureTarget, pickElementAtPoint } from '../lib/selector';
import {
  activeTool,
  areas,
  color,
  copyText,
  deleteOp,
  lineWidth,
  localUser,
  openContextMenu,
  pushOp,
  setOpStatus,
} from '../lib/state';
import type { AreaOp } from '../lib/types';

export interface DraftRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DraftAreaState {
  startDocX: number;
  startDocY: number;
  curDocX: number;
  curDocY: number;
}

export function rectFromDraft(d: DraftAreaState): DraftRect {
  const x = Math.min(d.startDocX, d.curDocX);
  const y = Math.min(d.startDocY, d.curDocY);
  return {
    x,
    y,
    w: Math.abs(d.curDocX - d.startDocX),
    h: Math.abs(d.curDocY - d.startDocY),
  };
}

// Bumped on window scroll so AreaShape components reposition. Module-level so
// a single listener serves every shape (attached lazily by AreaLayer).
const scrollTick = signal(0);

function AreaShape({ op }: { op: AreaOp }) {
  scrollTick.value; // subscribe — repositions when window scrolls
  const resolved = op.status === 'resolved';
  const x = Math.min(op.startX, op.endX) - scrollX;
  const y = Math.min(op.startY, op.endY) - scrollY;
  const w = Math.abs(op.endX - op.startX);
  const h = Math.abs(op.endY - op.startY);
  const stroke = resolved ? 'var(--color-ml-resolved)' : op.color;
  const fill = resolved ? 'color-mix(in oklch, var(--color-ml-resolved) 8%, transparent)' : hexToRgba(op.color, 0.12);
  const flipH = x + w + 240 > innerWidth;
  const flipV = y + 240 > innerHeight;

  const onAreaContextMenu = (e: MouseEvent) =>
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
    ]);

  return (
    <>
      <div
        // `pointer-events: auto` so right-click anywhere in the rect opens the
        // context menu. The cursor is `default` so it doesn't look interactive
        // for the primary mouse button — drawing new areas underneath this one
        // is intentionally blocked, which matches selection/comment behavior.
        class="absolute pointer-events-auto rounded-[3px]"
        style={{
          left: x,
          top: y,
          width: w,
          height: h,
          background: fill,
          boxShadow: `inset 0 0 0 1.5px ${stroke}`,
          opacity: resolved ? 0.7 : 1,
          cursor: 'default',
        }}
        onContextMenu={onAreaContextMenu}
      />
      <div
        class="absolute pointer-events-auto group/area"
        style={{ left: x - 4, top: y - 4, width: 12, height: 12 }}
        onContextMenu={onAreaContextMenu}
      >
        <div class="w-3 h-3 rounded-full ring-2 ring-(--ml-glass-bg)" style={{ background: stroke }} />
        <div
          class={cn(
            'absolute hidden group-hover/area:block z-10 w-[240px]',
            flipV ? 'bottom-3' : 'top-3',
            flipH ? 'right-3' : 'left-3',
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
    </>
  );
}

export function AreaPopover({
  rect,
  onCommit,
  onCancel,
}: {
  rect: DraftRect;
  onCommit: (comment: string) => void;
  onCancel: () => void;
}) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const setTaRef = useCallback((el: HTMLTextAreaElement | null) => {
    taRef.current = el;
    el?.focus();
  }, []);

  const vx = rect.x - scrollX;
  const vy = rect.y - scrollY;
  const panelW = 290;
  const margin = 8;
  const left = Math.max(margin, Math.min(vx + rect.w + 12, innerWidth - panelW - margin));
  const top = Math.max(margin, Math.min(vy, innerHeight - 200 - margin));

  return (
    <div
      class={cn(
        'fixed z-2147483647 pointer-events-auto',
        'animate-[fadeInDown_180ms_cubic-bezier(0.16,1,0.3,1)]',
        glass.surface,
        glass.font,
        'overflow-hidden w-[290px]',
      )}
      style={{ left, top }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div class="px-4 pt-3.5 pb-2">
        <span class="text-[10.5px] text-ml-glass-fg/65 font-bold uppercase tracking-[0.08em]">Area annotation</span>
        <p class="text-[12px] text-ml-glass-fg/55 m-0 mt-1 tabular-nums">
          {Math.round(rect.w)} × {Math.round(rect.h)} px
        </p>
      </div>

      <div class={cn(glass.divider, 'mx-3.5')} />

      <div class="p-3.5">
        <textarea
          ref={setTaRef}
          placeholder="What's wrong with this region? (optional)…"
          rows={1}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              onCommit(taRef.current?.value.trim() || '');
            } else if (e.key === 'Escape') {
              e.preventDefault();
              onCancel();
            }
          }}
          class={cn(textareaCls, 'w-full min-h-10 max-h-[140px]', glass.font)}
          style={{ fieldSizing: 'content', boxSizing: 'border-box' }}
        />
      </div>

      <div class={cn(glass.divider, 'mx-3.5')} />

      <div class="flex items-center justify-between px-4 py-2.5">
        <div class="flex items-center gap-2">
          <kbd
            class="text-[10.5px] text-ml-glass-fg/75 bg-ml-glass-fg/8 border border-ml-glass-fg/15
                      rounded-md px-1.5 py-0.5 font-mono font-medium leading-none"
          >
            Esc
          </kbd>
          <span class="text-[11px] text-ml-glass-fg/55 font-medium">cancel</span>
        </div>
        <button type="button" onClick={() => onCommit(taRef.current?.value.trim() || '')} class={submitBtn}>
          Save ↵
        </button>
      </div>
    </div>
  );
}

export function AreaLayer() {
  const draft = useSignal<DraftAreaState | null>(null);
  const pending = useSignal<DraftRect | null>(null);

  // Only listen for scroll when there are committed shapes to reposition;
  // pages without areas don't need the per-frame signal updates.
  useSignalEffect(() => {
    if (!areas.value.length) return;
    const onScroll = () => {
      scrollTick.value++;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  });

  const onPointerDown = useCallback(
    (e: TargetedEvent<HTMLDivElement, PointerEvent>) => {
      if (activeTool.value !== 'area' || pending.value) return;
      if (e.button !== 0) return;
      e.preventDefault();
      const dx = e.clientX + scrollX;
      const dy = e.clientY + scrollY;
      draft.value = { startDocX: dx, startDocY: dy, curDocX: dx, curDocY: dy };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [draft, pending],
  );

  const onPointerMove = useCallback(
    (e: TargetedEvent<HTMLDivElement, PointerEvent>) => {
      const d = draft.value;
      if (!d) return;
      draft.value = { ...d, curDocX: e.clientX + scrollX, curDocY: e.clientY + scrollY };
    },
    [draft],
  );

  const onPointerUp = useCallback(
    (e: TargetedEvent<HTMLDivElement, PointerEvent>) => {
      const d = draft.value;
      if (!d) return;
      e.currentTarget.releasePointerCapture(e.pointerId);
      const r = rectFromDraft(d);
      draft.value = null;
      if (r.w < 6 || r.h < 6) return;
      pending.value = r;
    },
    [draft, pending],
  );

  const commit = (comment: string) => {
    const r = pending.value;
    if (!r) return;
    // Centre of the rect in viewport coords — find the topmost real page element
    // sitting under the area so the agent gets selector + markup, not just a box.
    const cx = r.x + r.w / 2 - window.scrollX;
    const cy = r.y + r.h / 2 - window.scrollY;
    const el = pickElementAtPoint(cx, cy);
    const op: AreaOp = {
      id: nanoid(),
      tool: 'area',
      color: color.value,
      lineWidth: lineWidth.value,
      startX: r.x,
      startY: r.y,
      endX: r.x + r.w,
      endY: r.y + r.h,
      comment: comment || undefined,
      ts: Date.now(),
      author: localUser.name,
      target: el ? captureTarget(el) : undefined,
    };
    pushOp(op);
    pending.value = null;
  };

  const cancel = () => {
    pending.value = null;
  };

  // Show the rect both while dragging (`draft`) and while the comment popover
  // is open (`pending`) — otherwise the area visually disappears the moment
  // the user lifts the mouse, which is disorienting when typing the comment.
  const drawing = draft.value ? rectFromDraft(draft.value) : pending.value;
  const isAreaTool = activeTool.value === 'area';

  return (
    <div
      class="fixed inset-0 z-2147483646
             font-[-apple-system,BlinkMacSystemFont,'Geist',system-ui,sans-serif]"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      style={{
        pointerEvents: isAreaTool && !pending.value ? 'auto' : 'none',
        cursor: isAreaTool ? 'crosshair' : 'default',
        touchAction: isAreaTool ? 'none' : undefined,
      }}
    >
      {areas.value.map((a) => (
        <AreaShape key={a.id} op={a} />
      ))}

      {drawing && (
        <div
          class="absolute pointer-events-none rounded-[3px]"
          style={{
            left: drawing.x - scrollX,
            top: drawing.y - scrollY,
            width: drawing.w,
            height: drawing.h,
            background: hexToRgba(color.value, 0.12),
            boxShadow: `inset 0 0 0 1.5px ${color.value}`,
          }}
        />
      )}

      {pending.value && <AreaPopover rect={pending.value} onCommit={commit} onCancel={cancel} />}
    </div>
  );
}
