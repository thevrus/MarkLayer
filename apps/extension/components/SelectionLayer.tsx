import { isClosed, type TargetElement } from '@marklayer/types/ops';
import { cn } from '@marklayer/ui/cn';
import { useCallback, useEffect, useState } from 'preact/hooks';
import { track } from '../lib/analytics';
import { reprojectRects } from '../lib/anchor';
import { CardHold, useHoldLatch } from '../lib/card-hold';
import { geist } from '../lib/geist';
import { hostMutationTick, scrollTick } from '../lib/host-mutations';
import { useMarkHover } from '../lib/mark-hover';
import { deleteOp, pushOp, selections } from '../lib/ops';
import { MARKER_LAYER } from '../lib/popover';
import { hexToRgba } from '../lib/renderer';
import { toClient } from '../lib/scroller';
import { useSelectionCapture } from '../lib/selection-capture';
import { captureTarget, isExtensionElement } from '../lib/selector';
import { fileUrl, uploadFile } from '../lib/share';
import { getCommentStatus } from '../lib/status-ui';
import { isTextEditing, startTextEdit } from '../lib/text-edit';
import { activeTool, selectionCaptureArmed } from '../lib/tool-state';
import { toolEditsText } from '../lib/tools';
import type { SelectionOp, SelectionRect } from '../lib/types';
import { BatchSwitch } from './BatchSwitch';
import { MentionText } from './MentionText';
import { SelectionComposer } from './SelectionComposer';
import { SelectionMarker } from './SelectionMarker';

interface PopoverState {
  x: number;
  y: number;
  text: string;
  rects: SelectionRect[];
  target: TargetElement | undefined;
  /** Opened by the selection alone rather than by arming the selection tool. */
  auto: boolean;
  /** Pre-filled replacement, set when the text was edited in place. */
  suggestion?: string;
}

function SelectionHighlight({ op }: { op: SelectionOp }) {
  scrollTick.value; // subscribe so highlights track host-page scroll
  hostMutationTick.value; // re-resolve anchor on SPA route / DOM reflow
  const status = getCommentStatus(op);
  const resolved = isClosed(status);
  const hold = useHoldLatch();
  // Re-anchor against the captured element's CURRENT top-left when possible.
  // The offset was recorded relative to the first rect at capture time, so
  // shifting every rect by the same delta — and scaling each rect's offset
  // from the first rect plus its own size by the element's current/captured
  // size ratio — keeps the multi-rect highlight shape coherent as the
  // element reflows, with the first rect landing exactly on the anchor.
  const anchored = reprojectRects({ target: op.target, rects: op.rects });
  const peek = useMarkHover(anchored?.rects.map((r) => ({ ...r, ...toClient(r) })) ?? []);
  const lift = hold.held || peek;
  if (!anchored) return null;
  const { x: anchorX, y: anchorY, rects, strategy } = anchored;

  // Parked in the margin beside the first line, not on the corner of it: a disc
  // centred on the anchor sits on the selection's own first letter, which is the
  // one character the quote can least afford to lose.
  const firstRect = rects[0];
  const anchorClient = toClient({ x: anchorX, y: anchorY });
  const markerX = Math.max(2, anchorClient.x - 22);
  const markerY = anchorClient.y + (firstRect ? firstRect.height / 2 - 8 : -8);
  const flipH = markerX + 340 > window.innerWidth;
  const flipV = markerY > window.innerHeight / 2;

  return (
    <CardHold value={hold.report}>
      {rects.map((r, i) => (
        <div
          key={`${op.id}-${i}`}
          class="absolute pointer-events-none"
          style={{
            left: toClient(r).x,
            top: toClient(r).y,
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
      <SelectionMarker
        op={op}
        status={status}
        x={markerX}
        y={markerY}
        flipH={flipH}
        flipV={flipV}
        lift={lift}
        drifted={strategy === 'text'}
        cardClass={cn(geist.surfaceSmall, 'max-h-[50vh]')}
        onDelete={() => deleteOp(op.id)}
        upload={uploadFile}
        resolveUrl={fileUrl}
      >
        {op.comment && <MentionText text={op.comment} mentions={op.mentions} />}
      </SelectionMarker>
    </CardHold>
  );
}

function SelectionPopover({ x, y, ...draft }: PopoverState & { onClose: () => void }) {
  return (
    <SelectionComposer
      {...draft}
      class="pointer-events-auto"
      anchor={() => toClient({ x, y })}
      captureViewport={() => ({ width: window.innerWidth, height: window.innerHeight })}
      push={pushOp}
      fieldClass="max-h-[140px]"
    >
      <BatchSwitch />
    </SelectionComposer>
  );
}

/** The popover at the end of the selected text; null when there are no rects to place it by. */
function popoverAt({
  text,
  rects,
  el,
  auto,
  suggestion,
}: Omit<PopoverState, 'x' | 'y' | 'target'> & { el: Element | null }): PopoverState | null {
  const first = rects[0];
  const last = rects[rects.length - 1];
  if (!first || !last) return null;
  return {
    x: last.x + last.width,
    y: last.y + last.height,
    text,
    rects,
    target: el ? captureTarget({ el, anchor: { x: first.x, y: first.y }, selectedText: text }) : undefined,
    auto,
    suggestion,
  };
}

export function SelectionLayer() {
  const [popover, setPopover] = useState<PopoverState | null>(null);

  // Highlight repositioning on scroll happens inside SelectionHighlight via
  // the shared `scrollTick` signal — no per-layer forceUpdate needed.

  // Every selection tool qualifies, not just `selection`, so highlighting a
  // sentence offers to annotate it without a trip to the toolbar first.
  useSelectionCapture({
    // Retargeted to the shadow host for anything inside our own UI, so this also
    // covers a mouseup that finished inside this very popover.
    armed: (e) =>
      selectionCaptureArmed.value && !isTextEditing() && !(e.target instanceof Element && isExtensionElement(e.target)),
    onCapture: ({ text, rects, el }) => {
      // A selection that lives in our own chrome — an annotation's hover card, the
      // toolbar — is not page copy, whatever the mouseup landed on.
      if (isTextEditing() || isExtensionElement(el)) return;
      const next = popoverAt({ text, rects, el, auto: activeTool.value !== 'selection' });
      if (next) setPopover(next);
    },
  });

  // Double-click edits the text in place; the result opens the usual popover with
  // the replacement filled in, so nothing is posted until Save.
  const onDblClick = useCallback((e: MouseEvent) => {
    if (!selectionCaptureArmed.value || !toolEditsText(activeTool.value)) return;
    const el = e.target instanceof Element ? e.target : null;
    if (!el || isExtensionElement(el)) return;
    startTextEdit({
      el,
      x: e.clientX,
      y: e.clientY,
      onDone: (r) => {
        if (r) track('selection_text_edited');
        const next =
          r && popoverAt({ text: r.text, rects: r.rects, el: r.target, auto: false, suggestion: r.suggestion });
        if (next) setPopover(next);
      },
    });
  }, []);

  useEffect(() => {
    window.addEventListener('dblclick', onDblClick, true);
    return () => window.removeEventListener('dblclick', onDblClick, true);
  }, [onDblClick]);

  return (
    <div class={cn(MARKER_LAYER, 'pointer-events-none')}>
      {/* Existing selection highlights */}
      {selections.value.map((s) => (
        <SelectionHighlight key={s.id} op={s} />
      ))}

      {/* Popover for new selection */}
      {popover && <SelectionPopover {...popover} onClose={() => setPopover(null)} />}
    </div>
  );
}
