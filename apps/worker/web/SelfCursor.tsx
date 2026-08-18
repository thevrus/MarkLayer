import { prefersReducedMotion } from '@ext/lib/media';
import { activeTool, isDrawingTool, localUser } from '@ext/lib/state';
import { useEffect, useRef } from 'preact/hooks';
import { CursorArrow } from './CursorArrow';
import { CursorLabel } from './CursorLabel';
import { isMobileDevice } from './signals';

/** Toggled on <html> while our cursor is drawn; drops the native one (style.css). */
const SWAP_CLASS = 'ml-cursor-swapped';

/**
 * The arrow tip sits inset from the SVG's top-left corner, so the whole mark is
 * shifted back by that much to put the tip exactly on the pointer. Peer cursors
 * can skip this (a few px of drift is invisible on someone else's pointer);
 * your own cursor cannot — you can see it miss what you are clicking.
 */
const TIP_X = 6;
const TIP_Y = 6;

/** Resting offset of the name tag from the arrow tip, and the viewport gutter it keeps. */
const TAG_X = 26;
const TAG_Y = 30;
const TAG_EDGE = 8;

/** Per-frame catch-up of the name tag towards the arrow, and how far it may lag. */
const TAG_CATCHUP = 0.22;
const TAG_MAX_LAG = 9;

/** A parked pointer means you are reading, so the tag gets out of the way. */
const TAG_IDLE_MS = 1400;

/**
 * Dropping the native pointer costs the hand cursor over links, so the arrow
 * answers for it: it tucks in over anything clickable. Same signal, kept in the
 * cursor instead of bolted onto the element it is pointing at.
 */
const HOVER_SCALE = 0.88;
const CLICKABLE = 'a, button, summary, label, [role="button"], input, select';

/** Matches the peer click ripple in CursorLayer. */
const RIPPLE_RINGS = [0, 140];

export function SelfCursor() {
  // 'navigate' is the only tool that leaves the pointer free. The rest want the
  // native crosshair or caret on the canvas, where precision beats decoration.
  const enabled = !isMobileDevice && !isDrawingTool(activeTool.value);
  const rootRef = useRef<HTMLDivElement>(null);
  const hoverRef = useRef<HTMLDivElement>(null);
  const arrowRef = useRef<HTMLDivElement>(null);
  const tagRef = useRef<HTMLDivElement>(null);
  const rippleRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    const hover = hoverRef.current;
    const arrow = arrowRef.current;
    const tag = tagRef.current;
    const rippleHost = rippleRef.current;
    if (!enabled || !root || !hover || !arrow || !tag || !rippleHost) return;
    // A coarse pointer has no system cursor to replace, and forced-colors means
    // someone has deliberately configured how their pointer looks. Leave both alone.
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    if (window.matchMedia('(forced-colors: active)').matches) return;
    const calm = prefersReducedMotion();

    const html = document.documentElement;
    let x = 0;
    let y = 0;
    let tagX = 0;
    let tagY = 0;
    let placed = false;
    let movedAt = 0;
    let raf = 0;
    let lastTarget: Element | null = null;
    const wake = () => {
      if (!raf) raf = requestAnimationFrame(tick);
    };

    // Measured once (the name never changes here) so the frame loop can decide
    // which side of the arrow the tag sits on without reading layout at 60 fps.
    let tagW = tag.offsetWidth;
    let tagH = tag.offsetHeight;
    const measure = () => {
      tagW = tag.offsetWidth;
      tagH = tag.offsetHeight;
      wake();
    };
    // The webfont lands after first paint and changes the tag's width.
    document.fonts.ready.then(measure);

    const setShown = (shown: boolean) => {
      root.style.opacity = shown ? '1' : '0';
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      x = e.clientX;
      y = e.clientY;
      movedAt = performance.now();
      if (!placed) {
        placed = true;
        tagX = x;
        tagY = y;
        // Hide the native pointer only once we know where to draw ours, so a
        // visitor who never moves the mouse is never left with no cursor.
        html.classList.add(SWAP_CLASS);
      }
      // A move within one element can't change either answer, and pointermove
      // fires far above frame rate, so only re-walk the ancestor chain when the
      // element under the cursor actually changed.
      const target = e.target instanceof Element ? e.target : null;
      if (target !== lastTarget) {
        lastTarget = target;
        // Form fields keep their native caret — an I-beam is information.
        setShown(!target?.closest('input, textarea, [contenteditable]'));
        hover.style.transform = target?.closest(CLICKABLE) ? `scale(${HOVER_SCALE})` : 'scale(1)';
      }
      wake();
    };

    const onLeave = () => {
      placed = false;
      html.classList.remove(SWAP_CLASS);
      setShown(false);
    };

    const onDown = () => {
      wake();
      if (!placed || calm) return;
      arrow.animate([{ transform: 'scale(1)' }, { transform: 'scale(0.78)' }, { transform: 'scale(1)' }], {
        duration: 260,
        easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
      });
      for (const delay of RIPPLE_RINGS) {
        const ring = document.createElement('span');
        ring.className = 'absolute w-10 h-10 rounded-full border';
        ring.style.cssText = `left:${x}px;top:${y}px;border-color:${localUser.color}`;
        rippleHost.appendChild(ring);
        const ripple = ring.animate(
          [
            { transform: 'translate(-50%, -50%) scale(0.5)', opacity: 0.35 },
            { transform: 'translate(-50%, -50%) scale(1.8)', opacity: 0 },
          ],
          { duration: 700, delay, easing: 'cubic-bezier(0.2, 0.6, 0.2, 1)', fill: 'both' },
        );
        ripple.finished.then(() => ring.remove()).catch(() => ring.remove());
      }
    };

    const tick = () => {
      raf = 0;
      const k = calm ? 1 : TAG_CATCHUP;
      tagX += (x - tagX) * k;
      tagY += (y - tagY) * k;
      const dx = tagX - x;
      const dy = tagY - y;
      const dist = Math.hypot(dx, dy);
      // The tag drifts a hair behind the arrow like an interpolated peer cursor,
      // clamped so a fast flick never strands it halfway across the screen.
      const clamp = dist > TAG_MAX_LAG ? TAG_MAX_LAG / dist : 1;
      // Near an edge the tag swaps to the other side of the arrow rather than
      // letting the viewport shave its letters off.
      const flipX = x + TAG_X + tagW > window.innerWidth - TAG_EDGE ? -(TAG_X * 2 + tagW) : 0;
      const flipY = y + TAG_Y + tagH > window.innerHeight - TAG_EDGE ? -(TAG_Y + tagH + 6) : 0;
      root.style.transform = `translate3d(${x - TIP_X}px, ${y - TIP_Y}px, 0)`;
      tag.style.transform = `translate3d(${flipX + dx * clamp}px, ${flipY + dy * clamp}px, 0)`;
      const idle = performance.now() - movedAt > TAG_IDLE_MS;
      tag.style.opacity = idle ? '0' : '1';
      // Park once the tag has caught up and the idle fade has landed: every
      // further frame would write the same three values. `wake` restarts the
      // loop on the next move, press or resize.
      if (dist > 0.1 || !idle) raf = requestAnimationFrame(tick);
    };
    wake();

    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerdown', onDown, { passive: true });
    window.addEventListener('resize', measure);
    document.addEventListener('pointerleave', onLeave);
    window.addEventListener('blur', onLeave);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('resize', measure);
      document.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('blur', onLeave);
      html.classList.remove(SWAP_CLASS);
    };
  }, [enabled]);

  if (!enabled) return null;

  return (
    <div class="fixed inset-0 overflow-hidden pointer-events-none z-2147483647" aria-hidden="true">
      <div ref={rippleRef} class="absolute inset-0" />
      <div
        ref={rootRef}
        class="absolute top-0 left-0 will-change-transform"
        style={{ opacity: 0, transition: 'opacity 120ms linear' }}
      >
        <div
          ref={hoverRef}
          class="origin-top-left"
          style={{ transition: 'transform 160ms cubic-bezier(0.2, 0.8, 0.3, 1)' }}
        >
          <div ref={arrowRef} class="origin-top-left">
            <CursorArrow color={localUser.color} />
          </div>
        </div>
        <div
          ref={tagRef}
          class="absolute will-change-transform"
          style={{ left: TAG_X, top: TAG_Y, transition: 'opacity 220ms ease-out' }}
        >
          <CursorLabel name={localUser.name} color={localUser.color} />
        </div>
      </div>
    </div>
  );
}
