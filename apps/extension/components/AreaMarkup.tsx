import { cn } from '@marklayer/types';
import { type Signal, useSignal, useSignalEffect } from '@preact/signals';
import type { TargetedEvent } from 'preact';
import { useMemo, useRef } from 'preact/hooks';
import { track } from '../lib/analytics';
import { clampToRect, MARKUP_TOOLS, type MarkupTool, markupOp } from '../lib/area-markup';
import type { AreaRect } from '../lib/area-rect';
import { geist } from '../lib/geist';
import { Icon } from '../lib/icons';
import { capturePointer } from '../lib/pointer';
import { renderOp } from '../lib/renderer';
import { color, lineWidth, scrollTick } from '../lib/state';
import type { DrawOp, Point } from '../lib/types';
import { Tooltip } from './Tooltip';

interface Gesture {
  tool: MarkupTool;
  points: Point[];
  shift: boolean;
}

export interface AreaMarkupState {
  tool: Signal<MarkupTool | null>;
  ops: Signal<DrawOp[]>;
  live: Signal<DrawOp | null>;
  begin: (args: { tool: MarkupTool; at: Point; shift: boolean; rect: AreaRect }) => void;
  extend: (args: { at: Point; shift: boolean; rect: AreaRect }) => void;
  finish: () => void;
  /** Drops the stroke being drawn; false when there was none. */
  cancelStroke: () => boolean;
  undo: () => void;
  reset: () => void;
}

/** Markup for the pending area note only: nothing here is persisted or synced, `snapshotArea` burns it into the shot. */
export function useAreaMarkup(): AreaMarkupState {
  const tool = useSignal<MarkupTool | null>(null);
  const ops = useSignal<DrawOp[]>([]);
  const live = useSignal<DrawOp | null>(null);
  const gesture = useRef<Gesture | null>(null);

  return useMemo(() => {
    const style = () => ({ color: color.value, lineWidth: lineWidth.value });
    const preview = () => {
      const g = gesture.current;
      live.value = g
        ? markupOp({ tool: g.tool, points: g.points, shift: g.shift, style: style(), preview: true })
        : null;
    };
    return {
      tool,
      ops,
      live,
      begin: ({ tool: t, at, shift, rect }) => {
        gesture.current = { tool: t, points: [clampToRect({ p: at, r: rect })], shift };
      },
      extend: ({ at, shift, rect }) => {
        const g = gesture.current;
        if (!g) return;
        g.shift = shift;
        g.points.push(clampToRect({ p: at, r: rect }));
        preview();
      },
      finish: () => {
        const g = gesture.current;
        gesture.current = null;
        live.value = null;
        const op = g && markupOp({ tool: g.tool, points: g.points, shift: g.shift, style: style() });
        if (!op || !g) return;
        ops.value = [...ops.value, op];
        track('area_markup_stroke_added', { tool: g.tool, strokes: ops.value.length });
      },
      cancelStroke: () => {
        if (!gesture.current) return false;
        gesture.current = null;
        live.value = null;
        return true;
      },
      undo: () => {
        ops.value = ops.value.slice(0, -1);
        track('area_markup_undone');
      },
      reset: () => {
        gesture.current = null;
        live.value = null;
        ops.value = [];
        tool.value = null;
      },
    };
  }, [tool, ops, live]);
}

/** The area's pixels, transparent: a canvas the size of the rect that takes the pointer while a markup tool is armed. */
export function AreaMarkupSurface({ rect, markup }: { rect: AreaRect; markup: AreaMarkupState }) {
  scrollTick.value; // reposition when the window scrolls
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const armed = markup.tool.value;

  useSignalEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(rect.w * dpr);
    const h = Math.round(rect.h * dpr);
    // Resizing reallocates the backing store, so only on a real change; per pointermove a clear is enough.
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const live = markup.live.value;
    for (const op of markup.ops.value) renderOp(ctx, op, rect.x, rect.y);
    if (live) renderOp(ctx, live, rect.x, rect.y);
  });

  const at = (e: TargetedEvent<HTMLCanvasElement, PointerEvent>): Point => ({
    x: e.clientX + scrollX,
    y: e.clientY + scrollY,
  });

  return (
    <canvas
      ref={canvasRef}
      class="absolute rounded-[3px]"
      style={{
        left: rect.x - scrollX,
        top: rect.y - scrollY,
        width: rect.w,
        height: rect.h,
        pointerEvents: armed ? 'auto' : 'none',
        cursor: 'crosshair',
        touchAction: 'none',
      }}
      onPointerDown={(e) => {
        if (!armed || e.button !== 0) return;
        e.stopPropagation();
        capturePointer({ target: e.currentTarget, pointerId: e.pointerId });
        markup.begin({ tool: armed, at: at(e), shift: e.shiftKey, rect });
      }}
      onPointerMove={(e) => markup.extend({ at: at(e), shift: e.shiftKey, rect })}
      onPointerUp={(e) => {
        e.currentTarget.releasePointerCapture(e.pointerId);
        markup.extend({ at: at(e), shift: e.shiftKey, rect });
        markup.finish();
      }}
      onPointerCancel={() => markup.cancelStroke()}
    />
  );
}

/** Bare icons, tonal when armed; picking the armed one again hands the pointer back to the page. */
export function MarkupTools({ markup }: { markup: AreaMarkupState }) {
  const canUndo = markup.ops.value.length > 0;
  return (
    <div class="flex items-center gap-0.5 -ml-1.5" role="toolbar" aria-label="Markup">
      {MARKUP_TOOLS.map(({ tool, label, icon }) => {
        const on = markup.tool.value === tool;
        return (
          <button
            key={tool}
            type="button"
            aria-label={label}
            aria-pressed={on}
            onClick={() => {
              markup.tool.value = on ? null : tool;
            }}
            class={cn(geist.ctlSm, on ? 'bg-(--ds-gray-alpha-200) text-(--ds-gray-1000)' : geist.ctlIdle)}
          >
            <Icon name={icon} size={16} strokeWidth={1.5} />
            <Tooltip text={label} placement="bottom" />
          </button>
        );
      })}
      <button
        type="button"
        aria-label="Undo markup"
        disabled={!canUndo}
        onClick={markup.undo}
        class={cn(geist.ctlSm, geist.ctlIdle, 'ml-auto disabled:opacity-40 disabled:pointer-events-none')}
      >
        <Icon name="undo" size={16} strokeWidth={1.5} />
        <Tooltip text="Undo" shortcut="⌘Z" placement="bottom" />
      </button>
    </div>
  );
}
