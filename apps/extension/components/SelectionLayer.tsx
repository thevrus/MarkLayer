import { clsx } from 'clsx';
import { nanoid } from 'nanoid';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { glass } from '../lib/glass';
import { hexToRgba } from '../lib/renderer';
import { activeTool, color, lineWidth, localUser, pushOp, selections, setOpStatus } from '../lib/state';
import type { SelectionOp, SelectionRect } from '../lib/types';

interface PopoverState {
  x: number;
  y: number;
  text: string;
  rects: SelectionRect[];
}

function SelectionHighlight({ op }: { op: SelectionOp }) {
  const resolved = op.status === 'resolved';
  const highlightAlpha = resolved ? 0.1 : 0.25;

  return (
    <>
      {op.rects.map((r, i) => (
        <div
          key={`${op.id}-${i}`}
          class="absolute pointer-events-none"
          style={{
            left: r.x - scrollX,
            top: r.y - scrollY,
            width: r.width,
            height: r.height,
            background: resolved ? 'rgba(107,114,128,0.1)' : hexToRgba(op.color, highlightAlpha),
            borderRadius: 2,
            mixBlendMode: 'multiply',
          }}
        />
      ))}
      <div
        class="absolute pointer-events-auto group/sel"
        style={{
          left: op.rects[0].x - scrollX - 4,
          top: op.rects[0].y - scrollY - 4,
          width: 8,
          height: 8,
        }}
      >
        <div class="w-2 h-2 rounded-full" style={{ background: resolved ? '#6b7280' : op.color }} />
        {/* Hover card */}
        <div
          class={clsx(
            'absolute left-3 top-0 hidden group-hover/sel:block z-10 w-[220px]',
            glass.surfaceSmall,
            glass.font,
            'p-3',
          )}
        >
          <p class="text-[11px] text-ml-glass-fg/40 m-0 mb-1 italic line-clamp-2">"{op.text}"</p>
          {op.comment && (
            <p
              class="text-[12px] text-ml-glass-fg/70 m-0 leading-relaxed whitespace-pre-wrap"
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
    </>
  );
}

function SelectionPopover({ x, y, text, rects, onClose }: PopoverState & { onClose: () => void }) {
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    taRef.current?.focus();
  }, []);

  const commit = (save: boolean) => {
    const comment = taRef.current?.value.trim();
    if (save && rects.length > 0) {
      pushOp({
        id: nanoid(),
        tool: 'selection' as const,
        text,
        rects,
        comment: comment || undefined,
        color: color.value,
        lineWidth: lineWidth.value,
        ts: Date.now(),
        author: localUser.name,
      } as SelectionOp);
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
      class={clsx('fixed z-[2147483647] pointer-events-auto', glass.surface, glass.font, 'overflow-hidden w-[290px]')}
      style={{ left: Math.max(4, left), top }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Selected text preview */}
      <div class="px-4 pt-3.5 pb-2">
        <span class="text-[10px] text-ml-glass-fg/30 font-medium uppercase tracking-wider">Selected text</span>
        <p class="text-[12px] text-ml-glass-fg/50 m-0 mt-1 italic line-clamp-3 leading-relaxed">"{text}"</p>
      </div>

      <div class={clsx(glass.divider, 'mx-3.5')} />

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
          class={clsx(
            'w-full bg-ml-glass-accent/[0.04] border border-ml-glass-fg/[0.08] rounded-xl px-3.5 py-2.5',
            'text-ml-glass-fg/90 text-[13px] leading-relaxed',
            'resize-none outline-none min-h-10 max-h-[140px]',
            'caret-[oklch(0.65_0.15_300)]',
            'transition-all duration-150',
            'focus:border-[oklch(0.65_0.15_300/0.35)]',
            'focus:shadow-[0_0_0_3px_oklch(0.65_0.15_300/0.06),inset_0_0.5px_0_oklch(1_0_0/0.04)]',
            'focus:bg-ml-glass-accent/[0.06]',
            'placeholder:text-ml-glass-fg/18',
            glass.font,
          )}
          style={{ fieldSizing: 'content', boxSizing: 'border-box' } as Record<string, string>}
        />
      </div>

      <div class={clsx(glass.divider, 'mx-3.5')} />

      {/* Footer */}
      <div class="flex items-center justify-between px-4 py-2.5">
        <div class="flex items-center gap-2">
          <kbd
            class="text-[10px] text-ml-glass-fg/25 bg-ml-glass-accent/[0.05] border border-ml-glass-fg/[0.07]
                      rounded-md px-1.5 py-0.5 font-mono leading-none"
          >
            Esc
          </kbd>
          <span class="text-[10px] text-ml-glass-fg/20">skip comment</span>
        </div>
        <button
          type="button"
          onClick={() => commit(true)}
          class="px-4 py-1.5 text-[12px] font-semibold rounded-[10px] border-none cursor-pointer
                 bg-gradient-to-b from-[oklch(0.68_0.15_300)] to-[oklch(0.58_0.15_300)]
                 text-white
                 shadow-[inset_0_1px_0_oklch(1_0_0/0.15),0_1px_3px_oklch(0_0_0/0.2)]
                 transition-all duration-150
                 hover:from-[oklch(0.72_0.15_300)] hover:to-[oklch(0.62_0.15_300)]
                 hover:shadow-[inset_0_1px_0_oklch(1_0_0/0.2),0_2px_16px_oklch(0.65_0.15_300/0.2)]
                 active:scale-[0.96]"
        >
          Save ↵
        </button>
      </div>
    </div>
  );
}

export function SelectionLayer() {
  const [popover, setPopover] = useState<PopoverState | null>(null);
  const [, forceUpdate] = useState(0);

  // Reposition highlights on scroll
  useEffect(() => {
    const onScroll = () => forceUpdate((n) => n + 1);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

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

      const lastRect = rects[rects.length - 1];
      setPopover({
        x: lastRect.x + lastRect.width,
        y: lastRect.y + lastRect.height,
        text,
        rects,
      });
    });
  }, []);

  useEffect(() => {
    window.addEventListener('mouseup', onMouseUp);
    return () => window.removeEventListener('mouseup', onMouseUp);
  }, [onMouseUp]);

  return (
    <div
      class="fixed inset-0 z-[2147483646] pointer-events-none
             font-[-apple-system,BlinkMacSystemFont,'Inter',system-ui,sans-serif]"
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
