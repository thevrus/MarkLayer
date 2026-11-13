import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { TargetElement } from '@marklayer/types/ops';
import { type AnchorContext, applyAnchorDelta, reprojectBox, reprojectRects, resolveAnchorPoint } from './anchor';
import { bumpAnchorGeneration } from './host-mutations';

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

  test('holds a failed lookup until the DOM changes, then finds the element', () => {
    mount('<h1 id="headline">Something else entirely</h1>');
    const orphan = target();
    expect(resolveAnchorPoint(orphan, ctx)).toBeNull();

    // The element the op wants now exists, but no mutation tick has announced it.
    mount('<h1 id="hero">Pricing</h1>');
    layout(pick('#hero'), { x: 100, y: 200, width: 400, height: 100 });
    expect(resolveAnchorPoint(orphan, ctx)).toBeNull();

    bumpAnchorGeneration();
    expect(resolveAnchorPoint(orphan, ctx)?.strategy).toBe('primary');
  });

  test('a failure against one document does not hold for the next', () => {
    // The web viewer's frame starts on about:blank, then swaps in the proxied
    // page with no mutation in between: a static page never bumps the generation.
    const blank = document.implementation.createHTMLDocument('');
    const t = target();
    expect(resolveAnchorPoint(t, { doc: blank, win: window })).toBeNull();

    mount('<h1 id="hero">Pricing</h1>');
    layout(pick('#hero'), { x: 100, y: 200, width: 400, height: 100 });
    expect(resolveAnchorPoint(t, ctx)?.strategy).toBe('primary');
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

describe('published pin under zoom', () => {
  test('A: keeps CSS coordinates at 100%, 125%, and 150% browser zoom', () => {
    mount('<h1 id="hero">Pricing</h1>');
    const el = pick('#hero');
    layout(el, { x: 100, y: 200, width: 200, height: 100 });
    const pin = target({
      rect: { x: 100, y: 200, width: 200, height: 100 },
      offsetX: 190,
      offsetY: 20,
    });
    const descriptor = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio');
    try {
      for (const devicePixelRatio of [1, 1.25, 1.5]) {
        Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: devicePixelRatio });
        expect(resolveAnchorPoint(pin, ctx)).toMatchObject({ x: 290, y: 220 });
      }
    } finally {
      if (descriptor) Object.defineProperty(window, 'devicePixelRatio', descriptor);
      else Reflect.deleteProperty(window, 'devicePixelRatio');
    }
  });

  test('scales a right-edge pin for a CSS transform, without treating it as reflow', () => {
    mount('<h1 id="hero" style="transform: scale(0.8)">Pricing</h1>');
    const el = pick('#hero');
    layout(el, { x: 100, y: 200, width: 160, height: 80 });
    Object.defineProperty(el, 'offsetWidth', { configurable: true, value: 200 });
    Object.defineProperty(el, 'offsetHeight', { configurable: true, value: 100 });
    const pin = target({ rect: { x: 100, y: 200, width: 200, height: 100 }, offsetX: 190, offsetY: 20 });
    expect(resolveAnchorPoint(pin, ctx)).toMatchObject({ x: 252, y: 216, scaleX: 0.8, scaleY: 0.8 });
  });

  test('does not apply an unchanged transform twice when capture was already scaled', () => {
    mount('<h1 id="hero" style="transform: scale(0.8)">Pricing</h1>');
    const el = pick('#hero');
    layout(el, { x: 100, y: 200, width: 160, height: 80 });
    Object.defineProperty(el, 'offsetWidth', { configurable: true, value: 200 });
    Object.defineProperty(el, 'offsetHeight', { configurable: true, value: 100 });
    const pin = target({ rect: { x: 100, y: 200, width: 160, height: 80 }, offsetX: 152, offsetY: 16 });
    expect(resolveAnchorPoint(pin, ctx)).toMatchObject({ x: 252, y: 216, scaleX: 1, scaleY: 1 });
  });

  test('keeps layout pin offsets bounded while reporting content scales', () => {
    mount('<h1 id="hero">Pricing</h1>');
    const el = pick('#hero');
    layout(el, { x: 100, y: 200, width: 160, height: 80 });
    Object.defineProperty(el, 'offsetWidth', { configurable: true, value: 160 });
    Object.defineProperty(el, 'offsetHeight', { configurable: true, value: 80 });
    const captured = { x: 100, y: 200, width: 200, height: 100 };
    expect(resolveAnchorPoint(target({ rect: captured, offsetX: 40, offsetY: 20 }), ctx)).toMatchObject({
      x: 140,
      y: 220,
      scaleX: 0.8,
      scaleY: 0.8,
    });
    expect(resolveAnchorPoint(target({ rect: captured, offsetX: 190, offsetY: 90 }), ctx)).toMatchObject({
      x: 260,
      y: 280,
      scaleX: 0.8,
      scaleY: 0.8,
    });
  });

  test('A: keeps adjacent 45% and 55% pins strictly ordered after contraction', () => {
    mount('<h1 id="hero">Pricing</h1>');
    const el = pick('#hero');
    layout(el, { x: 100, y: 200, width: 160, height: 80 });
    Object.defineProperty(el, 'offsetWidth', { configurable: true, value: 160 });
    Object.defineProperty(el, 'offsetHeight', { configurable: true, value: 80 });
    const captured = { x: 100, y: 200, width: 200, height: 100 };
    const at = (offsetX: number, offsetY: number) =>
      resolveAnchorPoint(target({ rect: captured, offsetX, offsetY }), ctx)!;
    const left = at(90, 45);
    const right = at(110, 55);
    expect(left.x).toBeLessThan(right.x);
    expect(left.y).toBeLessThan(right.y);
    expect(left).toMatchObject({ x: 190, y: 245 });
    expect(right).toMatchObject({ x: 210, y: 255 });
    const before = at(99.999, 49.999);
    const middle = at(100, 50);
    const after = at(100.001, 50.001);
    expect(middle.x - before.x).toBeCloseTo(0.001, 8);
    expect(after.x - middle.x).toBeCloseTo(0.001, 8);
    expect(middle.y - before.y).toBeCloseTo(0.001, 8);
    expect(after.y - middle.y).toBeCloseTo(0.001, 8);
    let previous = at(-1, -1);
    for (let offset = 0; offset <= 201; offset++) {
      const point = at(offset, offset / 2);
      expect(point.x).toBeGreaterThanOrEqual(previous.x);
      expect(point.y).toBeGreaterThanOrEqual(previous.y);
      expect(point.x).toBeGreaterThanOrEqual(100);
      expect(point.x).toBeLessThanOrEqual(260);
      expect(point.y).toBeGreaterThanOrEqual(200);
      expect(point.y).toBeLessThanOrEqual(280);
      previous = point;
    }
  });

  test('B: clamps a contracted pin to the right edge inside the box', () => {
    mount('<h1 id="hero" style="transform: none">Pricing</h1>');
    const el = pick('#hero');
    const box = { x: 100, y: 200, width: 200, height: 100 };
    layout(el, box);
    Object.defineProperty(el, 'offsetWidth', { configurable: true, get: () => box.width });
    Object.defineProperty(el, 'offsetHeight', { configurable: true, get: () => box.height });
    const pin = target({ rect: { ...box }, offsetX: 190, offsetY: 20 });
    expect(resolveAnchorPoint(pin, ctx)).toMatchObject({ x: 290, y: 220 });

    box.width = 160;
    const anchor = resolveAnchorPoint(pin, ctx)!;
    expect(anchor).toMatchObject({ x: 260, y: 220 });
    expect(anchor.x).toBeGreaterThanOrEqual(box.x);
    expect(anchor.x).toBeLessThanOrEqual(box.x + box.width);
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

describe('content extents under layout contraction', () => {
  test('scales rect extents and offsets-from-first with nonzero layout dimensions', () => {
    mount('<h1 id="hero">Pricing</h1>');
    const el = pick('#hero');
    layout(el, { x: 100, y: 200, width: 160, height: 80 });
    Object.defineProperty(el, 'offsetWidth', { configurable: true, value: 160 });
    Object.defineProperty(el, 'offsetHeight', { configurable: true, value: 80 });
    const t = target({ rect: { x: 100, y: 200, width: 200, height: 100 } });
    const out = reprojectRects({
      target: t,
      ctx,
      rects: [
        { x: 140, y: 220, width: 100, height: 20 },
        { x: 150, y: 250, width: 50, height: 10 },
      ],
    })!;
    expect(out.rects[0]).toEqual({ x: 140, y: 220, width: 80, height: 16 });
    expect(out.rects[1]).toEqual({ x: 148, y: 244, width: 40, height: 8 });
    expect(reprojectBox({ target: t, ctx, startX: 140, startY: 220, endX: 240, endY: 270 })).toEqual({
      x: 140,
      y: 220,
      width: 80,
      height: 40,
      strategy: 'primary',
    });
  });
});
