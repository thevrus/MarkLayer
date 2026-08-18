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
const OUT_MS = 260;
const IN_MS = 340;

/**
 * Swaps the channel word inside the hero headline on a loop.
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

  useEffect(() => {
    if (prefersReducedMotion()) return;
    let cancelled = false;

    const tick = async () => {
      const el = wordRef.current;
      if (!el || cancelled) return;
      // Roll out, swap the text while it is invisible, roll back in. Awaiting
      // the exit rather than racing it on a timer is what keeps the swap from
      // ever being visible mid-fade.
      const out = el.animate(
        [
          { transform: 'translateY(0)', opacity: 1 },
          { transform: 'translateY(-0.38em)', opacity: 0 },
        ],
        { duration: OUT_MS, easing: 'cubic-bezier(0.4, 0, 1, 1)', fill: 'forwards' },
      );
      await out.finished.catch(() => {});
      if (cancelled || !wordRef.current) return;
      setIndex((i) => (i + 1) % CHANNELS.length);
      out.cancel();
      el.animate(
        [
          { transform: 'translateY(0.38em)', opacity: 0 },
          { transform: 'translateY(0)', opacity: 1 },
        ],
        { duration: IN_MS, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
      );
    };

    const id = setInterval(tick, HOLD_MS + OUT_MS + IN_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
      for (const a of wordRef.current?.getAnimations() ?? []) a.cancel();
    };
  }, []);

  return (
    /* No overflow clip. Clipping the slot to the line box sheared the descenders
       off "WhatsApp" flat at the baseline, because a glyph's ink extends past the
       box its rect reports. The travel below is short enough, and fades out far
       enough, that nothing needs to be cut. */
    <span
      class="inline-flex justify-center align-bottom"
      style={
        widths === null
          ? undefined
          : {
              width: `${widths[index]}px`,
              // Glides while the word itself is mid-swap, so "Thread." slides
              // rather than jumping the instant the text changes.
              transition: `width ${OUT_MS + IN_MS}ms cubic-bezier(0.16, 1, 0.3, 1)`,
            }
      }
    >
      {/* The colour swaps with the text, which happens while the word is at
          zero opacity, so it is never seen cross-fading between two brands. */}
      <span
        ref={wordRef}
        class="inline-block whitespace-pre will-change-transform"
        style={{ color: CHANNELS[index].color }}
      >
        {CHANNELS[index].name}
      </span>
    </span>
  );
}
