import { prefersReducedMotion } from '@ext/lib/media';
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
 * Paths are percentages of the hero cell, each kept clear of the centred copy:
 * the headline spans roughly 17-83% across at 1280 and 1440, the action column
 * 31-69%, and the seeded comment pin sits just right of the URL field. A cursor
 * crossing live copy reads as a rendering fault, not a room. Nothing enforces
 * this; if the hero's measures in Landing.tsx change, re-check these paths.
 */
const CURSORS: FakeCursor[] = [
  // Above and right of the headline's last word.
  {
    name: 'Alice',
    color: '#3b82f6',
    path: [
      [88, 8],
      [93, 13],
      [89, 19],
      [92, 10],
      [88, 8],
    ],
    duration: 18,
    delay: 1,
  },
  // The left margin, level with the field and the suggestions.
  {
    name: 'Marcus',
    color: '#f43f5e',
    path: [
      [6, 58],
      [13, 64],
      [8, 72],
      [12, 60],
      [6, 58],
    ],
    duration: 22,
    delay: 3,
  },
  // Right of the action column, below the seeded pin.
  {
    name: 'Yuki',
    color: '#8b5cf6',
    path: [
      [80, 66],
      [90, 72],
      [84, 80],
      [92, 68],
      [80, 66],
    ],
    duration: 20,
    delay: 2,
  },
];

function AnimatedCursor({ cursor }: { cursor: FakeCursor }) {
  const ref = useRef<HTMLDivElement>(null);
  /* These are WAAPI animations, so the stylesheet's reduced-motion block cannot
     reach them — it only clamps CSS animations. Without this check three
     cursors orbit forever for someone who asked the system for no motion, while
     every sibling animation here (Toolbar, ChannelCycle) honours it.
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

       Below 1280px the margins beside the copy are too narrow to keep clear
       of, so the cursors would have to cross live copy. They are decoration;
       drop them rather than let them sit on the text. */
    <div class="absolute inset-0 pointer-events-none z-[100] overflow-hidden hidden xl:block" aria-hidden="true">
      {CURSORS.map((c) => (
        <AnimatedCursor key={c.name} cursor={c} />
      ))}
    </div>
  );
}
