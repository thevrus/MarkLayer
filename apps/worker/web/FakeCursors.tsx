import { useEffect, useRef } from 'preact/hooks';
import { CursorArrow } from './CursorArrow';

interface FakeCursor {
  name: string;
  color: string;
  path: [number, number][];
  duration: number;
  delay: number;
}

const CURSORS: FakeCursor[] = [
  {
    name: 'Alice',
    color: '#3b82f6',
    path: [
      [72, 28],
      [68, 35],
      [75, 42],
      [70, 30],
      [72, 28],
    ],
    duration: 18,
    delay: 1,
  },
  {
    name: 'Marcus',
    color: '#f43f5e',
    path: [
      [25, 55],
      [30, 48],
      [22, 42],
      [28, 52],
      [25, 55],
    ],
    duration: 22,
    delay: 3,
  },
  {
    name: 'Yuki',
    color: '#8b5cf6',
    path: [
      [55, 65],
      [60, 58],
      [52, 62],
      [58, 70],
      [55, 65],
    ],
    duration: 20,
    delay: 2,
  },
];

function AnimatedCursor({ cursor }: { cursor: FakeCursor }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
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
  }, [cursor]);

  return (
    <div
      ref={ref}
      class="absolute pointer-events-none"
      style={{ left: `${cursor.path[0][0]}%`, top: `${cursor.path[0][1]}%`, opacity: 0 }}
    >
      <CursorArrow color={cursor.color} />
      <div
        class="absolute left-6 top-7 whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-semibold text-white leading-none"
        style={{ background: cursor.color, boxShadow: `0 2px 8px ${cursor.color}40` }}
      >
        {cursor.name}
      </div>
    </div>
  );
}

export function FakeCursors() {
  return (
    <div class="fixed inset-0 pointer-events-none z-[100] overflow-hidden" aria-hidden="true">
      {CURSORS.map((c) => (
        <AnimatedCursor key={c.name} cursor={c} />
      ))}
    </div>
  );
}
