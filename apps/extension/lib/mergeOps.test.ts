import { describe, expect, test } from 'bun:test';
import type { DrawOp } from '@marklayer/types';
import { mergeOps } from './mergeOps';

const op = (id: string, text = id): DrawOp => ({
  id,
  color: '#000',
  lineWidth: 2,
  tool: 'text',
  text,
  x: 0,
  y: 0,
  fontSize: 14,
});

describe('mergeOps', () => {
  test('keeps every local-only op and adds every remote-only op', () => {
    const local = [op('local-1'), op('local-2')];
    const remote = [op('remote-1')];
    expect(mergeOps({ local, remote })).toEqual([op('remote-1'), op('local-1'), op('local-2')]);
  });

  // Two browsers touched the same op and only one version survives. The room is the
  // shared source of truth, so the remote copy wins — not whichever side merges last.
  test('dedupes a shared id, keeping the remote copy even when its content differs', () => {
    const local = [op('shared', 'local edit')];
    const remote = [op('shared', 'remote edit')];
    expect(mergeOps({ local, remote })).toEqual([op('shared', 'remote edit')]);
  });

  test('orders remote ops first in their own order, then local-only ops appended after in theirs', () => {
    // Matches the reconnect merge, so a full reload and a resync agree on op order.
    const local = [op('local-1'), op('shared'), op('local-2')];
    const remote = [op('remote-1'), op('shared', 'remote wins'), op('remote-2')];
    expect(mergeOps({ local, remote })).toEqual([
      op('remote-1'),
      op('shared', 'remote wins'),
      op('remote-2'),
      op('local-1'),
      op('local-2'),
    ]);
  });

  test('returns the remote list untouched when there is no local work', () => {
    const remote = [op('a'), op('b')];
    expect(mergeOps({ local: [], remote })).toEqual(remote);
  });

  test('appends every local op, in order, when the remote room is empty', () => {
    const local = [op('a'), op('b')];
    expect(mergeOps({ local, remote: [] })).toEqual(local);
  });
});
