import { cn } from '@marklayer/ui/cn';
import { useSignal, useSignalEffect } from '@preact/signals';
import type { TargetedEvent } from 'preact';
import { useCallback, useRef } from 'preact/hooks';
import { submitBtn, textareaCls } from '../lib/buttons';
import { geist } from '../lib/geist';
import { glass } from '../lib/glass';
import { boundsOf, marqueeBox, useMultiSelect } from '../lib/multi-select';
import { isExtensionElement, pickElementAtPoint } from '../lib/selector';
import { activeTool } from '../lib/tool-state';
import { CancelButton } from './CancelButton';

export function SelectedOutline({ rect }: { rect: DOMRect }) {
  return (
    <div
      class="fixed pointer-events-none rounded-sm
             animate-[fadeIn_140ms_ease-out]"
      style={{
        left: rect.left - 2,
        top: rect.top - 2,
        width: rect.width + 4,
        height: rect.height + 4,
        background: 'color-mix(in oklch, var(--ds-green-700) 12%, transparent)',
        boxShadow:
          '0 0 0 1.5px var(--ds-green-700), 0 0 0 4px color-mix(in oklch, var(--ds-green-700) 18%, transparent), 0 0 18px color-mix(in oklch, var(--ds-green-700) 22%, transparent)',
      }}
    />
  );
}

export function MarqueeBox({ box }: { box: { left: number; top: number; width: number; height: number } }) {
  return (
    <div
      class="fixed z-2147483646 pointer-events-none rounded-[3px]"
      style={{
        left: box.left,
        top: box.top,
        width: box.width,
        height: box.height,
        background: 'color-mix(in oklch, var(--ds-green-700) 8%, transparent)',
        boxShadow: '0 0 0 1.5px color-mix(in oklab, var(--ds-green-700) 90%, transparent)',
      }}
    />
  );
}

export function MultiSelectPopover({
  count,
  rect,
  onCommit,
  onCancel,
}: {
  count: number;
  /** Anchor rect (the marquee, in viewport coords) to position the popover near. */
  rect: { left: number; top: number; right: number; bottom: number } | null;
  onCommit: (comment: string) => void;
  onCancel: () => void;
}) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const setTaRef = useCallback((el: HTMLTextAreaElement | null) => {
    taRef.current = el;
    el?.focus();
  }, []);

  const panelW = 300;
  const margin = 12;
  const cx = rect ? (rect.left + rect.right) / 2 : innerWidth / 2;
  const left = Math.max(margin, Math.min(cx - panelW / 2, innerWidth - panelW - margin));
  const top = rect
    ? Math.max(margin, Math.min(rect.bottom + 16, innerHeight - 200 - margin))
    : Math.max(margin, innerHeight / 2 - 80);

  return (
    <div
      class={cn(
        'fixed z-2147483647 pointer-events-auto w-[300px] flex flex-col overflow-hidden',
        'animate-[fadeInDown_180ms_cubic-bezier(0.16,1,0.3,1)]',
        geist.surface,
        glass.font,
      )}
      style={{ left, top }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div class="px-4 pt-3.5 pb-1.5 flex items-center justify-between">
        <span class={geist.sectionLabel}>
          {count} element{count === 1 ? '' : 's'} selected
        </span>
        <span
          class="inline-flex items-center justify-center w-2 h-2 rounded-full"
          style={{
            background: 'var(--ds-green-700)',
            boxShadow: '0 0 0 3px color-mix(in oklch, var(--ds-green-700) 22%, transparent)',
          }}
          role="img"
          aria-label="Multi-select active"
          title="Multi-select active — your note will apply to every highlighted element."
        />
      </div>

      <div class="px-3.5 pb-2.5">
        <textarea
          ref={setTaRef}
          placeholder="What should change across these elements?"
          rows={2}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              onCommit(taRef.current?.value.trim() ?? '');
            } else if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              onCancel();
            }
          }}
          class={cn(textareaCls, 'w-full min-h-10 max-h-[120px]', glass.font)}
          style={{ fieldSizing: 'content', boxSizing: 'border-box' }}
        />
      </div>

      <div class={cn(geist.divider, 'mx-3.5')} />

      <div class="flex items-center justify-between gap-2 px-4 py-2.5">
        <CancelButton onClick={onCancel} />
        <button type="button" onClick={() => onCommit(taRef.current?.value.trim() ?? '')} class={submitBtn}>
          Add ↵
        </button>
      </div>
    </div>
  );
}

export function MultiInspectLayer() {
  const { drag, selected, press, moveTo, release, submit, cancel } = useMultiSelect({ skip: isExtensionElement });
  /** Bumped on scroll/resize so outlines reposition with the page. */
  const tick = useSignal(0);

  useSignalEffect(() => {
    if (activeTool.value !== 'multiInspect') return;
    const onScroll = () => {
      tick.value++;
    };
    window.addEventListener('scroll', onScroll, { passive: true, capture: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  });

  useSignalEffect(() => {
    if (activeTool.value !== 'multiInspect') return;
    document.body.style.cursor = 'crosshair';
    return () => {
      document.body.style.cursor = '';
    };
  });

  const onPointerDown = (e: TargetedEvent<HTMLDivElement, PointerEvent>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    press({ x: e.clientX, y: e.clientY, el: pickElementAtPoint(e.clientX, e.clientY) });
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: TargetedEvent<HTMLDivElement, PointerEvent>) => moveTo(e.clientX, e.clientY);

  const onPointerUp = (e: TargetedEvent<HTMLDivElement, PointerEvent>) => {
    if (!drag.value) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    release(document);
  };

  if (activeTool.value !== 'multiInspect') return null;

  // Read tick so outlines reposition on scroll/resize.
  tick.value;
  const sel = selected.value;
  const d = drag.value;

  const marquee = d?.dragged ? marqueeBox(d) : null;

  const boundingRect = boundsOf(sel.filter(({ el }) => el.isConnected).map(({ el }) => el.getBoundingClientRect()));

  return (
    <>
      <div
        data-marklayer-inspect=""
        class="fixed inset-0 z-2147483645"
        style={{ cursor: 'crosshair', touchAction: 'none' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />

      {sel.map(({ el, selector }) =>
        el.isConnected ? <SelectedOutline key={selector} rect={el.getBoundingClientRect()} /> : null,
      )}

      {marquee && <MarqueeBox box={marquee} />}

      {sel.length > 0 && !d && (
        <MultiSelectPopover count={sel.length} rect={boundingRect} onCommit={submit} onCancel={cancel} />
      )}
    </>
  );
}
