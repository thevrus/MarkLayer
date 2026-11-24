import { prefersReducedMotion } from '@ext/lib/media';
import { STATUS_COLORS, STATUS_STYLES } from '@ext/lib/status-ui';
import { type Signal, useSignal } from '@preact/signals';
import { Check, Loader2 } from 'lucide-preact';
import type { ComponentChildren, RefObject } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { type SimpleIcon, siClaude, siLinear } from 'simple-icons';
import { CursorArrow } from '../CursorArrow';
import { CursorChat, CursorLabel } from '../CursorLabel';
import { timerScope } from './timerScope';

const MAYA = { name: 'Maya', color: '#e5484d' };
const LEO = { name: 'Leo', color: '#0e9f6e' };

const COMMENT = 'Cut the lead to one sentence?';
const REPLY = 'Agreed. Filing it.';

/** The story's beats, in order. The scene renders from the current one. */
const STEP = { idle: 0, toPin: 1, comment: 2, draw: 3, reply: 4, filed: 5, fixing: 6, resolved: 7 } as const;

/** Percentages of the desk. The pin sits in the article body, the thread opens to its right. */
const PIN = { x: 62, y: 40 };
const MAYA_AT = { rest: { x: 80, y: 20 }, pinning: { x: 62.6, y: 41.4 }, after: { x: 78, y: 29 } };
const LEO_AT = { rest: { x: 55, y: 66 }, end: { x: 58.6, y: 43.6 } };
/** Leo's pen stroke: a quadratic from his rest to just under the pin, which his cursor also rides. */
const STROKE = { from: LEO_AT.rest, via: { x: 50, y: 52 }, to: LEO_AT.end };
const DRAW_MS = 1200;

const pct = ({ x, y }: { x: number; y: number }) => ({ left: `${x}%`, top: `${y}%` });

function strokePoint(t: number) {
  const u = 1 - t;
  const { from, via, to } = STROKE;
  return {
    x: u * u * from.x + 2 * u * t * via.x + t * t * to.x,
    y: u * u * from.y + 2 * u * t * via.y + t * t * to.y,
  };
}

interface PeerProps {
  name: string;
  color: string;
  at: { x: number; y: number };
  /** A chat line mid-typing replaces the name, as a real cursor's does. */
  chat?: string;
  /** Offsets the idle drift, so the two do not move in step. */
  delay: number;
  elRef?: RefObject<HTMLDivElement>;
}

/** A teammate on the board: the product's own cursor and tag, laid out as the hero's FakeCursors lay theirs. */
function Peer({ name, color, at, chat, delay, elRef }: PeerProps) {
  return (
    <div
      ref={elRef}
      class="lp-peer absolute z-2 transition-[left,top] duration-900 ease-[cubic-bezier(0.16,1,0.3,1)]"
      style={{ ...pct(at), animationDelay: `${delay}s` }}
    >
      <CursorArrow color={color} />
      <div class="absolute left-[26px] top-[30px]">
        <CursorLabel color={color}>{chat ? <CursorChat text={chat} /> : name}</CursorLabel>
      </div>
    </div>
  );
}

/** Where an annotation went after the page: the destination's own mark, bare, and what happened there. */
function Handoff({ icon, title, status }: { icon: SimpleIcon; title: string; status: string }) {
  return (
    <div class="lp-handoff flex w-[19rem] items-center gap-3.5 rounded-xl bg-white px-4 py-3 font-ui">
      <svg class="size-6 shrink-0" viewBox="0 0 24 24" fill={`#${icon.hex}`} aria-hidden="true">
        <path d={icon.path} />
      </svg>
      <div class="min-w-0">
        <p class="m-0 truncate text-ui font-medium text-ml-fg">{title}</p>
        {/* Keyed on the text, so each new status settles in rather than swapping. */}
        <p key={status} class="lp-crew-in m-0 mt-0.5 truncate text-meta text-ml-fg/60">
          {status}
        </p>
      </div>
    </div>
  );
}

function Message({ who, children }: { who: { name: string; color: string }; children: ComponentChildren }) {
  return (
    <div class="lp-crew-in">
      <p class="m-0 flex items-center gap-1.5 text-meta font-medium text-ml-fg">
        <span class="size-2 rounded-full" style={{ background: who.color }} />
        {who.name}
      </p>
      <p class="m-0 mt-0.5 min-h-[1.4em] text-ui text-ml-fg/80">{children}</p>
    </div>
  );
}

/** Thread open on the pin: Maya's comment, Leo's reply, and the agent's close. */
function Thread({ step, comment, reply }: { step: number; comment: string; reply: string }) {
  return (
    <div
      class="lp-handoff lp-crew-in absolute z-1 flex w-[17rem] flex-col gap-2.5 rounded-xl bg-white p-3.5 font-ui"
      // Top edge level with the pin's; narrowed rather than cut where the desk ends short of 17rem.
      style={{
        left: `calc(${PIN.x}% + 22px)`,
        top: `calc(${PIN.y}% - 12px)`,
        maxWidth: `calc(${100 - PIN.x}% - 34px)`,
      }}
    >
      <Message who={MAYA}>{comment}</Message>
      {step >= STEP.reply && <Message who={LEO}>{reply}</Message>}
      {step >= STEP.resolved && (
        <p class="lp-crew-in m-0 flex items-center gap-1.5 text-meta text-ml-fg/60">
          <Check size={13} strokeWidth={2.5} style={{ color: STATUS_COLORS.resolved }} aria-hidden="true" />
          Resolved by Claude Code
        </p>
      )}
    </div>
  );
}

/** Types `text` into `into` with a person's uneven cadence: a beat at each space. */
async function typeInto({
  text,
  into,
  wait,
}: {
  text: string;
  into: Signal<string>;
  wait: (ms: number) => Promise<void>;
}) {
  for (let i = 1; i <= text.length; i++) {
    await wait(40 + Math.random() * 60 + (text[i - 1] === ' ' ? 80 : 0));
    into.value = text.slice(0, i);
  }
}

/**
 * The people around the live board, playing one review on a loop: Maya pins a
 * comment, Leo draws to it and replies, Linear gets the issue and Claude Code
 * resolves it over MCP. Decoration over a live iframe, so none of it takes the
 * pointer; with reduced motion it rests on the finished thread.
 */
export function DemoCrew() {
  const layer = useRef<HTMLDivElement>(null);
  const leo = useRef<HTMLDivElement>(null);
  const calm = prefersReducedMotion();
  const step = useSignal<number>(calm ? STEP.resolved : STEP.idle);
  const comment = useSignal(calm ? COMMENT : '');
  const reply = useSignal(calm ? REPLY : '');
  const mayaChat = useSignal('');
  const leaving = useSignal(false);

  useEffect(() => {
    const el = layer.current;
    if (calm || !el) return;
    const { wait, clear } = timerScope();
    // Plays only while someone can see it, so a visitor scrolling in never lands mid-story.
    let inView = false;
    const io = new IntersectionObserver(([e]) => {
      if (e) inView = e.isIntersecting;
    });
    io.observe(el);

    const play = async () => {
      for (;;) {
        while (!inView || document.visibilityState !== 'visible') await wait(400);
        await wait(1200);
        step.value = STEP.toPin;
        await typeInto({ text: 'this lead is long', into: mayaChat, wait });
        await wait(700);
        mayaChat.value = '';
        step.value = STEP.comment;
        await wait(300);
        await typeInto({ text: COMMENT, into: comment, wait });
        await wait(800);
        step.value = STEP.draw;
        const path = Array.from({ length: 9 }, (_, i) => pct(strokePoint(i / 8)));
        await leo.current?.animate(path, { duration: DRAW_MS, easing: 'ease-in-out' }).finished.catch(() => undefined);
        await wait(400);
        step.value = STEP.reply;
        await typeInto({ text: REPLY, into: reply, wait });
        await wait(900);
        step.value = STEP.filed;
        await wait(1800);
        step.value = STEP.fixing;
        await wait(2200);
        step.value = STEP.resolved;
        await wait(5000);
        // The marks fade before the reset, so the loop ends on the board clearing rather than a cut.
        leaving.value = true;
        await wait(400);
        step.value = STEP.idle;
        comment.value = '';
        reply.value = '';
        leaving.value = false;
      }
    };
    play();
    return () => {
      clear();
      io.disconnect();
    };
  }, [calm, step, comment, reply, mayaChat, leaving]);

  const s = step.value;
  const mayaAt = s === STEP.idle ? MAYA_AT.rest : s <= STEP.comment ? MAYA_AT.pinning : MAYA_AT.after;
  const leoAt = s >= STEP.draw ? LEO_AT.end : LEO_AT.rest;
  const { from, via, to } = STROKE;
  // The pin wears the product's own status colours: the author's while open, then in progress, then resolved.
  const pinBg =
    s >= STEP.resolved ? STATUS_STYLES.resolved.bg : s === STEP.fixing ? STATUS_STYLES.in_progress.bg : MAYA.color;

  return (
    <div ref={layer} class="pointer-events-none absolute inset-0 hidden sm:block" aria-hidden="true">
      <div class={`absolute inset-0 transition-opacity duration-300 ${leaving.value ? 'opacity-0' : ''}`}>
        {s >= STEP.draw && (
          // A 16:10 box stretched over the desk: close enough to its shape that the pen keeps an even width,
          // and `pathLength` stays in the path's own units (non-scaling-stroke would measure the dash in pixels).
          <svg class="absolute inset-0 size-full" viewBox="0 0 160 100" preserveAspectRatio="none" aria-hidden="true">
            <path
              class="lp-crew-draw"
              d={`M${from.x * 1.6} ${from.y} Q${via.x * 1.6} ${via.y} ${to.x * 1.6} ${to.y}`}
              pathLength={1}
              fill="none"
              stroke={LEO.color}
              stroke-width={0.35}
              stroke-linecap="round"
              style={{ animationDuration: `${DRAW_MS}ms` }}
            />
          </svg>
        )}
        {s >= STEP.comment && (
          <span
            class="lp-crew-in absolute z-1 grid size-6 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full text-meta font-semibold text-white ring-2 ring-white"
            style={{ ...pct(PIN), background: pinBg }}
          >
            {s >= STEP.resolved ? (
              <Check size={13} strokeWidth={3} aria-hidden="true" />
            ) : s === STEP.fixing ? (
              <Loader2 size={13} strokeWidth={2.75} class="animate-spin" aria-hidden="true" />
            ) : (
              '1'
            )}
          </span>
        )}
        {s >= STEP.comment && <Thread step={s} comment={comment.value} reply={reply.value} />}
      </div>
      <Peer {...MAYA} at={mayaAt} chat={mayaChat.value} delay={0} />
      <Peer {...LEO} at={leoAt} delay={-3} elRef={leo} />
      {/* From `lg`, and clear of the window's own toolbar, which docks along its bottom edge. */}
      <div class="absolute bottom-[18%] left-[1.2%] hidden flex-col gap-3 lg:flex">
        <Handoff
          icon={siLinear}
          title="Linear"
          status={s >= STEP.filed ? 'ML-214 filed from Maya’s comment' : 'Files an issue from any comment'}
        />
        <Handoff
          icon={siClaude}
          title="Claude Code"
          status={
            s >= STEP.resolved
              ? 'Resolved Maya’s comment over MCP'
              : s === STEP.fixing
                ? 'Editing the lead…'
                : 'Watching this room over MCP'
          }
        />
      </div>
    </div>
  );
}
