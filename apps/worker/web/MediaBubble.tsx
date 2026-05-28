// Drag uses PointerEvents + setPointerCapture so events keep flowing when the
// cursor crosses the cross-origin proxied iframe (window-level mouse listeners
// silently stop firing there).

import { useEffect, useRef } from 'preact/hooks';

const MIN_SIZE = 56;
const MAX_SIZE = 320;
const TOPBAR_PAD = 56;
const EDGE_PAD = 8;

interface Position {
  x: number;
  y: number;
  size: number;
}

function storageKey(id: string) {
  return `ml-bubble-${id}`;
}

function readPosition(id: string, defaultSize: number): Position {
  try {
    const raw = localStorage.getItem(storageKey(id));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        typeof parsed.x === 'number' &&
        typeof parsed.y === 'number' &&
        typeof parsed.size === 'number'
      ) {
        return clampToViewport({ x: parsed.x, y: parsed.y, size: parsed.size });
      }
    }
  } catch {
    /* ignore */
  }
  const size = defaultSize;
  return { x: window.innerWidth - size - 16, y: window.innerHeight - size - 16, size };
}

function writePosition(id: string, pos: Position) {
  try {
    localStorage.setItem(storageKey(id), JSON.stringify(pos));
  } catch {
    /* quota / private mode */
  }
}

function clampToViewport(pos: Position): Position {
  const size = Math.max(MIN_SIZE, Math.min(MAX_SIZE, pos.size));
  return {
    size,
    x: Math.max(EDGE_PAD, Math.min(window.innerWidth - size - EDGE_PAD, pos.x)),
    y: Math.max(TOPBAR_PAD, Math.min(window.innerHeight - size - EDGE_PAD, pos.y)),
  };
}

interface Props {
  /** Stable identity used for position persistence. */
  id: string;
  stream: MediaStream | null;
  /** Mute self-view to avoid feedback (self bubble); leave undefined for peer audio handled elsewhere. */
  muted?: boolean;
  /** Mirror horizontally for the self-view (matches webcam intuition). */
  mirror?: boolean;
  /** Default size in px. */
  defaultSize?: number;
  /** Optional header chip rendered inside the bubble (e.g. peer name). */
  label?: string;
  /** Optional ring color for the bubble. */
  ringColor?: string;
  /** Optional close button — when provided, renders an "x" in the corner. */
  onClose?: () => void;
  /** Optional speaking indicator. */
  speaking?: boolean;
}

export function MediaBubble({
  id,
  stream,
  muted = false,
  mirror = false,
  defaultSize = 64,
  label,
  ringColor,
  onClose,
  speaking = false,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const posRef = useRef<Position>({ x: 0, y: 0, size: defaultSize });
  const dragRef = useRef<{
    mode: 'move' | 'resize' | null;
    pointerId: number;
    offsetX: number;
    offsetY: number;
    startSize: number;
    startCorner: { x: number; y: number };
  }>({ mode: null, pointerId: -1, offsetX: 0, offsetY: 0, startSize: defaultSize, startCorner: { x: 0, y: 0 } });

  useEffect(() => {
    const el = videoRef.current;
    if (el && stream) el.srcObject = stream;
    return () => {
      if (el) el.srcObject = null;
    };
  }, [stream]);

  useEffect(() => {
    posRef.current = readPosition(id, defaultSize);
    applyTransform();
    const onResize = () => {
      posRef.current = clampToViewport(posRef.current);
      applyTransform();
      writePosition(id, posRef.current);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
    // defaultSize is intentionally not a dep — re-running on a size change would clobber the saved position.
  }, [id]);

  function applyTransform() {
    const el = rootRef.current;
    const vid = videoRef.current;
    if (!el) return;
    const { x, y, size } = posRef.current;
    el.style.transform = `translate(${x}px,${y}px)`;
    el.style.width = `${size}px`;
    el.style.height = `${size}px`;
    if (vid) {
      vid.style.width = `${size}px`;
      vid.style.height = `${size}px`;
    }
  }

  function onPointerDown(e: PointerEvent) {
    const currentTarget = e.currentTarget;
    if (!(currentTarget instanceof HTMLElement)) return;
    if (e.button !== 0) return;
    // Use `e.target` (the deepest element receiving the event), not currentTarget,
    // so the role check survives event bubbling — the resize handle's pointerdown
    // bubbles through the root, and only the root carries this listener.
    const isResizeHandle = e.target instanceof Element && e.target.closest('[data-role="resize"]') !== null;
    currentTarget.setPointerCapture(e.pointerId);
    if (isResizeHandle) {
      dragRef.current = {
        mode: 'resize',
        pointerId: e.pointerId,
        offsetX: 0,
        offsetY: 0,
        startSize: posRef.current.size,
        startCorner: { x: e.clientX, y: e.clientY },
      };
    } else {
      dragRef.current = {
        mode: 'move',
        pointerId: e.pointerId,
        offsetX: e.clientX - posRef.current.x,
        offsetY: e.clientY - posRef.current.y,
        startSize: posRef.current.size,
        startCorner: { x: 0, y: 0 },
      };
    }
    e.preventDefault();
  }

  function onPointerMove(e: PointerEvent) {
    const d = dragRef.current;
    if (d.mode === null || e.pointerId !== d.pointerId) return;
    if (d.mode === 'move') {
      posRef.current = clampToViewport({
        size: posRef.current.size,
        x: e.clientX - d.offsetX,
        y: e.clientY - d.offsetY,
      });
    } else {
      const delta = Math.max(e.clientX - d.startCorner.x, e.clientY - d.startCorner.y);
      posRef.current = clampToViewport({
        x: posRef.current.x,
        y: posRef.current.y,
        size: d.startSize + delta,
      });
    }
    applyTransform();
  }

  function onPointerUp(e: PointerEvent) {
    const d = dragRef.current;
    if (d.mode === null || e.pointerId !== d.pointerId) return;
    dragRef.current.mode = null;
    writePosition(id, posRef.current);
  }

  function onWheel(e: WheelEvent) {
    // Plain wheel passes through to the page — avoids the trackpad-momentum-shrink trap.
    if (!e.metaKey && !e.ctrlKey) return;
    e.preventDefault();
    const prev = posRef.current.size;
    const next = Math.max(MIN_SIZE, Math.min(MAX_SIZE, prev - Math.sign(e.deltaY) * 12));
    if (next === prev) return;
    const dx = (next - prev) / 2;
    posRef.current = clampToViewport({
      size: next,
      x: posRef.current.x - dx,
      y: posRef.current.y - dx,
    });
    applyTransform();
    writePosition(id, posRef.current);
  }

  return (
    <div
      ref={rootRef}
      class="fixed top-0 left-0 z-2147483646 cursor-grab active:cursor-grabbing select-none will-change-transform animate-[fadeInDown_0.2s_ease-out]"
      style={{
        transform: 'translate(-9999px,-9999px)',
        width: defaultSize,
        height: defaultSize,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={onWheel}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={muted}
        class="rounded-full object-cover shadow-lg pointer-events-none"
        style={{
          width: defaultSize,
          height: defaultSize,
          transform: mirror ? 'scaleX(-1)' : undefined,
          boxShadow: speaking
            ? `0 0 0 3px ${ringColor ?? '#22c55e'}, 0 4px 14px oklch(0 0 0 / 0.25)`
            : `0 0 0 2px ${ringColor ?? 'rgba(255,255,255,0.2)'}, 0 4px 14px oklch(0 0 0 / 0.2)`,
        }}
      />

      {label && (
        <div
          class="absolute left-1/2 -translate-x-1/2 -bottom-1 text-[10px] font-semibold text-white px-2 py-0.5 rounded-full whitespace-nowrap pointer-events-none"
          style={{ background: ringColor ?? 'rgba(0,0,0,0.55)' }}
        >
          {label}
        </div>
      )}

      {onClose && (
        <button
          type="button"
          aria-label="Close"
          class="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-black/55 text-white grid place-items-center text-[11px] leading-none hover:bg-black/80 transition-colors"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onClose}
        >
          ×
        </button>
      )}

      <div
        data-role="resize"
        class="absolute bottom-0 right-0 w-3.5 h-3.5 cursor-nwse-resize rounded-br-full bg-white/0 hover:bg-white/20 transition-colors"
      />
    </div>
  );
}
