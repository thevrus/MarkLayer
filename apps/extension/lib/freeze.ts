import { signal } from '@preact/signals';

/**
 * Pause-the-page utility for inspection workflows. While frozen:
 *  • CSS animations on the document are paused via `animation-play-state: paused`.
 *  • WAAPI animations targeting page elements are `.pause()`d (and resumed on thaw).
 *  • Currently-playing `<video>` / `<audio>` elements are paused (not auto-resumed —
 *    surprising the user with sound on thaw is worse than making them click play).
 *
 * Animations rooted in our extension's shadow DOM (the toolbar / panels) are skipped.
 * Document-level CSS doesn't pierce shadow boundaries, so the CSS rule is safe by
 * default; the WAAPI loop filters explicitly because `document.getAnimations()`
 * returns animations across the whole document tree, shadow trees included.
 *
 * Both the host document and the web-preview iframe document can be frozen
 * independently — `freezeDocument` / `thawDocument` are document-scoped, and
 * each context tracks the animations it paused so thaw resumes only what it
 * paused (instead of waking up animations that were already idle).
 */

export const animationsFrozen = signal(false);

const STYLE_ID = 'ml-freeze-animations';
const FREEZE_CSS = '*, *::before, *::after { animation-play-state: paused !important; }';

const frozenContexts = new WeakMap<Document, Animation[]>();

function isExtensionAnimation(anim: Animation): boolean {
  const target = (anim.effect as KeyframeEffect | null)?.target;
  if (!(target instanceof Element)) return false;
  const root = target.getRootNode();
  if (root instanceof ShadowRoot && root.host?.tagName === 'MARK-LAYER') return true;
  if (target.tagName === 'MARK-LAYER') return true;
  return !!target.closest?.('mark-layer');
}

export function freezeDocument(doc: Document) {
  if (frozenContexts.has(doc)) return;
  if (doc.head && !doc.getElementById(STYLE_ID)) {
    const s = doc.createElement('style');
    s.id = STYLE_ID;
    s.textContent = FREEZE_CSS;
    doc.head.appendChild(s);
  }

  const paused: Animation[] = [];
  for (const anim of doc.getAnimations()) {
    if (isExtensionAnimation(anim)) continue;
    if (anim.playState !== 'running') continue;
    try {
      anim.pause();
      paused.push(anim);
    } catch {
      /* animation may have finished between getAnimations() and pause() */
    }
  }

  for (const m of doc.querySelectorAll<HTMLMediaElement>('video, audio')) {
    if (!m.paused) m.pause();
  }

  frozenContexts.set(doc, paused);
}

export function thawDocument(doc: Document) {
  const paused = frozenContexts.get(doc);
  if (!paused) return;
  doc.getElementById(STYLE_ID)?.remove();
  for (const anim of paused) {
    try {
      anim.play();
    } catch {
      /* animation may have been removed while frozen */
    }
  }
  frozenContexts.delete(doc);
}

export function toggleAnimationsFrozen() {
  const next = !animationsFrozen.value;
  animationsFrozen.value = next;
  if (next) freezeDocument(document);
  else thawDocument(document);
}
