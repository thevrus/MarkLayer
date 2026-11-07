import { afterEach, describe, expect, mock, test } from 'bun:test';
import type { DrawOp } from '@marklayer/types/ops';

// No IndexedDB in the test DOM, and every write to `operations` schedules a draft save.
mock.module('idb-keyval', () => ({
  createStore: () => ({}),
  get: async () => undefined,
  set: async () => {},
  del: async () => {},
}));

const { localUser } = await import('./identity');
const { operations, toggleOpReaction } = await import('./ops');

const comment: DrawOp = {
  id: 'c1',
  color: '#000',
  lineWidth: 2,
  tool: 'comment',
  num: 1,
  text: 'hi',
  x: 0,
  y: 0,
  ts: 1,
};

afterEach(() => {
  operations.value = [];
});

describe('toggleOpReaction', () => {
  test('the first reaction lands on an op that has never had one', () => {
    operations.value = [comment];
    toggleOpReaction({ opId: 'c1', emoji: '👍' });
    const op = operations.value[0];
    expect(op && 'reactions' in op ? op.reactions : null).toEqual([
      { emoji: '👍', id: localUser.id, name: localUser.name },
    ]);
  });

  test('toggling again takes it off', () => {
    operations.value = [comment];
    toggleOpReaction({ opId: 'c1', emoji: '👍' });
    toggleOpReaction({ opId: 'c1', emoji: '👍' });
    const op = operations.value[0];
    expect(op && 'reactions' in op ? op.reactions : null).toEqual([]);
  });
});
