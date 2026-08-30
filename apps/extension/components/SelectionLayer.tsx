import { type CommentPriority, cn, normalizeSuggestion, type TargetElement } from '@marklayer/types';
import { nanoid } from 'nanoid';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { reprojectRects } from '../lib/anchor';
import { submitBtn, textareaCls } from '../lib/buttons';
import { geist } from '../lib/geist';
import { glass } from '../lib/glass';
import { useEdgeClamp, useSelectionDismiss } from '../lib/popover';
import { hexToRgba } from '../lib/renderer';
import { captureTarget, isExtensionElement } from '../lib/selector';
import {
  activeTool,
  color,
  copyText,
  deleteOp,
  getCommentStatus,
  getReplies,
  hostMutationTick,
  lineWidth,
  localUser,
  openContextMenu,
  pushOp,
  STATUS_STYLES,
  scrollTick,
  selectionCaptureArmed,
  selections,
  setOpStatus,
} from '../lib/state';
import type { SelectionOp, SelectionRect } from '../lib/types';
import { CancelButton } from './CancelButton';
import { TriageSection, useTriageHold } from './CommentTriage';
import { PriorityPicker } from './PriorityPicker';
import { SelectionEdit, SuggestionDiff } from './SelectionEdit';
import { ReplyComposer, ThreadHeader, ThreadReplies } from './ThreadCard';

interface PopoverState {
  x: number;
  y: number;
  text: string;
  rects: SelectionRect[];
  target: TargetElement | undefined;
  /** Opened by the selection alone rather than by arming the selection tool. */
  auto: boolean;
}

function SelectionHighlight({ op }: { op: SelectionOp }) {
  scrollTick.value; // subscribe so highlights track host-page scroll
  hostMutationTick.value; // re-resolve anchor on SPA route / DOM reflow
  const status = getCommentStatus(op);
  const resolved = status === 'resolved' || status === 'dismissed';
  const triage = useTriageHold();
  // Re-anchor against the captured element's CURRENT top-left when possible.
  // The offset was recorded relative to the first rect at capture time, so
  // shifting every rect by the same delta — and scaling each rect's offset
  // from the first rect plus its own size by the element's current/captured
  // size ratio — keeps the multi-rect highlight shape coherent as the
  // element reflows, with the first rect landing exactly on the anchor.
  const anchored = reprojectRects({ target: op.target, rects: op.rects });
  if (!anchored) return null;
  const { x: anchorX, y: anchorY, rects, strategy } = anchored;

  // Parked in the margin beside the first line, not on the corner of it: a disc
  // centred on the anchor sits on the selection's own first letter, which is the
  // one character the quote can least afford to lose.
  const firstRect = rects[0];
  const markerX = Math.max(2, anchorX - scrollX - 22);
  const markerY = anchorY - scrollY + (firstRect ? firstRect.height / 2 - 8 : -8);
  const flipH = markerX + 340 > window.innerWidth;
  const flipV = markerY > window.innerHeight / 2;
  // Replies hang off the selection's stored anchor, not the reprojected one.
  const replyAnchor = op.rects[0];

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
              : hexToRgba(op.color, 0.25),
            borderRadius: 2,
            mixBlendMode: 'multiply',
          }}
        />
      ))}
      {/* The marker is the only interactive part: the highlight itself stays
          pointer-transparent so an annotated paragraph on someone else's page
          keeps its own links and text selection. */}
      <div
        class={cn('absolute pointer-events-auto group/sel', triage.rootCls)}
        style={{ left: markerX, top: markerY }}
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
        <div
          // Same treatment as a comment pin, at the size a word can carry: one
          // flat fill, a surface ring to lift it off whatever is behind, and a
          // ring that thickens on hover rather than a dot that grows.
          class="w-4 h-4 rounded-full cursor-pointer
                 shadow-[0_0_0_2px_var(--ds-background-100),0_1px_2px_oklch(0_0_0/0.25)]
                 transition-[box-shadow] duration-150 ease-out
                 group-hover/sel:shadow-[0_0_0_3px_var(--ds-background-100),0_1px_2px_oklch(0_0_0/0.3)]"
          style={{
            background: status === 'open' ? op.color : STATUS_STYLES[status].bg,
            opacity: STATUS_STYLES[status].pinOpacity,
          }}
          role="img"
          aria-label={`Selection by ${op.author || 'Anonymous'}`}
        />

        {/* The marker-to-card gap is padding on this wrapper, not an offset — as
            dead space it drops :hover mid-crossing and the card goes before the
            pointer reaches the reply box. */}
        <div
          class={cn(
            'absolute',
            flipV ? 'bottom-0' : 'top-0',
            flipH ? 'right-full pr-2.5' : 'left-full pl-2.5',
            'pointer-events-none group-hover/sel:pointer-events-auto',
            triage.wrapCls,
          )}
        >
          <div
            class={cn(
              geist.surfaceSmall,
              glass.font,
              'w-[300px] max-h-[50vh] overflow-y-auto overscroll-contain',
              'opacity-0',
              flipH ? 'translate-x-[6px]' : 'translate-x-[-6px]',
              'transition-[opacity,translate] duration-150 ease-out',
              'group-hover/sel:opacity-100 group-hover/sel:translate-x-0',
              triage.cardCls,
            )}
            onClick={(e) => e.stopPropagation()}
          >
            <ThreadHeader
              label={(op.author || '?').charAt(0).toUpperCase()}
              color={op.color}
              author={op.author}
              ts={op.ts}
              priority={op.priority}
            />

            <div class={cn(geist.divider, 'mx-3')} />

            <div class="px-3.5 py-3">
              {op.suggestion ? (
                <SuggestionDiff text={op.text} suggestion={op.suggestion} resolved={resolved} />
              ) : (
                <p class="text-meta text-(--ds-gray-900) m-0 line-clamp-3 leading-relaxed">"{op.text}"</p>
              )}
              {op.comment && (
                <p
                  class="text-ui text-(--ds-gray-1000) m-0 mt-2 leading-body wrap-break-word whitespace-pre-wrap"
                  style={{ textDecoration: resolved ? 'line-through' : 'none', opacity: resolved ? 0.55 : 1 }}
                >
                  {op.comment}
                </p>
              )}
            </div>

            <ThreadReplies replies={getReplies(op.id)} />

            <div class={cn(geist.divider, 'mx-3')} />

            <TriageSection
              opId={op.id}
              status={status}
              assignee={op.assignee ?? null}
              onOpenChange={triage.onOpenChange}
            />

            <div class={cn(geist.divider, 'mx-3')} />

            {replyAnchor && <ReplyComposer parent={{ id: op.id, x: replyAnchor.x, y: replyAnchor.y }} />}
          </div>
        </div>
      </div>
    </>
  );
}

function SelectionPopover({ x, y, text, rects, target, auto, onClose }: PopoverState & { onClose: () => void }) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [priority, setPriority] = useState<CommentPriority | undefined>(undefined);
  const [suggestion, setSuggestion] = useState<string | null>(null);

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

  const { panelProps } = useSelectionDismiss({ auto, focusRef: taRef, onDismiss: () => commit(false) });

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
      {...panelProps}
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
        <CancelButton onClick={() => commit(false)} />
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

  // Listen for text selection — always attached, check signal inside handler.
  // Every selection tool qualifies, not just `selection`, so highlighting a
  // sentence offers to annotate it without a trip to the toolbar first.
  const onMouseUp = useCallback((e: MouseEvent) => {
    if (!selectionCaptureArmed.value) return;
    // Retargeted to the shadow host for anything inside our own UI, so this also
    // covers a mouseup that finished inside this very popover.
    if (e.target instanceof Element && isExtensionElement(e.target)) return;
    // The common case is a plain click, so answer it before scheduling a frame:
    // only a live selection needs the post-layout rects the rAF waits for.
    if (window.getSelection()?.isCollapsed !== false) return;
    const auto = activeTool.value !== 'selection';
    requestAnimationFrame(() => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) return;

      const text = sel.toString();
      if (!text.trim()) return;
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
      // A selection that lives in our own chrome — an annotation's hover card, the
      // toolbar — is not page copy, whatever the mouseup landed on.
      if (isExtensionElement(targetEl)) return;

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
        auto,
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
