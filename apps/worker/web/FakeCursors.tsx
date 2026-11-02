import { prefersReducedMotion } from '@ext/lib/media';
import { useSignal } from '@preact/signals';
import { useEffect, useRef } from 'preact/hooks';
import { CursorArrow } from './CursorArrow';
import { CursorChat, CursorLabel } from './CursorLabel';
import { timerScope } from './landing/timerScope';
import { seedHeroReply } from './landing/useHeroPin';

/** A chat line; an `act` runs first and must succeed, so the line is never said about nothing. */
type Line = string | { text: string; act: (by: { author: string; color: string }) => boolean };

interface FakeCursor {
  name: string;
  color: string;
  path: [number, number][];
  duration: number;
  delay: number;
  /** Cursor chat, said at `path[0]`, one cursor at a time in array order. */
  lines: Line[];
}

/**
 * Paths are percentages of the hero cell, each kept clear of the centred copy:
 * the headline spans roughly 17-83% across at 1280 and 1440, the action column
 * 31-69%, and the seeded comment pin sits just right of the URL field. A cursor
 * crossing live copy reads as a rendering fault, not a room. Chat only opens at
 * `path[0]`, so that point plus a ~170px tag (20 characters) must also clear the
 * copy. Nothing enforces this; if the hero's measures change, re-check both.
 */
const CURSORS: FakeCursor[] = [
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
    delay: 1,
    lines: ['drop your link above', 'my pin is a real one', 'seen it, thanks!'],
  },
  /* Above and right of the headline's last word; high enough that its tag clears the
     headline's top, and far enough in that a 20-character tag still fits on the right. */
  {
    name: 'Alice',
    color: '#3b82f6',
    path: [
      [84, 4],
      [90, 12],
      [86, 19],
      [89, 9],
      [84, 4],
    ],
    duration: 18,
    delay: 2,
    lines: ['love this headline', 'can we go bolder?'],
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
    // Answers Yuki's pin the round after she mentions it; she thanks him the round after that.
    lines: ["who's drawing?", { text: 'replied on your pin', act: seedHeroReply }, 'on it, one sec'],
  },
];

const FIRST_LINE_MS = 1600;
const QUIET_MS = 4000;
const HOLD_MS = 2600;
const GLIDE_MS = 900;

type Speak = (line: string) => Promise<void>;
type Register = (entry: { name: string; speak: Speak | null }) => void;

function nextLine({ cursor, said }: { cursor: FakeCursor; said: Map<string, number> }): string | undefined {
  for (let tries = 0; tries < cursor.lines.length; tries++) {
    const n = said.get(cursor.name) ?? 0;
    said.set(cursor.name, n + 1);
    const line = cursor.lines[n % cursor.lines.length];
    if (typeof line === 'string') return line;
    if (line?.act({ author: cursor.name, color: cursor.color })) return line.text;
  }
}

function AnimatedCursor({ cursor, register }: { cursor: FakeCursor; register: Register }) {
  const ref = useRef<HTMLDivElement>(null);
  const message = useSignal<string | undefined>(undefined);
  /* These are WAAPI animations, so the stylesheet's reduced-motion block cannot
     reach them — it only clamps CSS animations. Calm renders them parked at
     their start positions, silent: a still room is still the product, an empty
     margin is not. */
  const calm = prefersReducedMotion();

  useEffect(() => {
    if (calm) return;
    const el = ref.current;
    if (!el) return;

    const { wait, clear } = timerScope();
    let stopped = false;
    let move: Animation | null = null;
    let request: { line: string; from?: Keyframe; done: () => void } | null = null;
    const [restX, restY] = cursor.path[0];
    const rest = { left: `${restX}%`, top: `${restY}%` };

    // Typed, not printed: an uneven cadence with a beat at each space is what reads as a person.
    const talk = async ({ line, from }: { line: string; from?: Keyframe }) => {
      if (from)
        await el.animate([from, rest], { duration: GLIDE_MS, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' }).finished;
      message.value = '';
      await wait(500);
      for (let i = 1; i <= line.length; i++) {
        await wait(45 + Math.random() * 70 + (line[i - 1] === ' ' ? 90 : 0));
        message.value = line.slice(0, i);
      }
      await wait(HOLD_MS);
      message.value = undefined;
    };

    // Called mid-lap: note where the lap had it, end the lap, and glide home to talk.
    register({
      name: cursor.name,
      speak: (line) =>
        new Promise<void>((done) => {
          const { left, top } = getComputedStyle(el);
          request = { line, done, from: move?.playState === 'running' ? { left, top } : undefined };
          move?.cancel();
        }),
    });

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

    const keyframes = cursor.path.map(([x, y]) => ({ left: `${x}%`, top: `${y}%` }));

    const run = async () => {
      await wait(cursor.delay * 1000 + 600);
      while (!stopped) {
        if (request) {
          const r = request;
          request = null;
          await talk(r);
          r.done();
          continue;
        }
        // `fill: none`: the inline style already parks it at path[0], where every lap ends.
        move = el.animate(keyframes, {
          duration: cursor.duration * 1000,
          easing: 'cubic-bezier(0.25, 0.1, 0.25, 1)',
        });
        await move.finished.catch(() => undefined);
      }
    };
    run();

    return () => {
      stopped = true;
      clear();
      register({ name: cursor.name, speak: null });
      appear.cancel();
      move?.cancel();
      message.value = undefined;
    };
  }, [cursor, calm, message, register]);

  const [startX, startY] = cursor.path[0];

  return (
    <div
      ref={ref}
      class="absolute pointer-events-none"
      style={{ left: `${startX}%`, top: `${startY}%`, opacity: calm ? 1 : 0 }}
    >
      <CursorArrow color={cursor.color} />
      <div class="absolute left-[26px] top-[30px]">
        <CursorLabel color={cursor.color}>
          {message.value === undefined ? (
            <span key="name" class="ml-char-in">
              {cursor.name}
            </span>
          ) : (
            <CursorChat text={message.value} />
          )}
        </CursorLabel>
      </div>
    </div>
  );
}

/** One speaker at a time, in array order, with a quiet stretch after each line. */
function useChatScheduler(layer: { current: HTMLElement | null }) {
  const speakers = useRef(new Map<string, Speak>()).current;
  const calm = prefersReducedMotion();

  useEffect(() => {
    const el = layer.current;
    if (calm || !el) return;
    const { wait, clear } = timerScope();
    // `display: none` below `xl` never intersects either, so a hidden or scrolled-away room stays silent
    // and nobody replies on the pin unseen.
    let inView = false;
    const io = new IntersectionObserver(([e]) => {
      if (e) inView = e.isIntersecting;
    });
    io.observe(el);
    const said = new Map<string, number>();
    const run = async () => {
      await wait(FIRST_LINE_MS);
      for (let turn = 0; ; turn++) {
        const cursor = CURSORS[turn % CURSORS.length];
        const speak = cursor && speakers.get(cursor.name);
        const line = speak && inView && document.visibilityState === 'visible' ? nextLine({ cursor, said }) : undefined;
        if (speak && line) await speak(line);
        await wait(QUIET_MS);
      }
    };
    run();
    return () => {
      clear();
      io.disconnect();
    };
  }, [calm, layer, speakers]);

  return useRef<Register>(({ name, speak }) => {
    if (speak) speakers.set(name, speak);
    else speakers.delete(name);
  }).current;
}

export function FakeCursors() {
  const layer = useRef<HTMLDivElement>(null);
  const register = useChatScheduler(layer);
  return (
    /* Absolute, not fixed: the layer belongs to the hero and scrolls away with
       it. Floating over the whole document is what put demo cursors on top of
       the feature artifacts and the footer — the same people apparently standing
       on every section at once.

       Below 1280px the margins beside the copy are too narrow to keep clear
       of, so the cursors would have to cross live copy. They are decoration;
       drop them rather than let them sit on the text. */
    <div
      ref={layer}
      class="absolute inset-0 pointer-events-none z-[100] overflow-hidden hidden xl:block"
      aria-hidden="true"
    >
      {CURSORS.map((c) => (
        <AnimatedCursor key={c.name} cursor={c} register={register} />
      ))}
    </div>
  );
}
