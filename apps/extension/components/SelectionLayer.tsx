import { cn, type TargetElement } from '@marklayer/types';
import { nanoid } from 'nanoid';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { applyAnchorDelta } from '../lib/anchor';
import { submitBtn, textareaCls } from '../lib/buttons';
import { glass } from '../lib/glass';
import { hexToRgba } from '../lib/renderer';
import { captureTarget } from '../lib/selector';
import {
  activeTool,
  color,
  copyText,
  deleteOp,
  hostMutationTick,
  lineWidth,
  localUser,
  openContextMenu,
  pushOp,
  scrollTick,
  selections,
  setOpStatus,
} from '../lib/state';
import type { SelectionOp, SelectionRect } from '../lib/types';

interface PopoverState {
  x: number;
  y: number;
  text: string;
  rects: SelectionRect[];
  target: TargetElement | undefined;
}

function SelectionHighlight({ op }: { op: SelectionOp }) {
  scrollTick.value; // subscribe so highlights track host-page scroll
  hostMutationTick.value; // re-resolve anchor on SPA route / DOM reflow
  const resolved = op.status === 'resolved';
  const highlightAlpha = resolved ? 0.1 : 0.25;
  // Re-anchor against the captured element's CURRENT top-left when possible.
  // The offset was recorded relative to the first rect at capture time, so
  // shifting every rect by the same delta keeps the multi-rect highlight
  // shape coherent.
  const firstRect = op.rects[0];
  const { dx, dy, strategy } = firstRect
    ? applyAnchorDelta(op.target, { docX: firstRect.x, docY: firstRect.y })
    : { dx: 0, dy: 0, strategy: null };

  return (
    <>
      {op.rects.map((r, i) => (
        <div
          key={`${op.id}-${i}`}
          class="absolute pointer-events-none"
          style={{
            left: r.x + dx - scrollX,
            top: r.y + dy - scrollY,
            width: r.width,
            height: r.height,
            background: resolved
              ? 'color-mix(in oklch, var(--color-ml-resolved) 10%, transparent)'
              : hexToRgba(op.color, highlightAlpha),
            borderRadius: 2,
            mixBlendMode: 'multiply',
          }}
        />
      ))}
      <div
        class="absolute pointer-events-auto group/sel"
        style={{
          left: op.rects[0].x + dx - scrollX - 4,
          top: op.rects[0].y + dy - scrollY - 4,
          width: 8,
          height: 8,
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
        <div class="w-2 h-2 rounded-full" style={{ background: resolved ? 'var(--color-ml-resolved)' : op.color }} />
        {/* Hover card */}
        <div
          class={cn(
            'absolute left-3 top-0 hidden group-hover/sel:block z-10 w-[220px]',
            glass.surfaceSmall,
            glass.font,
            'p-3',
          )}
        >
          <p class="text-[11.5px] text-ml-glass-fg/65 m-0 mb-1 italic line-clamp-2">"{op.text}"</p>
          {op.comment && (
            <p
              class="text-[12.5px] text-ml-glass-fg/85 m-0 leading-relaxed whitespace-pre-wrap"
              style={{ textDecoration: resolved ? 'line-through' : 'none', opacity: resolved ? 0.5 : 1 }}
            >
              {op.comment}
            </p>
          )}
          <div class="flex items-center justify-between mt-2">
            <span class="text-[10px] text-ml-glass-fg/55 font-medium">{op.author}</span>
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
    </>
  );
}

function SelectionPopover({ x, y, text, rects, target, onClose }: PopoverState & { onClose: () => void }) {
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    taRef.current?.focus();
  }, []);

  const commit = (save: boolean) => {
    const comment = taRef.current?.value.trim();
    if (save && rects.length > 0) {
      const op: SelectionOp = {
        id: nanoid(),
        tool: 'selection',
        text,
        rects,
        comment: comment || undefined,
        color: color.value,
        lineWidth: lineWidth.value,
        ts: Date.now(),
        author: localUser.name,
        target,
        captureViewport: { width: window.innerWidth, height: window.innerHeight },
      };
      pushOp(op);
    }
    window.getSelection()?.removeAllRanges();
    onClose();
  };

  const vx = x - scrollX;
  const vy = y - scrollY;
  const left = Math.min(vx + 16, innerWidth - 300);
  const top = vy + 24 > innerHeight - 200 ? Math.max(4, vy - 200) : vy + 16;

  return (
    <div
      class={cn(
        'fixed z-2147483647 pointer-events-auto',
        'animate-[fadeInDown_180ms_cubic-bezier(0.16,1,0.3,1)]',
        glass.surface,
        glass.font,
        'overflow-hidden w-[290px]',
      )}
      style={{ left: Math.max(4, left), top }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Selected text preview */}
      <div class="px-4 pt-3.5 pb-2">
        <span class="text-[10.5px] text-ml-glass-fg/65 font-bold uppercase tracking-[0.08em]">Selected text</span>
        <p class="text-[12.5px] text-ml-glass-fg/80 m-0 mt-1 italic line-clamp-3 leading-relaxed">"{text}"</p>
      </div>

      <div class={cn(glass.divider, 'mx-3.5')} />

      {/* Optional comment */}
      <div class="p-3.5">
        <textarea
          ref={taRef}
          placeholder="Add a comment (optional)…"
          rows={1}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              commit(true);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              commit(false);
            }
          }}
          class={cn(textareaCls, 'w-full min-h-10 max-h-[140px]', glass.font)}
          style={{ fieldSizing: 'content', boxSizing: 'border-box' }}
        />
      </div>

      <div class={cn(glass.divider, 'mx-3.5')} />

      {/* Footer */}
      <div class="flex items-center justify-between px-4 py-2.5">
        <div class="flex items-center gap-2">
          <kbd
            class="text-[10.5px] text-ml-glass-fg/75 bg-ml-glass-fg/8 border border-ml-glass-fg/15
                      rounded-md px-1.5 py-0.5 font-mono font-medium leading-none"
          >
            Esc
          </kbd>
          <span class="text-[11px] text-ml-glass-fg/55 font-medium">skip comment</span>
        </div>
        <button type="button" onClick={() => commit(true)} class={submitBtn}>
          Save ↵
        </button>
      </div>
    </div>
  );
}

export function SelectionLayer() {
  const [popover, setPopover] = useState<PopoverState | null>(null);

  // Highlight repositioning on scroll happens inside SelectionHighlight via
  // the shared `scrollTick` signal — no per-layer forceUpdate needed.

  // Listen for text selection — always attached, check signal inside handler
  const onMouseUp = useCallback(() => {
    if (activeTool.value !== 'selection') return;
    requestAnimationFrame(() => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.toString().trim()) return;

      const text = sel.toString();
      const rects: SelectionRect[] = [];

      for (let i = 0; i < sel.rangeCount; i++) {
        const range = sel.getRangeAt(i);
        const clientRects = range.getClientRects();
        for (const cr of clientRects) {
          rects.push({
            x: cr.x + scrollX,
            y: cr.y + scrollY,
            width: cr.width,
            height: cr.height,
          });
        }
      }

      if (rects.length === 0) return;

      // Snapshot the enclosing element now — once the popover textarea takes
      // focus the user's selection collapses and we lose this context.
      const range0 = sel.getRangeAt(0);
      const ancestor = range0.commonAncestorContainer;
      const targetEl: Element | null =
        ancestor.nodeType === Node.ELEMENT_NODE ? (ancestor as Element) : ancestor.parentElement;

      const firstRect = rects[0];
      const lastRect = rects[rects.length - 1];
      setPopover({
        x: lastRect.x + lastRect.width,
        y: lastRect.y + lastRect.height,
        text,
        rects,
        target: targetEl ? captureTarget(targetEl, { x: firstRect.x, y: firstRect.y }) : undefined,
      });
    });
  }, []);

  useEffect(() => {
    window.addEventListener('mouseup', onMouseUp);
    return () => window.removeEventListener('mouseup', onMouseUp);
  }, [onMouseUp]);

  return (
    <div
      class="fixed inset-0 z-2147483646 pointer-events-none
             font-[-apple-system,BlinkMacSystemFont,'Geist',system-ui,sans-serif]"
    >
      {/* Existing selection highlights */}
      {selections.value.map((s) => (
        <SelectionHighlight key={s.id} op={s} />
      ))}

      {/* Popover for new selection */}
      {popover && <SelectionPopover {...popover} onClose={() => setPopover(null)} />}
    </div>
  );
}
