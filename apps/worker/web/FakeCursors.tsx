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
 * The hero is left-anchored now, not centred, so the free space is no longer
 * the symmetric outer margin these paths were originally cut for: the copy
 * holds the left of the column and the board's working area is the right, plus
 * the band under the trust line. Marcus in particular used to orbit x 6-13%,
 * which put his name tag straight through the word "anything." in the subline
 * the moment the copy moved left.
 *
 * Every percentage below is hand-tuned to clear the headline (which runs to
 * ~81% of the viewport at 1280 and ~72% at 1440), the reading column (left of
 * ~52% down to the trust line) and the board caption at the fold's floor, while
 * still crossing enough distance to look alive. On a narrow screen the whole
 * layer is hidden (see FakeCursors) rather than squeezed. Nothing enforces this
 * — if the hero's measures in Landing.tsx change, re-check these paths.
 */
const CURSORS: FakeCursor[] = [
  // Above the headline's right end, clear of its cap height at both 1280 and
  // 1440 — the headline's top edge sits at roughly 23% of the fold.
  {
    name: 'Alice',
    color: '#3b82f6',
    path: [
      [84, 13],
      [90, 19],
      [82, 22],
      [88, 16],
      [84, 13],
    ],
    duration: 18,
    delay: 1,
  },
  // The band under the trust line and above the board caption. This is the one
  // pocket of free space on the left half once the copy is anchored there.
  {
    name: 'Marcus',
    color: '#f43f5e',
    path: [
      [11, 74],
      [19, 79],
      [9, 82],
      [16, 76],
      [11, 74],
    ],
    duration: 22,
    delay: 3,
  },
  // Right of the action column, where the board is genuinely empty.
  {
    name: 'Yuki',
    color: '#8b5cf6',
    path: [
      [74, 55],
      [86, 62],
      [78, 70],
      [88, 57],
      [74, 55],
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
