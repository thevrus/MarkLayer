import { describe, expect, mock, test } from 'bun:test';
import type { CommentOp } from '@marklayer/types';

mock.module('idb-keyval', () => ({
  createStore: () => ({}),
  get: async () => undefined,
  set: async () => {},
  del: async () => {},
}));
const { agentFix } = await import('./checkFix');

const op = (over: Partial<CommentOp>): CommentOp => ({
  id: 'c',
  tool: 'comment',
  color: '#000',
  lineWidth: 2,
  ts: 1,
  num: 1,
  text: 'x',
  x: 0,
  y: 0,
  ...over,
});
const agentReply = op({
  id: 'r',
  parentId: 'c',
  author: 'claude-code',
  assignedAgent: 'claude-code',
  text: 'Fixed it',
});

describe('agentFix', () => {
  test('a resolved thread whose last word is the agent is a fix to check', () => {
    expect(agentFix({ op: op({ status: 'resolved' }), replies: [agentReply] })).toEqual({
      agent: 'Claude',
      summary: 'Fixed it',
    });
  });

  test('a person replying after the agent means nothing is left to check', () => {
    const human = op({ id: 'h', parentId: 'c', author: 'Ada' });
    expect(agentFix({ op: op({ status: 'resolved' }), replies: [agentReply, human] })).toBeNull();
  });

  test('a person resolving their own thread is not an agent fix', () => {
    expect(agentFix({ op: op({ status: 'resolved' }), replies: [op({ parentId: 'c', author: 'Ada' })] })).toBeNull();
  });

  test('an approved thread is already checked', () => {
    expect(agentFix({ op: op({ status: 'approved' }), replies: [agentReply] })).toBeNull();
  });
});
