import { afterEach, describe, expect, test } from 'bun:test';
import type { DrawOp } from '@marklayer/types/ops';
import { applyChange, onChange, operations, pushOp, undo, undoStack } from './ops';
import { canEditFromRoom, forcedReadonly } from './session-rights';

const mark = (id: string): DrawOp => ({
  id,
  tool: 'pen',
  color: '#000',
  lineWidth: 2,
  compositeOperation: 'source-over',
  points: [{ x: 0, y: 0 }],
});

describe('a view-only session', () => {
  const sent: string[] = [];
  onChange.value = (change) => sent.push(change.type);

  afterEach(() => {
    canEditFromRoom.value = undefined;
    forcedReadonly.value = false;
    operations.value = [];
    undoStack.value = [];
    sent.length = 0;
  });

  // The room refuses it anyway; shown here first, it would sit on screen as if it landed.
  test('never shows or sends its own mark', () => {
    canEditFromRoom.value = false;
    expect(pushOp(mark('m1'))).toBe('refused');
    expect(operations.value).toEqual([]);
    expect(sent).toEqual([]);
  });

  test('still takes in what peers draw', () => {
    canEditFromRoom.value = false;
    // ops.ts remembers peer mark ids for the whole run: reusing another file's id makes its ⌘Z skip that mark.
    expect(applyChange({ type: 'op', op: mark('peer') }, { origin: 'remote' })).toBe(true);
    expect(operations.value.map((op) => op.id)).toEqual(['peer']);
  });

  test('held by the host stays view-only when the room says it may edit', () => {
    forcedReadonly.value = true;
    canEditFromRoom.value = true;
    expect(pushOp(mark('m1'))).toBe('refused');
  });

  test('keeps a refused undo off the redo stack', () => {
    pushOp(mark('m1'));
    canEditFromRoom.value = false;
    undo();
    expect(operations.value.map((op) => op.id)).toEqual(['m1']);
    expect(undoStack.value).toEqual([]);
  });
});
