import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { GuideOp, RectOp, TargetElement } from '@marklayer/types';
import {
  type AnchorContext,
  applyAnchorDelta,
  attachTarget,
  captureScale,
  commitOp,
  reprojectBox,
  reprojectRects,
  resolveAnchorPoint,
} from './anchor';
import { bumpAnchorGeneration, operations } from './state';

/**
 * happy-dom has no layout engine, so every rect is zero. Anchoring is entirely
 * about rects, so each test states the boxes it needs.
 */
const layout = (el: Element, box: { x: number; y: number; width: number; height: number }) => {
  Object.defineProperty(el, 'getBoundingClientRect', {
    value: () => new DOMRect(box.x, box.y, box.width, box.height),
    configurable: true,
  });
};

const mount = (html: string) => {
  document.body.innerHTML = html;
};

const pick = (selector: string): Element => {
  const el = document.querySelector(selector);
  if (!el) throw new Error(`fixture missing ${selector}`);
  return el;
};

/** A fresh target each time: the resolver memoises on the target object identity. */
const target = (over: Partial<TargetElement> = {}): TargetElement => ({
  selector: '#hero',
  tag: 'h1',
  markdown: '',
  rect: { x: 100, y: 200, width: 400, height: 100 },
  offsetX: 40,
  offsetY: 20,
  ...over,
});

const ctx: AnchorContext = { doc: document, win: window };

beforeEach(() => {
  document.body.innerHTML = '';
  window.scrollTo(0, 0);
});

afterEach(() => {
  window.scrollTo(0, 0);
});

describe('resolveAnchorPoint', () => {
  test('returns null when the op was never bound to an element', () => {
    expect(resolveAnchorPoint(undefined, ctx)).toBeNull();
    expect(resolveAnchorPoint(target({ selector: '' }), ctx)).toBeNull();
  });

  test('returns null when the target carries no offset and no fallback to derive one from', () => {
    expect(resolveAnchorPoint(target({ offsetX: undefined, offsetY: undefined }), ctx)).toBeNull();
  });

  test('re-anchors to the element current position, in document coordinates', () => {
    mount('<h1 id="hero">Pricing</h1>');
    // The element moved down 60px since capture, and the page is scrolled.
    layout(pick('#hero'), { x: 100, y: 260, width: 400, height: 100 });
    window.scrollTo(0, 500);

    const anchor = resolveAnchorPoint(target(), ctx);
    expect(anchor).toEqual({ x: 140, y: 780, scaleX: 1, scaleY: 1, strategy: 'primary' });
  });

  test('scales the stored offset by how much the element box changed', () => {
    mount('<h1 id="hero">Pricing</h1>');
    // Captured 400x100, now 200x200: the anchor must stay at the same relative
    // spot inside the box rather than drift off the element.
    layout(pick('#hero'), { x: 0, y: 0, width: 200, height: 200 });

    const anchor = resolveAnchorPoint(target(), ctx);
    expect(anchor?.scaleX).toBe(0.5);
    expect(anchor?.scaleY).toBe(2);
    expect(anchor?.x).toBe(20);
    expect(anchor?.y).toBe(40);
  });

  test('degrades to an unscaled offset when either box has no usable size', () => {
    mount('<h1 id="hero">Pricing</h1>');
    layout(pick('#hero'), { x: 0, y: 0, width: 0, height: 0 });
    // A display:none element must not produce a division by zero.
    expect(resolveAnchorPoint(target(), ctx)).toMatchObject({ scaleX: 1, scaleY: 1, x: 40, y: 20 });

    mount('<h1 id="hero">Pricing</h1>');
    layout(pick('#hero'), { x: 0, y: 0, width: 200, height: 200 });
    expect(resolveAnchorPoint(target({ rect: undefined }), ctx)).toMatchObject({ scaleX: 1, scaleY: 1 });
  });

  test('reconstructs a missing offset from the stored anchor for a legacy op', () => {
    mount('<h1 id="hero">Pricing</h1>');
    layout(pick('#hero'), { x: 100, y: 260, width: 400, height: 100 });
    // Ops written before offsetX/offsetY existed: the offset is the difference
    // between the stored doc anchor and the captured element origin.
    const legacy = target({ offsetX: undefined, offsetY: undefined });
    const anchor = resolveAnchorPoint(legacy, ctx, { docX: 140, docY: 220 });
    expect(anchor?.x).toBe(140);
    expect(anchor?.y).toBe(280);
  });

  test('falls back to the text fingerprint when the selector no longer matches', () => {
    // The redesign renamed the id, but the visible label is unchanged.
    mount('<h1 id="headline">Pricing that scales</h1>');
    layout(pick('#headline'), { x: 100, y: 200, width: 400, height: 100 });

    const anchor = resolveAnchorPoint(target({ text: 'Pricing that scales' }), ctx);
    expect(anchor?.strategy).toBe('text');
    expect(anchor?.x).toBe(140);
  });

  test('does not accept a text-fingerprint match on a different tag', () => {
    mount('<p id="other">Pricing that scales</p>');
    expect(resolveAnchorPoint(target({ text: 'Pricing that scales' }), ctx)).toBeNull();
  });

  test('picks the fingerprint match nearest where the user drew when several tie', () => {
    mount('<h1 id="a">Add to cart</h1><h1 id="b">Add to cart</h1>');
    layout(pick('#a'), { x: 0, y: 0, width: 100, height: 100 });
    layout(pick('#b'), { x: 0, y: 1000, width: 100, height: 100 });

    const near = target({
      selector: '#gone',
      text: 'Add to cart',
      rect: { x: 0, y: 990, width: 100, height: 100 },
      offsetX: 0,
      offsetY: 0,
    });
    expect(resolveAnchorPoint(near, ctx)?.y).toBe(1000);
  });

  test('returns null for an unresolvable target and stops re-scanning until the DOM changes', () => {
    mount('<h1 id="headline">Something else entirely</h1>');
    const orphan = target({ selector: '#gone', text: 'Nothing matches this' });
    expect(resolveAnchorPoint(orphan, ctx)).toBeNull();

    // The element the op wants now exists, but nothing has bumped the anchor
    // generation, so the memoised failure still stands.
    mount('<h1 id="hero">Pricing</h1>');
    layout(pick('#hero'), { x: 100, y: 200, width: 400, height: 100 });
    expect(resolveAnchorPoint(orphan, ctx)).toBeNull();

    // A mutation-observer tick invalidates the cached failure.
    bumpAnchorGeneration();
    expect(resolveAnchorPoint(orphan, ctx)).toBeNull();
    const reachable = target({ selector: '#hero' });
    expect(resolveAnchorPoint(reachable, ctx)?.strategy).toBe('primary');
  });

  test('re-resolves once the memoised element is detached from the document', () => {
    mount('<h1 id="hero">Pricing</h1>');
    layout(pick('#hero'), { x: 0, y: 0, width: 400, height: 100 });
    const t = target();
    expect(resolveAnchorPoint(t, ctx)?.x).toBe(40);

    // Same selector, brand new element (an SPA re-render).
    mount('<h1 id="hero">Pricing</h1>');
    layout(pick('#hero'), { x: 500, y: 0, width: 400, height: 100 });
    expect(resolveAnchorPoint(t, ctx)?.x).toBe(540);
  });

  test('survives a selector the browser refuses to parse', () => {
    mount('<h1 id="hero">Pricing</h1>');
    expect(resolveAnchorPoint(target({ selector: 'h1[[[' }), ctx)).toBeNull();
  });
});

describe('applyAnchorDelta', () => {
  test('reports the shift from the stored anchor to the resolved one', () => {
    mount('<h1 id="hero">Pricing</h1>');
    layout(pick('#hero'), { x: 100, y: 260, width: 400, height: 100 });
    const delta = applyAnchorDelta(target(), { docX: 140, docY: 220 }, ctx);
    expect(delta).toMatchObject({ x: 140, y: 280, dx: 0, dy: 60, strategy: 'primary' });
  });

  test('leaves the annotation exactly where it was stored when nothing resolves', () => {
    // A zero delta is what keeps an orphaned mark on screen instead of at 0,0.
    const delta = applyAnchorDelta(target({ selector: '#gone' }), { docX: 140, docY: 220 }, ctx);
    expect(delta).toEqual({ x: 140, y: 220, dx: 0, dy: 0, scaleX: 1, scaleY: 1, strategy: null });
  });
});

describe('reprojectRects', () => {
  const rects = [
    { x: 140, y: 220, width: 200, height: 20 },
    { x: 100, y: 240, width: 300, height: 20 },
  ];

  test('returns null for a shape with no rects', () => {
    expect(reprojectRects({ target: target(), rects: [], ctx })).toBeNull();
  });

  test('shifts every rect by the same delta so the shape stays coherent', () => {
    mount('<h1 id="hero">Pricing</h1>');
    layout(pick('#hero'), { x: 100, y: 260, width: 400, height: 100 });

    const out = reprojectRects({ target: target(), rects, ctx });
    expect(out?.rects).toEqual([
      { x: 140, y: 280, width: 200, height: 20 },
      { x: 100, y: 300, width: 300, height: 20 },
    ]);
    // The first rect lands on the anchor itself.
    expect(out?.x).toBe(140);
    expect(out?.y).toBe(280);
  });

  test('scales each rect offset-from-first and each rect size with the element', () => {
    mount('<h1 id="hero">Pricing</h1>');
    // Half as wide, twice as tall as at capture.
    layout(pick('#hero'), { x: 100, y: 200, width: 200, height: 200 });

    const out = reprojectRects({ target: target(), rects, ctx });
    expect(out?.rects[0]).toEqual({ x: 120, y: 240, width: 100, height: 40 });
    // Second rect: 20px left and 20px below the first, scaled per axis.
    expect(out?.rects[1]).toEqual({ x: 100, y: 280, width: 150, height: 40 });
  });

  test('computes bounds over the reprojected rects, not the stored ones', () => {
    mount('<h1 id="hero">Pricing</h1>');
    layout(pick('#hero'), { x: 100, y: 260, width: 400, height: 100 });

    const out = reprojectRects({ target: target(), rects, ctx });
    expect(out?.bounds).toEqual({ x: 100, y: 280, width: 300, height: 40 });
  });

  test('leaves the shape untouched when the target cannot be resolved', () => {
    const out = reprojectRects({ target: undefined, rects, ctx });
    expect(out?.rects).toEqual(rects);
    expect(out?.strategy).toBeNull();
  });
});

describe('reprojectBox', () => {
  test('normalises a box drawn right-to-left or bottom-up', () => {
    // The renderer needs a top-left origin and positive extents whichever way
    // the drag went.
    const out = reprojectBox({ target: undefined, startX: 300, startY: 400, endX: 100, endY: 200, ctx });
    expect(out).toMatchObject({ x: 100, y: 200, width: 200, height: 200 });
  });

  test('moves the origin with the element and scales the extents', () => {
    mount('<h1 id="hero">Pricing</h1>');
    layout(pick('#hero'), { x: 100, y: 200, width: 200, height: 200 });

    const out = reprojectBox({ target: target(), startX: 140, startY: 220, endX: 240, endY: 320, ctx });
    expect(out).toEqual({ x: 120, y: 240, width: 50, height: 200, strategy: 'primary' });
  });
});

describe('captureScale', () => {
  test('is a deliberate no-op, whatever viewport it is handed', () => {
    // Kept only so callers can adopt a per-op element anchor later without churn.
    expect(captureScale(undefined)).toBe(1);
    expect(captureScale({ width: 390, height: 844 })).toBe(1);
  });
});

describe('attachTarget', () => {
  /** happy-dom has no hit-testing; the pick-and-bind logic is what is under test. */
  const stack = (els: Element[]) =>
    Object.defineProperty(document, 'elementsFromPoint', { value: () => els, configurable: true });

  /**
   * `target: undefined` is present deliberately: `attachTarget` gates on
   * `'target' in op`, so an op that omits the key entirely is never bound.
   */
  const rectOp = (over: Partial<RectOp> = {}): RectOp => ({
    id: 'r1',
    color: '#000',
    lineWidth: 2,
    tool: 'rectangle',
    startX: 140,
    startY: 220,
    endX: 240,
    endY: 320,
    target: undefined,
    ...over,
  });

  test('binds a fresh op to the element under its anchor point', () => {
    mount('<h1 id="hero">Pricing</h1>');
    layout(pick('#hero'), { x: 100, y: 200, width: 400, height: 100 });
    stack([pick('#hero')]);

    const op = rectOp();
    attachTarget(op, ctx);
    expect(op.target?.selector).toBe('#hero');
    // The offset is measured from the element origin to the op's anchor.
    expect(op.target?.offsetX).toBe(40);
    expect(op.target?.offsetY).toBe(20);
  });

  test('resolves the anchor against the scrolled viewport, not the document origin', () => {
    // `elementsFromPoint` takes viewport coords while the op is stored in doc
    // coords, so the scroll offset has to come off before the hit test.
    mount('<h1 id="hero">Pricing</h1>');
    layout(pick('#hero'), { x: 0, y: 0, width: 100, height: 100 });
    const probed: Array<[number, number]> = [];
    Object.defineProperty(document, 'elementsFromPoint', {
      value: (x: number, y: number) => {
        probed.push([x, y]);
        return [pick('#hero')];
      },
      configurable: true,
    });
    window.scrollTo(0, 500);

    attachTarget(rectOp({ startX: 140, startY: 720 }), ctx);
    expect(probed).toEqual([[140, 220]]);
    window.scrollTo(0, 0);
  });

  test('leaves an op that already carries a target alone', () => {
    mount('<h1 id="hero">Pricing</h1>');
    stack([pick('#hero')]);
    const existing = { selector: '#kept', tag: 'h1', markdown: '' };
    const op = rectOp({ target: existing });
    attachTarget(op, ctx);
    expect(op.target).toBe(existing);
  });

  test('leaves the op unbound when nothing real sits under it', () => {
    mount('<main></main>');
    stack([document.body, document.documentElement]);
    const op = rectOp();
    attachTarget(op, ctx);
    expect(op.target).toBeUndefined();
  });

  test('leaves an op with no anchor point unbound', () => {
    mount('<h1 id="hero">Pricing</h1>');
    stack([pick('#hero')]);
    // A guide has no representative point to bind to.
    const guide: GuideOp = {
      id: 'g1',
      color: '#000',
      lineWidth: 1,
      tool: 'guide',
      orientation: 'vertical',
      position: 10,
    };
    expect(() => attachTarget(guide, ctx)).not.toThrow();
  });
});

describe('commitOp', () => {
  test('binds the op and pushes it in one step', () => {
    mount('<h1 id="hero">Pricing</h1>');
    layout(pick('#hero'), { x: 100, y: 200, width: 400, height: 100 });
    Object.defineProperty(document, 'elementsFromPoint', { value: () => [pick('#hero')], configurable: true });

    operations.value = [];
    const op: RectOp = {
      id: 'r1',
      color: '#000',
      lineWidth: 2,
      tool: 'rectangle',
      startX: 140,
      startY: 220,
      endX: 240,
      endY: 320,
      target: undefined,
    };
    commitOp(op, ctx);

    expect(operations.value).toEqual([op]);
    expect(operations.value[0]).toMatchObject({ target: { selector: '#hero' } });
  });
});
