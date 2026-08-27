import { type CommentPriority, cn, normalizeSuggestion, type TargetElement } from '@marklayer/types';
import { nanoid } from 'nanoid';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { reprojectRects } from '../lib/anchor';
import { submitBtn, textareaCls } from '../lib/buttons';
import { geist } from '../lib/geist';
import { glass } from '../lib/glass';
import { useEdgeClamp } from '../lib/popover';
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
import { PriorityBadge, PriorityPicker } from './PriorityPicker';
import { SelectionEdit, SuggestionDiff } from './SelectionEdit';

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
  // shifting every rect by the same delta — and scaling each rect's offset
  // from the first rect plus its own size by the element's current/captured
  // size ratio — keeps the multi-rect highlight shape coherent as the
  // element reflows, with the first rect landing exactly on the anchor.
  const anchored = reprojectRects({ target: op.target, rects: op.rects });
  if (!anchored) return null;
  const { x: anchorX, y: anchorY, rects, strategy } = anchored;

  return (
    <>
      {rects.map((r, i) => (
        <div
          key={`${op.id}-${i}`}
          class="absolute pointer-events-none"
          style={{
            left: r.x - scrollX,
            top: r.y - scrollY,
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
          left: anchorX - scrollX - 4,
          top: anchorY - scrollY - 4,
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
            <p class="text-[12px] text-(--ds-gray-900) m-0 mb-1 line-clamp-2">{op.text}</p>
          )}
          {op.comment && (
            <p
              class="text-[13px] text-(--ds-gray-1000) m-0 leading-relaxed whitespace-pre-wrap"
              style={{ textDecoration: resolved ? 'line-through' : 'none', opacity: resolved ? 0.5 : 1 }}
            >
              {op.comment}
            </p>
          )}
          <div class="flex items-center justify-between mt-2">
            <span class="text-[12px] text-(--ds-gray-900) font-medium">{op.author}</span>
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
    </>
  );
}

function SelectionPopover({ x, y, text, rects, target, onClose }: PopoverState & { onClose: () => void }) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [priority, setPriority] = useState<CommentPriority | undefined>(undefined);
  const [suggestion, setSuggestion] = useState<string | null>(null);

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
        suggestion: normalizeSuggestion({ text, suggestion }),
        priority,
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
  const { ref: panelRef, top } = useEdgeClamp({ top: vy + 16 });

  return (
    <div
      class={cn(
        'fixed z-2147483647 pointer-events-auto',
        'animate-[fadeInDown_180ms_cubic-bezier(0.16,1,0.3,1)]',
        geist.surface,
        glass.font,
        'overflow-hidden w-[290px]',
      )}
      ref={panelRef}
      style={{ left: Math.max(4, left), top }}
      onClick={(e) => e.stopPropagation()}
    >
      <SelectionEdit text={text} suggestion={suggestion} onChange={setSuggestion} onSubmit={() => commit(true)} />

      <div class={cn(geist.divider, 'mx-3.5')} />

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
        <PriorityPicker value={priority} onChange={setPriority} class="mt-1.5 -ml-1.5" />
      </div>

      <div class={cn(geist.divider, 'mx-3.5')} />

      {/* Footer */}
      <div class="flex items-center justify-between px-4 py-2.5">
        <div class="flex items-center gap-2">
          <kbd class={geist.kbd}>Esc</kbd>
          <span class="text-[12px] text-(--ds-gray-900) font-medium">skip comment</span>
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
      if (!firstRect || !lastRect) return;
      setPopover({
        x: lastRect.x + lastRect.width,
        y: lastRect.y + lastRect.height,
        text,
        rects,
        target: targetEl
          ? captureTarget({ el: targetEl, anchor: { x: firstRect.x, y: firstRect.y }, selectedText: text })
          : undefined,
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
