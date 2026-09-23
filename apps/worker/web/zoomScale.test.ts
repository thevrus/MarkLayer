import { describe, expect, it } from 'bun:test';
import { nextLargeStop, notchToZoom, thumbNotch, ZOOM_NOTCHES, zoomStop, zoomToNotch } from './zoomScale';

const notches = Array.from({ length: ZOOM_NOTCHES * 2 + 1 }, (_, i) => i - ZOOM_NOTCHES);

describe('zoom scale', () => {
  it('round-trips every notch, each on a whole percent', () => {
    for (const n of notches) {
      expect(zoomToNotch(notchToZoom(n))).toBe(n);
      expect(Math.round(notchToZoom(n) * 100) / 100).toBe(notchToZoom(n));
    }
  });

  it('puts 100% at the centre and the old presets on the large steps', () => {
    expect([-10, -5, 0, 5, 10].map(notchToZoom)).toEqual([0.5, 0.75, 1, 1.5, 2]);
  });

  it('clamps a fit outside the scale to its ends for the thumb only', () => {
    expect(thumbNotch(0.4)).toBe(-ZOOM_NOTCHES);
    expect(zoomToNotch(0.4)).toBe(-12);
  });

  it('accepts a stored zoom only when it is a stop', () => {
    expect(zoomStop(0.85)).toBe(0.85);
    expect(zoomStop(0.751)).toBe(0.75);
    expect(zoomStop(0.72)).toBeNull();
    expect(zoomStop(3)).toBeNull();
    expect(zoomStop(Number('auto'))).toBeNull();
  });
});

describe('stepping between large stops', () => {
  it('leaves a stop rather than landing back on it', () => {
    for (const n of [-10, -5, 0, 5]) {
      expect(nextLargeStop({ from: notchToZoom(n), dir: 1 })).toBe(notchToZoom(n + 5));
      expect(nextLargeStop({ from: notchToZoom(-n), dir: -1 })).toBe(notchToZoom(-n - 5));
    }
  });

  it('snaps a zoom between stops to the neighbour in that direction', () => {
    expect(nextLargeStop({ from: 0.67, dir: 1 })).toBe(0.75);
    expect(nextLargeStop({ from: 0.67, dir: -1 })).toBe(0.5);
    expect(nextLargeStop({ from: 1.2, dir: 1 })).toBe(1.5);
  });

  it('stops at the ends, and steps onto the scale from a fit past them', () => {
    expect(nextLargeStop({ from: 2, dir: 1 })).toBeNull();
    expect(nextLargeStop({ from: 0.5, dir: -1 })).toBeNull();
    expect(nextLargeStop({ from: 0.1, dir: 1 })).toBe(0.5);
    expect(nextLargeStop({ from: 0.1, dir: -1 })).toBeNull();
  });
});
