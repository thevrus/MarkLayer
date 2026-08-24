import { prefersReducedMotion } from '@ext/lib/media';
import { CURSOR_COLORS, localUser } from '@ext/lib/state';
import { useEffect, useRef } from 'preact/hooks';
import { CursorArrow } from './CursorArrow';
import { CursorLabel } from './CursorLabel';

interface FakeCursor {
  name: string;
  color: string;
  path: [number, number][];
  duration: number;
  delay: number;
}

/**
 * Paths are viewport percentages, and every one of them is kept clear of the
 * content column on purpose.
 *
 * They used to run straight through it — Yuki's path crossed 55%/65%, which put
 * a solid name tag on top of the hero's own copy, and Marcus sat at 25%/55%
 * over nothing at all. Three strangers' cursors colliding with the text read as
 * a rendering fault, not as a live room.
 *
 * The content column is 1120px centred, so on a wide screen the free space is
 * the outer margin. Every percentage below is hand-tuned to stay outside the
 * column's edge at common widths while still crossing enough distance to look
 * alive; on a narrow screen the whole layer is hidden (see FakeCursors) rather
 * than squeezed. Nothing enforces this — if the column width in Landing.tsx
 * changes, re-check these paths against it.
 */
const CURSORS: FakeCursor[] = [
  {
    name: 'Alice',
    color: '#3b82f6',
    path: [
      [86, 22],
      [90, 30],
      [84, 38],
      [88, 27],
      [86, 22],
    ],
    duration: 18,
    delay: 1,
  },
  {
    name: 'Marcus',
    color: '#f43f5e',
    path: [
      [8, 46],
      [13, 38],
      [6, 32],
      [11, 43],
      [8, 46],
    ],
    duration: 22,
    delay: 3,
  },
  {
    name: 'Yuki',
    color: '#8b5cf6',
    path: [
      [89, 62],
      [93, 54],
      [86, 58],
      [91, 68],
      [89, 62],
    ],
    duration: 20,
    delay: 2,
  },
];

/**
 * The visitor's own cursor (SelfCursor) draws from the same palette, so a demo
 * cursor that lands on their color swaps to a spare — two identically colored
 * cursors on one screen read as a bug, not a room.
 */
const DEMO_CURSORS: FakeCursor[] = (() => {
  const taken = new Set([localUser.color]);
  return CURSORS.map((c) => {
    const color = taken.has(c.color) ? (CURSOR_COLORS.find((s) => !taken.has(s)) ?? c.color) : c.color;
    taken.add(color);
    return { ...c, color };
  });
})();

function AnimatedCursor({ cursor }: { cursor: FakeCursor }) {
  const ref = useRef<HTMLDivElement>(null);
  /* These are WAAPI animations, so the stylesheet's reduced-motion block cannot
     reach them — it only clamps CSS animations. Without this check three
     cursors orbit forever for someone who asked the system for no motion, while
     every sibling animation here (Toolbar, SelfCursor, ChannelCycle) honours it.
     Calm renders them parked at their start positions rather than dropping them:
     a still room is still the product, an empty margin is not. */
  const calm = prefersReducedMotion();

  useEffect(() => {
    if (calm) return;
    const el = ref.current;
    if (!el) return;

    const appear = el.animate(
      [
        { opacity: 0, transform: 'scale(0.3)', filter: 'blur(4px)' },
        { opacity: 1, transform: 'scale(1)', filter: 'blur(0px)' },
      ],
      {
        duration: 600,
        delay: cursor.delay * 1000,
        easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
        fill: 'both',
      },
    );

    const keyframes = cursor.path.map(([x, y]) => ({
      left: `${x}%`,
      top: `${y}%`,
    }));

    const move = el.animate(keyframes, {
      duration: cursor.duration * 1000,
      delay: cursor.delay * 1000 + 600,
      iterations: Number.POSITIVE_INFINITY,
      easing: 'cubic-bezier(0.25, 0.1, 0.25, 1)',
      fill: 'both',
    });

    return () => {
      appear.cancel();
      move.cancel();
    };
  }, [cursor, calm]);

  const [startX, startY] = cursor.path[0];

  return (
    <div
      ref={ref}
      class="absolute pointer-events-none"
      style={{ left: `${startX}%`, top: `${startY}%`, opacity: calm ? 1 : 0 }}
    >
      <CursorArrow color={cursor.color} />
      <div class="absolute left-[26px] top-[30px]">
        <CursorLabel name={cursor.name} color={cursor.color} />
      </div>
    </div>
  );
}

export function FakeCursors() {
  return (
    /* Absolute, not fixed: the layer belongs to the hero and scrolls away with
       it. Floating over the whole document is what put demo cursors on top of
       the feature artifacts and the footer — the same people apparently standing
       on every section at once.

       Below 1280px the 1120px column leaves no margin to keep clear of, so the
       cursors would have to cross live copy. They are decoration; drop them
       rather than let them sit on the text. */
    <div class="absolute inset-0 pointer-events-none z-[100] overflow-hidden hidden xl:block" aria-hidden="true">
      {DEMO_CURSORS.map((c) => (
        <AnimatedCursor key={c.name} cursor={c} />
      ))}
    </div>
  );
}
