import { cn } from '@marklayer/types';
import { signal } from '@preact/signals';
import { useLayoutEffect, useRef } from 'preact/hooks';
import { GLYPH, geist } from '../lib/geist';
import { Icon } from '../lib/icons';
import { prefersReducedMotion } from '../lib/media';
import { capturePointer, pointerSampler } from '../lib/pointer';
import { activeTool, selectTool, visibleTools } from '../lib/state';
import type { Tool } from '../lib/types';

/**
 * The fan's geometry is derived, not eyeballed. Neighbours sit `step` apart on
 * the ring, so the clearance between two adjacent tools is the chord between
 * their centres less their own width:
 *
 *   gap = 2 · RADIUS · sin(step / 2) − SIZE,   step = SPREAD / (COUNT − 1)
 *
 * Five tools over 160° gives 2 · 72 · sin(20°) ≈ 17px, four times the bar's own
 * 4px gutter — which is what an angular target needs and a rectangular one does
 * not. The four numbers are one system: pulling the radius in, or adding a sixth
 * tool, closes that gap unless the arc opens to pay for it.
 *
 * The radius answers to a second constraint the formula does not see. The two
 * outer tools sit almost level with the bar itself, and the bar runs 44px to the
 * right of this button before its grip ends, so they clear it by
 * RADIUS · cos(10°) − SIZE/2 − 44 — about 11px at 72, and only 3 at 64, which
 * read as one shape rather than two.
 */
const COUNT = 5;
const SPREAD = 160;
const RADIUS = 72;
/** Matches `geist.ctl` (h-8 w-8) — the fan is built from the bar's own control. */
const SIZE = 32;

/** Under this the press is still a plain tap, so the fan never opens on a click. */
const DEADZONE = 14;
/**
 * How far past its own slice a tool still answers. Half a step covers the ring;
 * the slack is what lets the two outer tools take a sloppy drag, while a drag
 * aimed away from the fan resolves to nothing and cancels the gesture.
 */
const SLACK = 15;

const OPEN_MS = 260;
const STAGGER_MS = 24;

/**
 * Where the fan may point, in preference order: up, then the diagonals, then
 * sideways, then down. The bar is draggable, so the fan has to find its own room.
 */
const BASES = [-90, -135, -45, 180, 0, 135, 45, 90];

/** `ox`/`oy` slide the whole fan — see `chooseBase`. */
type FanState = { tools: Tool[]; base: number; ox: number; oy: number };

/** One toolbar exists at a time, so the open fan lives beside `dragShieldActive`. */
const fanState = signal<FanState | null>(null);
/** Index into `fanState.tools`, or null while the drag is aimed at nothing. */
const fanAim = signal<number | null>(null);

/** Shortest signed distance between two headings, in degrees. */
const angleDelta = (a: number, b: number) => ((((a - b) % 360) + 540) % 360) - 180;

const angleAt = ({ base, i, count }: { base: number; i: number; count: number }) =>
  base - SPREAD / 2 + (SPREAD / (count - 1)) * i;

const pointAt = ({ base, i, count }: { base: number; i: number; count: number }) => {
  const a = (angleAt({ base, i, count }) * Math.PI) / 180;
  return { x: Math.cos(a) * RADIUS, y: Math.sin(a) * RADIUS };
};

/** `translate(-50%, -50%)` first, so a tool's own centre is what lands on the ring. */
const place = ({ x, y, scale }: { x: number; y: number; scale: number }) =>
  `translate(-50%, -50%) translate(${x}px, ${y}px) scale(${scale})`;

/** How far a fan pointing `base` would have to slide to clear every viewport edge. */
function slideToFit({ cx, cy, base, count }: { cx: number; cy: number; base: number; count: number }) {
  // Half a tool, plus a 16px gutter so one landing near an edge reads as placed
  // rather than as having only just survived.
  const m = SIZE / 2 + 16;
  // One accumulator per edge: the fan may hang over two opposite edges at once,
  // and the slide it needs is the difference between those pushes, not their sum.
  let left = 0;
  let right = 0;
  let top = 0;
  let bottom = 0;
  for (let i = 0; i < count; i++) {
    const { x, y } = pointAt({ base, i, count });
    left = Math.max(left, m - (cx + x));
    right = Math.max(right, cx + x - (innerWidth - m));
    top = Math.max(top, m - (cy + y));
    bottom = Math.max(bottom, cy + y - (innerHeight - m));
  }
  return { ox: left - right, oy: top - bottom };
}

/**
 * How far the hub may sit from the button it opened from. The slide moves the
 * drawing and the origin the aim is measured from together, so the two never
 * disagree — but it also moves the gesture's neutral point away from the finger,
 * and past about a tool's width that stops feeling like the button's own fan.
 */
const MAX_SLIDE = 24;

/**
 * Point the fan where there is room, sliding it a little if rotating is not
 * quite enough. Rotation alone cannot always win: with the bar pushed flush into
 * a corner, the arc a 64px radius can reach without crossing an edge is about
 * 68° wide and this fan is 160°, so no direction and no radius fits. Rather than
 * cut a tool off at the edge or hand the gesture an origin nowhere near the
 * finger, the fan declines to open there and the press stays a plain click.
 * From the bar's home at the bottom of the screen nothing slides at all.
 */
function chooseBase({ cx, cy, count }: { cx: number; cy: number; count: number }) {
  let best: { base: number; ox: number; oy: number; cost: number } | null = null;
  for (const base of BASES) {
    const { ox, oy } = slideToFit({ cx, cy, base, count });
    const cost = Math.hypot(ox, oy);
    if (cost === 0) return { base, ox, oy };
    if (!best || cost < best.cost) best = { base, ox, oy, cost };
  }
  return best && best.cost <= MAX_SLIDE ? { base: best.base, ox: best.ox, oy: best.oy } : null;
}

/**
 * Pointer capture redirects the click to whatever captured, so a drag released
 * anywhere on screen still fires one on the collapsed button. Swallow it, or
 * committing a tool would expand the bar in the same breath. The timeout carries
 * as much as the listener does: a cancelled gesture produces no click at all,
 * and a listener left armed would eat the user's next real one.
 */
function swallowNextClick(btn: HTMLElement) {
  const stop = (e: Event) => {
    e.stopPropagation();
    e.preventDefault();
  };
  btn.addEventListener('click', stop, { capture: true, once: true });
  setTimeout(() => btn.removeEventListener('click', stop, { capture: true }), 350);
}

/**
 * Press the collapsed bar and drag toward a tool to switch to it without ever
 * expanding it: opening, choosing and committing are one gesture. A plain click
 * still expands, so this only adds a path rather than replacing one.
 *
 * `setShield` raises the toolbar's drag shield. The web viewer frames the target
 * page in an iframe, and an iframe swallows the pointer stream the moment the
 * cursor crosses into it — the same reason a toolbar drag needs the shield.
 */
function startToolFan({ e, setShield }: { e: PointerEvent; setShield: (on: boolean) => void }) {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  const btn = e.currentTarget;
  if (!(btn instanceof HTMLElement)) return;

  const tools = visibleTools.value.slice(0, COUNT);
  // One tool cannot be aimed at, and zero cannot be divided by.
  if (tools.length < 2) return;

  const r = btn.getBoundingClientRect();
  const btnX = r.left + r.width / 2;
  const btnY = r.top + r.height / 2;
  const { pointerId } = e;
  const count = tools.length;
  const step = SPREAD / (count - 1);
  let opened = false;
  /** Set once the fan has been refused room, so a longer drag doesn't retry it. */
  let cancelled = false;

  const aimAt = (px: number, py: number) => {
    if (cancelled) return;
    if (!opened) {
      if (Math.hypot(px - btnX, py - btnY) < DEADZONE) return;
      const placed = chooseBase({ cx: btnX, cy: btnY, count });
      // No room for a whole fan here. Leave the press alone so it still reads as
      // the click it started as, and never try again for this gesture.
      if (!placed) {
        cancelled = true;
        return;
      }
      opened = true;
      fanState.value = { tools, ...placed };
      setShield(true);
    }
    const st = fanState.value;
    if (!st) return;
    // Measured from the hub, which a corner may have slid off the button.
    const dx = px - (btnX + st.ox);
    const dy = py - (btnY + st.oy);
    if (Math.hypot(dx, dy) < DEADZONE) {
      fanAim.value = null;
      return;
    }
    const { base } = st;
    const heading = (Math.atan2(dy, dx) * 180) / Math.PI;
    let best = 0;
    let bestD = Number.POSITIVE_INFINITY;
    for (let i = 0; i < count; i++) {
      const d = Math.abs(angleDelta(heading, angleAt({ base, i, count })));
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    fanAim.value = bestD <= step / 2 + SLACK ? best : null;
  };

  const aimSampler = pointerSampler({ event: e, onFrame: aimAt });

  const onMove = (ev: PointerEvent) => {
    if (ev.pointerId !== pointerId) return;
    if (ev.cancelable) ev.preventDefault();
    aimSampler.sample(ev);
  };

  const teardown = () => {
    aimSampler.cancel();
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', onAbort);
    document.removeEventListener('keydown', onKey, true);
    if (opened) swallowNextClick(btn);
    setShield(false);
    fanState.value = null;
    fanAim.value = null;
  };

  function onUp(ev: PointerEvent) {
    if (ev.pointerId !== pointerId) return;
    // Land the pending sample before reading the aim, or a fast flick commits a
    // tool the pointer passed through instead of the one it stopped on.
    aimSampler.flush();
    const st = fanState.value;
    const aim = fanAim.value;
    const tool = st && aim !== null ? st.tools[aim] : undefined;
    if (tool) selectTool({ tool, via: 'radial' });
    teardown();
  }

  function onAbort(ev: PointerEvent) {
    if (ev.pointerId !== pointerId) return;
    teardown();
  }

  function onKey(ev: KeyboardEvent) {
    if (ev.key !== 'Escape' || !opened) return;
    ev.preventDefault();
    ev.stopPropagation();
    // Shut the fan but keep the pointer listeners: the release has not happened
    // yet, and it is the release that carries the click needing to be swallowed.
    // Tearing down here instead would arm that swallow against a click still
    // seconds away, and a held Escape would then expand the bar on let-go.
    cancelled = true;
    fanState.value = null;
    fanAim.value = null;
    setShield(false);
  }

  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
  document.addEventListener('pointercancel', onAbort);
  document.addEventListener('keydown', onKey, true);
  capturePointer({ target: btn, pointerId });
}

/**
 * Every tool's resting style is its OPEN position; the entrance is animated off
 * that state, never onto it. A fan whose animation never runs is one that is
 * simply already open, rather than five invisible tools.
 */
function Fan({ st, aim }: { st: FanState; aim: number | null }) {
  const hubRef = useRef<HTMLDivElement>(null);
  const count = st.tools.length;

  useLayoutEffect(() => {
    const hub = hubRef.current;
    if (!hub || prefersReducedMotion()) return;
    const total = OPEN_MS + (count - 1) * STAGGER_MS;
    hub.querySelectorAll<HTMLElement>('[data-fan-opt]').forEach((el, i) => {
      const { x, y } = pointAt({ base: st.base, i, count });
      const shut = place({ x: 0, y: 0, scale: 0.4 });
      // Both keyframes carry the same transform functions in the same order, so
      // the translate and the scale interpolate on their own terms rather than
      // being decomposed back out of a matrix.
      const travel = { transform: place({ x, y, scale: 1 }), opacity: 1, offset: 1 };
      // The stagger is a held keyframe, not a delay: a delay needs a backwards
      // fill to hold the closed frame, and a fill is what strands an element in
      // its hidden state when the animation is cancelled before it starts.
      const hold = (i * STAGGER_MS) / total;
      // Ease the segment that actually travels — a global easing would spend
      // its curve on the hold as well.
      const spring = 'cubic-bezier(0.16, 1, 0.3, 1)';
      el.animate(
        hold > 0
          ? [
              { transform: shut, opacity: 0, offset: 0, easing: 'linear' },
              { transform: shut, opacity: 0, offset: hold, easing: spring },
              travel,
            ]
          : [{ transform: shut, opacity: 0, offset: 0, easing: spring }, travel],
        { duration: total },
      );
    });
    // Once per open, deliberately: the aim changes on nearly every frame of the
    // drag, and re-running this would re-deal the fan on each one.
  }, []);

  return (
    <div
      ref={hubRef}
      aria-hidden="true"
      // Aim comes from the pointer's angle, never from hit-testing, so the fan
      // stays entirely out of the capture's way.
      class="absolute pointer-events-none"
      style={{ left: `${SIZE / 2 + st.ox}px`, top: `calc(50% + ${st.oy}px)` }}
    >
      {st.tools.map((tool, i) => (
        <span
          key={tool}
          data-fan-opt
          class={cn(
            geist.ctl,
            // The shell's own material: a hairline ring and one tight
            // directional shadow, so a tool reads against whatever page it is
            // floating over without a bloom around it.
            'bg-(--ds-background-100) [box-shadow:var(--ds-shadow-menu)]',
            // The bar's selected fill. Exactly one tool on the fan is filled at
            // any moment, and it is the one a release commits.
            i === aim ? geist.ctlOn : geist.ctlIdle,
            'absolute top-0 left-0',
          )}
          style={{ transform: place({ ...pointAt({ base: st.base, i, count }), scale: 1 }) }}
        >
          <Icon name={tool} {...GLYPH} />
        </span>
      ))}
    </div>
  );
}

/**
 * Wire the collapsed button to the fan: hand back the icon it should be showing
 * and the press that arms the gesture. One hook rather than three exports,
 * because the icon and the gesture are the same feature and a caller that took
 * only one of them would be quietly broken.
 *
 * `setShield` raises the toolbar's drag shield, which the fan needs for the same
 * reason a toolbar drag does but has no business reaching for itself.
 */
export function useToolFan({ setShield }: { setShield: (on: boolean) => void }) {
  const st = fanState.value;
  const aim = fanAim.value;
  return {
    /** Open once the press has travelled past the deadzone, never on a click. */
    open: st !== null,
    /**
     * The tool the drag is aimed at, else the live one. The button is the
     * preview, which is why the fan carries no labels — and why committing
     * looks like nothing happening, because the icon under the cursor was
     * already the answer.
     */
    icon: (st && aim !== null ? st.tools[aim] : undefined) ?? activeTool.value,
    onPointerDown: (e: PointerEvent) => startToolFan({ e, setShield }),
  };
}

/**
 * Mount inside a `relative` box whose left edge is the collapsed button's own
 * column. Remounting `Fan` per gesture is what gives the entrance a mount to
 * run on, so the slot stays this thin on purpose.
 */
export function ToolFan() {
  const st = fanState.value;
  if (!st) return null;
  return <Fan st={st} aim={fanAim.value} />;
}
