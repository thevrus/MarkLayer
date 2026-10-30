import { describe, expect, test } from 'bun:test';
import { dragRect } from './area-rect';

const base = { sx: 100, sy: 100, shift: false, alt: false };

describe('dragRect', () => {
  test('plain drag spans start to pointer in any direction', () => {
    expect(dragRect({ ...base, px: 60, py: 130 })).toEqual({ x: 60, y: 100, w: 40, h: 30 });
  });

  test('alt mirrors the box around the press point', () => {
    expect(dragRect({ ...base, px: 60, py: 130, alt: true })).toEqual({ x: 60, y: 70, w: 80, h: 60 });
  });

  test('shift locks a square from the corner', () => {
    expect(dragRect({ ...base, px: 140, py: 110, shift: true })).toEqual({ x: 100, y: 100, w: 40, h: 40 });
  });

  test('alt+shift is a square centred on the press point', () => {
    expect(dragRect({ ...base, px: 140, py: 110, shift: true, alt: true })).toEqual({ x: 60, y: 60, w: 80, h: 80 });
  });
});
