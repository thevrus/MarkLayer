import { prefersReducedMotion } from '@ext/lib/media';
import copy from '@site/data/home-copy.json';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';

/**
 * The channels a round of website feedback normally gets lost in. Names only, as
 * type: Slack's and Microsoft's trademark policies bar third-party use of their
 * marks (both are deliberately absent from Simple Icons for that reason), and
 * redrawing a logo by hand is a worse answer than not showing one. Naming a
 * competitor in running text is ordinary nominative use, which is what the
 * comparison section of this page already does.
 */
/**
 * Hexes are the brands' published values, not colours picked by eye:
 *   Slack    #4A154B  slack.com/brand-guidelines
 *   Teams    #6264A7  developer.microsoft.com Fluent UI palette
 *   WhatsApp #25D366  about.meta.com/brand/resources/whatsapp
 *
 * Email is not a brand and has no owner to be faithful to, so it takes the blue
 * already in MarkLayer's own cursor palette rather than borrowing a mail
 * client's identity for the generic case.
 */
const CHANNELS = [
  // The first word is the headline as it ships prerendered — see home-copy.json.
  { name: copy.headlineChannel, color: '#3B82F6' },
  { name: 'Slack', color: '#4A154B' },
  { name: 'Teams', color: '#6264A7' },
  // The one substitution: WhatsApp's published green measures 1.9:1 on white,
  // under the 3:1 floor for large text, so the headline would be hard to read in
  // it. #128C7E is the darker green from the same WhatsApp palette and clears
  // the floor. Their primary is used nowhere it would be illegible.
  { name: 'WhatsApp', color: '#128C7E' },
] as const;

const HOLD_MS = 2000;
const OUT_MS = 220;
const IN_MS = 420;
const STAGGER_MS = 24;
const OUT_EASE = 'cubic-bezier(0.4, 0, 1, 1)';
// A mild "back" overshoot standing in for spring physics — WAAPI has no spring
// timing function, and at the scale of one letter's travel a bezier that
// overshoots past 1 and settles reads close enough to one.
const IN_EASE = 'cubic-bezier(0.34, 1.56, 0.64, 1)';
const MAX_CHARS = Math.max(...CHANNELS.map((c) => c.name.length));

const EXIT_FRAMES: Keyframe[] = [
  { transform: 'translateY(0)', opacity: 1 },
  { transform: 'translateY(-0.5em)', opacity: 0 },
];
const ENTER_FRAMES: Keyframe[] = [
  { transform: 'translateY(0.5em)', opacity: 0 },
  { transform: 'translateY(0)', opacity: 1 },
];

/** The one way this file reaches the per-letter spans. */
function letterEls(container: Element | null): HTMLElement[] {
  return Array.from(container?.children ?? []).filter((c): c is HTMLElement => c instanceof HTMLElement);
}

/**
 * Rolls every letter through `keyframes` on its own STAGGER_MS offset, settling
 * once the last one lands. The directions differ only in `fill`: an exit holds
 * its end state so a letter stays hidden until the word swaps, an entrance
 * holds its start state so a late letter never flashes at rest before its turn.
 */
function rollLetters({
  els,
  keyframes,
  duration,
  easing,
  fill,
}: {
  els: HTMLElement[];
  keyframes: Keyframe[];
  duration: number;
  easing: string;
  fill: FillMode;
}) {
  return Promise.all(
    els.map((el, i) =>
      el.animate(keyframes, { duration, delay: i * STAGGER_MS, easing, fill }).finished.catch(() => {}),
    ),
  );
}

/**
 * Swaps the channel word inside the hero headline on a loop, one letter at a
 * time rather than as a block: each character exits and enters on its own
 * clock, offset by STAGGER_MS, so the word ripples instead of sliding as a
 * single unit.
 *
 * Only the active word is ever in the DOM, so the rendered <h1> reads as one
 * clean sentence for a crawler that executes JS.
 *
 * Each word's width is measured once and the slot is sized to the *current*
 * word, gliding between them as they swap. Reserving the widest word instead
 * (a single min-width) left "Slack" floating in a box cut for "WhatsApp", with
 * a visible gulf either side of the short words.
 *
 * The first word is the real headline text, so if the effects never run (or
 * reduced motion is set) this renders exactly the headline that shipped before.
 */
export function ChannelCycle() {
  const wordRef = useRef<HTMLSpanElement>(null);
  const [index, setIndex] = useState(0);
  const [widths, setWidths] = useState<number[] | null>(null);
  const mounted = useRef(false);

  useLayoutEffect(() => {
    const el = wordRef.current;
    if (!el) return;
    const cs = getComputedStyle(el);
    const probe = document.createElement('span');
    // Copy the metrics that actually decide advance width. The `font` shorthand
    // is unreliable here because the headline sets tracking separately.
    Object.assign(probe.style, {
      position: 'absolute',
      visibility: 'hidden',
      whiteSpace: 'pre',
      pointerEvents: 'none',
      fontFamily: cs.fontFamily,
      fontSize: cs.fontSize,
      fontWeight: cs.fontWeight,
      fontStyle: cs.fontStyle,
      letterSpacing: cs.letterSpacing,
    });
    el.parentElement?.appendChild(probe);
    const measured = CHANNELS.map((channel) => {
      probe.textContent = channel.name;
      return Math.ceil(probe.getBoundingClientRect().width);
    });
    probe.remove();
    setWidths(measured);
  }, []);

  // Plays the per-letter entrance whenever the word changes. Skipped on
  // mount — the first channel ships as static prerendered text, so it must
  // never be seen animating in.
  useLayoutEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    if (prefersReducedMotion()) return;
    rollLetters({
      els: letterEls(wordRef.current),
      keyframes: ENTER_FRAMES,
      duration: IN_MS,
      easing: IN_EASE,
      fill: 'backwards',
    });
  }, [index]);

  useEffect(() => {
    if (prefersReducedMotion()) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const schedule = () => {
      timer = setTimeout(tick, HOLD_MS);
    };

    const tick = async () => {
      const els = letterEls(wordRef.current);
      if (cancelled || els.length === 0) return;
      // Awaiting every letter out — not racing a timer — is what keeps the swap
      // below from ever landing mid-fade. The entrance effect above takes over
      // once the new word is in the DOM.
      await rollLetters({ els, keyframes: EXIT_FRAMES, duration: OUT_MS, easing: OUT_EASE, fill: 'forwards' });
      if (cancelled) return;
      setIndex((i) => (i + 1) % CHANNELS.length);
      schedule();
    };

    schedule();

    return () => {
      cancelled = true;
      clearTimeout(timer);
      for (const el of letterEls(wordRef.current)) for (const a of el.getAnimations()) a.cancel();
    };
  }, []);

  return (
    /* No overflow clip. Clipping the slot to the line box sheared the descenders
       off "WhatsApp" flat at the baseline, because a glyph's ink extends past the
       box its rect reports. The travel below is short enough, and fades out far
       enough, that nothing needs to be cut. */
    <span
      class="relative mx-[0.05em] inline-flex justify-center align-bottom isolate"
      style={
        widths === null
          ? undefined
          : {
              width: `${widths[index]}px`,
              // Timed to the longest word's full entrance (last letter's delay
              // plus its own duration), not the current word's, so the box
              // never has to outrun a longer word cutting in after a shorter one.
              transition: `width ${IN_MS + (MAX_CHARS - 1) * STAGGER_MS}ms cubic-bezier(0.16, 1, 0.3, 1)`,
            }
      }
    >
      {/* The highlighter wash. It carries the channel's brand colour and sits on
          the slot rather than on the word, so it holds its place through the
          stretch every letter spends at zero opacity mid-swap — the headline
          reads as a highlight whose word is changing, never as a hole.

          The colour swaps with the text, which happens while the word is
          invisible, so it is never seen cross-fading between two brands. */}
      <span class="lp-mark-hl" style={{ color: CHANNELS[index].color }} aria-hidden="true" />
      {/* White on the wash — a marked-up text selection. The word carried the
          brand colour itself at first, which put the hue on a wash of itself and
          cost most of the contrast; then it carried the headline's ink, which
          read as flat. White clears the large-text floor on all four channels
          and lets the brand colour stay the loud part, which is where an
          annotation's colour belongs. */}
      {/* aria-hidden: split into one span per letter, this would otherwise be
          read out spelled ("S l a c k") instead of as the word. The sr-only
          span carries the real accessible name instead. */}
      <span ref={wordRef} class="inline-flex items-baseline text-white" aria-hidden="true">
        {/* Keyed by cycle, not by position: every swap mounts fresh spans, which
            is what lets the exit hold `fill: 'forwards'` and never be cancelled
            — the letters it froze are gone before the new word paints. */}
        {CHANNELS[index].name.split('').map((ch, i) => (
          <span key={`${index}-${i}`} class="inline-block">
            {ch}
          </span>
        ))}
      </span>
      <span class="sr-only">{CHANNELS[index].name}</span>
    </span>
  );
}
