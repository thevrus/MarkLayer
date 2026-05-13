import { AreaPopover, type DraftAreaState, type DraftRect, rectFromDraft } from '@ext/components/AreaLayer';
import { constrainEnd, hexToRgba } from '@ext/lib/renderer';
import { captureTarget, pickElementAtPoint } from '@ext/lib/selector';
import { activeTool, color, lineWidth, localUser, pushOp } from '@ext/lib/state';
import type { AreaOp } from '@ext/lib/types';
import type { TargetElement } from '@marklayer/types';
import { useSignal, useSignalEffect } from '@preact/signals';
import { nanoid } from 'nanoid';
import { createPortal } from 'preact/compat';
import { useRef } from 'preact/hooks';
import { tinykeys } from 'tinykeys';
import { isElementNode, useIframeOverlay } from './iframeOverlay';
import { cssScale, iframeScrollY } from './signals';

export function WebAreaLayer({ frameRef }: { frameRef: { current: HTMLIFrameElement | null } }) {
  const draft = useSignal<DraftAreaState | null>(null);
  const pending = useSignal<DraftRect | null>(null);
  const winRef = useRef<Window | null>(null);
  const docRef = useRef<Document | null>(null);
  const lastRaw = useRef<{ x: number; y: number } | null>(null);
  const shiftHeld = useRef(false);

  const applyConstraint = () => {
    const d = draft.value;
    const raw = lastRaw.current;
    if (!d || !raw) return;
    const { x, y } = shiftHeld.current ? constrainEnd('rectangle', d.startDocX, d.startDocY, raw.x, raw.y) : raw;
    draft.value = { ...d, curDocX: x, curDocY: y };
  };

  useIframeOverlay(frameRef, ({ win, doc }) => {
    winRef.current = win;
    docRef.current = doc;

    const onPointerDown = (e: PointerEvent) => {
      if (activeTool.value !== 'area' || pending.value) return;
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const dx = e.clientX + win.scrollX;
      const dy = e.clientY + win.scrollY;
      lastRaw.current = { x: dx, y: dy };
      shiftHeld.current = e.shiftKey;
      draft.value = { startDocX: dx, startDocY: dy, curDocX: dx, curDocY: dy };
      const target = isElementNode(e.target) ? e.target : doc.documentElement;
      try {
        target.setPointerCapture?.(e.pointerId);
      } catch {
        /* capture is best-effort */
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      const d = draft.value;
      if (!d) return;
      e.preventDefault();
      lastRaw.current = { x: e.clientX + win.scrollX, y: e.clientY + win.scrollY };
      shiftHeld.current = e.shiftKey;
      applyConstraint();
    };

    const onPointerUp = (e: PointerEvent) => {
      const d = draft.value;
      if (!d) return;
      e.preventDefault();
      e.stopPropagation();
      shiftHeld.current = e.shiftKey;
      lastRaw.current = { x: e.clientX + win.scrollX, y: e.clientY + win.scrollY };
      const { x, y } = shiftHeld.current
        ? constrainEnd('rectangle', d.startDocX, d.startDocY, lastRaw.current.x, lastRaw.current.y)
        : lastRaw.current;
      const r = rectFromDraft({ ...d, curDocX: x, curDocY: y });
      draft.value = null;
      if (r.w < 6 || r.h < 6) return;
      pending.value = r;
    };

    // Suppress page click handlers (links, etc.) while drawing an area.
    const onClick = (e: MouseEvent) => {
      if (activeTool.value !== 'area') return;
      e.preventDefault();
      e.stopPropagation();
    };

    // Bind on both windows so focus on either side of the iframe boundary toggles the constraint.
    const setShift = (next: boolean) => {
      if (shiftHeld.current === next) return;
      shiftHeld.current = next;
      if (draft.value) applyConstraint();
    };
    const unbindShiftFrameDown = tinykeys(win, { Shift: () => setShift(true) });
    const unbindShiftFrameUp = tinykeys(win, { Shift: () => setShift(false) }, { event: 'keyup' });
    const unbindShiftHostDown = tinykeys(window, { Shift: () => setShift(true) });
    const unbindShiftHostUp = tinykeys(window, { Shift: () => setShift(false) }, { event: 'keyup' });

    win.addEventListener('pointerdown', onPointerDown, true);
    win.addEventListener('pointermove', onPointerMove, true);
    win.addEventListener('pointerup', onPointerUp, true);
    win.addEventListener('pointercancel', onPointerUp, true);
    win.addEventListener('click', onClick, true);
    return () => {
      try {
        win.removeEventListener('pointerdown', onPointerDown, true);
        win.removeEventListener('pointermove', onPointerMove, true);
        win.removeEventListener('pointerup', onPointerUp, true);
        win.removeEventListener('pointercancel', onPointerUp, true);
        win.removeEventListener('click', onClick, true);
      } catch {
        /* iframe may have navigated */
      }
      unbindShiftFrameDown();
      unbindShiftFrameUp();
      unbindShiftHostDown();
      unbindShiftHostUp();
    };
  });

  // Reset transient state when leaving the tool.
  useSignalEffect(() => {
    if (activeTool.value !== 'area') {
      draft.value = null;
      pending.value = null;
    }
  });

  // Crosshair cursor inside the iframe while area tool is active. Mirrors WebInspectorLayer.
  useSignalEffect(() => {
    if (activeTool.value !== 'area') return;
    const doc = frameRef.current?.contentDocument;
    if (!doc?.head) return;
    const style = doc.createElement('style');
    style.textContent = '*, *::before, *::after { cursor: crosshair !important; }';
    doc.head.appendChild(style);
    return () => style.remove();
  });

  // Subscribe to iframeScrollY so the preview repositions while the user holds-and-drags
  // past the iframe edge (autoscroll) or scrolls between draft start and commit.
  iframeScrollY.value;

  if (activeTool.value !== 'area') return null;

  const draftRect = draft.value ? rectFromDraft(draft.value) : pending.value;
  const frame = frameRef.current;

  const toHostViewport = (r: DraftRect | null) => {
    if (!r || !frame) return null;
    const fr = frame.getBoundingClientRect();
    const win = winRef.current;
    const sx = win?.scrollX ?? 0;
    const sy = win?.scrollY ?? iframeScrollY.value;
    const s = cssScale.value;
    return { x: fr.left + (r.x - sx) * s, y: fr.top + (r.y - sy) * s, w: r.w * s, h: r.h * s };
  };

  const hostRect = toHostViewport(draftRect);

  const commit = (comment: string) => {
    const r = pending.value;
    if (!r) return;
    const win = winRef.current;
    const doc = docRef.current;
    let target: TargetElement | undefined;
    if (win && doc) {
      const cx = r.x + r.w / 2 - win.scrollX;
      const cy = r.y + r.h / 2 - win.scrollY;
      const el = pickElementAtPoint(cx, cy, doc);
      if (el) target = captureTarget(el, { x: r.x, y: r.y });
    }
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
      target,
      captureViewport: win
        ? { width: win.innerWidth, height: win.innerHeight }
        : { width: window.innerWidth, height: window.innerHeight },
    };
    pushOp(op);
    pending.value = null;
  };

  const cancel = () => {
    pending.value = null;
  };

  return createPortal(
    <>
      {hostRect && (
        <div
          class="fixed pointer-events-none rounded-[3px] z-2147483646"
          style={{
            left: hostRect.x,
            top: hostRect.y,
            width: hostRect.w,
            height: hostRect.h,
            background: hexToRgba(color.value, 0.12),
            boxShadow: `inset 0 0 0 1.5px ${color.value}`,
          }}
        />
      )}
      {pending.value && hostRect && (
        <AreaPopover
          rect={{ x: hostRect.x, y: hostRect.y, w: hostRect.w, h: hostRect.h }}
          onCommit={commit}
          onCancel={cancel}
        />
      )}
    </>,
    document.body,
  );
}
