import { describe, expect, it } from 'bun:test';
import { fromPageFraction, toPageFraction } from './docAnchor';

// A page box offset from the viewport origin, so a dropped `left`/`top` term
// shows up rather than cancelling against zero.
const box = { left: 40, top: 100, width: 800, height: 1000 };

describe('document page fractions', () => {
  it('normalises a point against the page box, not the viewport', () => {
    expect(toPageFraction({ box, clientX: 440, clientY: 600 })).toEqual({ x: 0.5, y: 0.5 });
    expect(toPageFraction({ box, clientX: 40, clientY: 100 })).toEqual({ x: 0, y: 0 });
  });

  it('round-trips through a page rendered at a different size', () => {
    const anchor = { page: 3, ...toPageFraction({ box, clientX: 240, clientY: 350 }) };
    // Same page, redrawn at half scale somewhere else on screen.
    const zoomed = { left: 10, top: 20, width: 400, height: 500 };
    expect(fromPageFraction({ box: zoomed, anchor })).toEqual({ x: 110, y: 145 });
  });

  it('keeps a point outside the page box as an out-of-range fraction', () => {
    // Callers pick the nearest page for gutter clicks; the fraction must stay
    // signed so the mark lands above the page rather than clamped onto it.
    expect(toPageFraction({ box, clientX: 440, clientY: 50 }).y).toBeLessThan(0);
  });
});
