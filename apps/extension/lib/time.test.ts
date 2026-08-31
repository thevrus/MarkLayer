import { describe, expect, test } from 'bun:test';
import { timeAgo } from './time';

// Mirrors the formatter, not the unit-selection logic that is actually under
// test - so these assertions pin "which unit, rounded how" without hard-coding
// ICU's narrow strings, which differ between runtimes.
const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto', style: 'narrow' });
const expected = (value: number, unit: Intl.RelativeTimeFormatUnit) => rtf.format(value, unit);

const ago = (seconds: number) => timeAgo(Date.now() - seconds * 1000);

describe('timeAgo', () => {
  test('picks the largest unit the gap fills', () => {
    expect(ago(5)).toBe(expected(-5, 'second'));
    expect(ago(200)).toBe(expected(-3, 'minute'));
    expect(ago(60 * 60 * 3)).toBe(expected(-3, 'hour'));
    expect(ago(86_400 * 2)).toBe(expected(-2, 'day'));
    expect(ago(86_400 * 10)).toBe(expected(-1, 'week'));
    expect(ago(86_400 * 60)).toBe(expected(-2, 'month'));
    expect(ago(86_400 * 400)).toBe(expected(-1, 'year'));
  });

  test('falls through to seconds rather than returning nothing for a fresh timestamp', () => {
    // `second` is the loop's terminal unit, so a sub-second gap must still format.
    expect(ago(0)).toBe(expected(0, 'second'));
  });

  test('formats a future timestamp forwards', () => {
    expect(timeAgo(Date.now() + 120_000)).toBe(expected(2, 'minute'));
  });

  test('rounds a half-unit gap toward zero in the past and away from it in the future', () => {
    // `Math.round` breaks ties toward +Infinity, so 90 seconds either side of now
    // is not symmetric: 1 minute ago, but in 2 minutes.
    expect(ago(90)).toBe(expected(-1, 'minute'));
    expect(timeAgo(Date.now() + 90_000)).toBe(expected(2, 'minute'));
  });
});
