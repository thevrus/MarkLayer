import { beforeEach, describe, expect, test } from 'bun:test';
import { animationsFrozen, freezeDocument, thawDocument, toggleAnimationsFrozen } from './freeze';

/**
 * happy-dom implements neither `getAnimations` nor WAAPI, so the animations are
 * stood in for. What is under test is the filtering and the paused-set
 * bookkeeping, which is where a leak leaves the page stuck.
 */
interface FakeAnimation {
  playState: string;
  effect: { target: Element | null } | null;
  pause: () => void;
  play: () => void;
  paused: number;
  played: number;
}

const animation = ({
  target,
  playState = 'running',
}: {
  target: Element | null;
  playState?: string;
}): FakeAnimation => {
  const a: FakeAnimation = {
    playState,
    effect: { target },
    paused: 0,
    played: 0,
    pause() {
      a.paused++;
      a.playState = 'paused';
    },
    play() {
      a.played++;
      a.playState = 'running';
    },
  };
  return a;
};

const stubAnimations = (doc: Document, anims: FakeAnimation[]) =>
  Object.defineProperty(doc, 'getAnimations', { value: () => anims, configurable: true });

const pick = (selector: string): Element => {
  const el = document.querySelector(selector);
  if (!el) throw new Error(`fixture missing ${selector}`);
  return el;
};

beforeEach(() => {
  thawDocument(document);
  animationsFrozen.value = false;
  for (const style of document.head.querySelectorAll('#ml-freeze-animations')) style.remove();
  document.body.innerHTML = '<main><p id="page">x</p></main><mark-layer><button id="tool"></button></mark-layer>';
  stubAnimations(document, []);
});

describe('freezeDocument', () => {
  test('injects the pause rule with a stable id', () => {
    freezeDocument(document);
    const style = document.getElementById('ml-freeze-animations');
    expect(style?.textContent).toContain('animation-play-state: paused !important');
  });

  test('pauses page animations and resumes exactly those on thaw', () => {
    const page = animation({ target: pick('#page') });
    stubAnimations(document, [page]);

    freezeDocument(document);
    expect(page.paused).toBe(1);

    thawDocument(document);
    expect(page.played).toBe(1);
    expect(document.getElementById('ml-freeze-animations')).toBeNull();
  });

  test('leaves our own toolbar animations running', () => {
    // `getAnimations` reaches across the whole document tree, so the filter is
    // the only thing keeping the extension UI alive while the page is frozen.
    const ours = animation({ target: pick('#tool') });
    const theirs = animation({ target: pick('#page') });
    stubAnimations(document, [ours, theirs]);

    freezeDocument(document);
    expect(ours.paused).toBe(0);
    expect(theirs.paused).toBe(1);
  });

  test('skips the extension host element itself', () => {
    const host = animation({ target: pick('mark-layer') });
    stubAnimations(document, [host]);
    freezeDocument(document);
    expect(host.paused).toBe(0);
  });

  test('never wakes an animation that was already idle', () => {
    // Resuming everything on thaw would start animations the page had finished.
    const idle = animation({ target: pick('#page'), playState: 'finished' });
    stubAnimations(document, [idle]);

    freezeDocument(document);
    thawDocument(document);
    expect(idle.paused).toBe(0);
    expect(idle.played).toBe(0);
  });

  test('ignores an animation with no element target', () => {
    const orphan = animation({ target: null });
    stubAnimations(document, [orphan]);
    expect(() => freezeDocument(document)).not.toThrow();
  });

  test('survives an animation that finishes between listing and pausing', () => {
    const racing = animation({ target: pick('#page') });
    racing.pause = () => {
      throw new Error('animation removed');
    };
    stubAnimations(document, [racing]);
    expect(() => freezeDocument(document)).not.toThrow();

    thawDocument(document);
    // It never got paused, so thaw must not try to play it either.
    expect(racing.played).toBe(0);
  });

  test('pauses playing media and leaves already-paused media alone', () => {
    document.body.innerHTML = '<video id="playing"></video><audio id="quiet"></audio>';
    const playing = pick('#playing');
    const quiet = pick('#quiet');
    let pausedPlaying = 0;
    let pausedQuiet = 0;
    Object.defineProperty(playing, 'paused', { value: false, configurable: true });
    Object.defineProperty(playing, 'pause', { value: () => pausedPlaying++, configurable: true });
    Object.defineProperty(quiet, 'paused', { value: true, configurable: true });
    Object.defineProperty(quiet, 'pause', { value: () => pausedQuiet++, configurable: true });

    freezeDocument(document);
    expect(pausedPlaying).toBe(1);
    expect(pausedQuiet).toBe(0);
  });

  test('does not re-freeze a document it already froze', () => {
    // A second pass would overwrite the paused set and lose what to resume.
    const page = animation({ target: pick('#page') });
    stubAnimations(document, [page]);

    freezeDocument(document);
    stubAnimations(document, [page, animation({ target: pick('#page') })]);
    freezeDocument(document);
    expect(page.paused).toBe(1);
  });
});

describe('thawDocument', () => {
  test('does nothing for a document that was never frozen', () => {
    expect(() => thawDocument(document)).not.toThrow();
  });

  test('survives an animation removed while the page was frozen', () => {
    const page = animation({ target: pick('#page') });
    stubAnimations(document, [page]);
    freezeDocument(document);
    page.play = () => {
      throw new Error('gone');
    };
    expect(() => thawDocument(document)).not.toThrow();
    // The style still comes off, or the page stays visually paused forever.
    expect(document.getElementById('ml-freeze-animations')).toBeNull();
  });

  test('is idempotent, so a second thaw does not replay the animations', () => {
    const page = animation({ target: pick('#page') });
    stubAnimations(document, [page]);
    freezeDocument(document);
    thawDocument(document);
    thawDocument(document);
    expect(page.played).toBe(1);
  });
});

describe('toggleAnimationsFrozen', () => {
  test('drives the flag and the document together', () => {
    toggleAnimationsFrozen();
    expect(animationsFrozen.value).toBe(true);
    expect(document.getElementById('ml-freeze-animations')).not.toBeNull();

    toggleAnimationsFrozen();
    expect(animationsFrozen.value).toBe(false);
    expect(document.getElementById('ml-freeze-animations')).toBeNull();
  });
});
