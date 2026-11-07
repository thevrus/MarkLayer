import { describe, expect, test } from 'bun:test';
import { captureSelection } from './selection-capture';

type Rect = { x: number; y: number; width: number; height: number };

/** The shape of a Selection the capture reads, with each range's client rects chosen by the test. */
function selection(ranges: Rect[][]): Selection {
  const fake = {
    isCollapsed: false,
    rangeCount: ranges.length,
    toString: () => 'picked text',
    getRangeAt: (i: number) => ({
      getClientRects: () => ranges[i] ?? [],
      commonAncestorContainer: document.body,
    }),
  };
  // @ts-expect-error a stand-in for the four members the capture reads
  return fake;
}

const rect = (x: number): Rect => ({ x, y: 0, width: 10, height: 10 });

describe('captureSelection', () => {
  test('a trailing range with no rects still leaves a place for the popover', () => {
    const captured = captureSelection({ sel: selection([[rect(1), rect(2)], []]) });
    expect(captured?.last).toMatchObject({ x: 2 });
    expect(captured?.rects).toHaveLength(2);
  });

  test('a selection with no rects at all is nothing to annotate', () => {
    expect(captureSelection({ sel: selection([[]]) })).toBeNull();
  });

  test('a rect the mapping refuses is skipped, not placed at the origin', () => {
    const captured = captureSelection({
      sel: selection([[rect(1), rect(2)]]),
      toRect: (cr) => (cr.x === 2 ? null : { x: cr.x, y: cr.y, width: cr.width, height: cr.height }),
    });
    expect(captured?.rects).toHaveLength(1);
    expect(captured?.last).toMatchObject({ x: 1 });
  });
});
