import { describe, expect, test } from 'bun:test';
import { isAgentAuthored } from '@marklayer/types/agents';
import { type CommentOp, type DrawOp, drawOpSchema } from '@marklayer/types/ops';
import type { ClientMsg, ServerMsg } from '@marklayer/types/wire';
import { RoomCore, type RoomTransport } from './room-core';

const AGENT = 'claude-code';

const comment = (over: Partial<CommentOp> = {}): CommentOp => ({
  id: 'c1',
  tool: 'comment',
  num: 1,
  text: 'the label is vague',
  x: 10,
  y: 20,
  color: '#000',
  lineWidth: 3,
  ts: 1,
  author: 'Ada',
  ...over,
});

/** A socket's shape: `apply` is fed by hand, and `wait` hands over a script of arrivals, then sits out its window. */
function room({ canSend = true, arrivals = [] as ServerMsg[][] } = {}) {
  const sent: ClientMsg[] = [];
  let id = 0;
  const transport: RoomTransport = {
    send: (msg) => {
      sent.push(msg);
      return canSend;
    },
    wait: async (ms) => {
      const next = arrivals.shift();
      if (next) return next;
      await Bun.sleep(ms);
      return [];
    },
    readPage: async (url) => (url ? { url, title: null, entries: [], clientRendered: false, truncated: false } : null),
  };
  const core = new RoomCore({ roomId: 'r1', agentId: AGENT, session: 's1', transport, newId: () => `id-${++id}` });
  return { core, sent };
}

const loaded = (ops: DrawOp[], over: { canEdit?: boolean; arrivals?: ServerMsg[][]; canSend?: boolean } = {}) => {
  const made = room(over);
  made.core.apply({ type: 'init', ops, url: 'https://example.com', canEdit: over.canEdit });
  return made;
};

const assign = (assignee: string | null): ServerMsg => ({ type: 'update_op', opId: 'c1', patch: { assignee } });
const quickly = { timeoutSeconds: 0.05, batchMs: 1 };

describe('RoomCore.watch', () => {
  test('returns a participant teaching control through the existing watch stream', async () => {
    const { core } = loaded([], {
      arrivals: [[{ type: 'teach_control', presentationId: 'demo-1', action: 'next', peerId: 'human-1' }]],
    });
    expect(await core.watch(quickly)).toEqual([
      {
        kind: 'teach_control',
        control: { type: 'teach_control', presentationId: 'demo-1', action: 'next', peerId: 'human-1' },
      },
    ]);
  });
  test('queue changes wake a watcher with cancellation state for its agent', async () => {
    const { core } = loaded([]);
    core.apply({ type: 'collaboration', claims: [], tasks: [{ sequence: 1, id: 't1', room_id: 'room', agent_id: AGENT, requester_id: 'u', requester_name: 'User', layer_id: 'default', annotation_id: 'c1', source_id: 'c1', status: 'cancel_requested', waiting_for: null, created_at: 1 }] });
    expect(await core.watch(quickly)).toEqual([expect.objectContaining({ kind: 'task_update', tasks: [expect.objectContaining({ id: 't1', status: 'cancel_requested' })] })]);
  });

  test('a person assigning the agent is a handoff, once', async () => {
    const { core } = loaded([comment()], { arrivals: [[assign(AGENT)]] });
    const events = await core.watch(quickly);
    expect(events.map((e) => `${e.kind}:${e.kind === 'teach_control' ? e.control.presentationId : e.kind === 'task_update' ? 'tasks' : e.op.id}`)).toEqual([
      'handoff:c1',
    ]);
    core.apply({ type: 'update_op', opId: 'c1', patch: { status: 'in_progress' } });
    expect(await core.watch(quickly)).toEqual([]);
  });

  test('assigning someone else wakes nobody', async () => {
    const { core } = loaded([comment()], { arrivals: [[assign('Grace')]] });
    expect(await core.watch(quickly)).toEqual([]);
  });

  test('P99 what lands while no watch is parked reaches the next one', async () => {
    const { core } = loaded([comment()]);
    core.apply(assign(AGENT));
    core.apply({ type: 'op', op: comment({ id: 'c2' }) });
    expect((await core.watch(quickly)).map((e) => e.kind)).toEqual(['handoff', 'new']);
    expect(await core.watch(quickly)).toEqual([]);
  });

  test('P98 gathers a burst into one batch, however the transport delivers it', async () => {
    const first: ServerMsg = { type: 'op', op: comment({ id: 'c2' }) };
    const second: ServerMsg = { type: 'op', op: comment({ id: 'c3' }) };
    const { core } = loaded([], { arrivals: [[first], [second]] });
    const events = await core.watch({ timeoutSeconds: 5, batchMs: 20 });
    expect(events.map((e) => (e.kind === 'teach_control' ? e.control.presentationId : e.kind === 'task_update' ? 'tasks' : e.op.id))).toEqual(['c2', 'c3']);
  });

  test('answers as soon as the batch window closes, not at the timeout', async () => {
    const { core } = loaded([], { arrivals: [[{ type: 'op', op: comment({ id: 'c2' }) }]] });
    const started = Date.now();
    await core.watch({ timeoutSeconds: 5, batchMs: 5 });
    expect(Date.now() - started).toBeLessThan(1000);
  });

  test('refuses a second watcher, then frees the slot', async () => {
    const { core } = loaded([]);
    const parked = core.watch(quickly);
    await expect(core.watch(quickly)).rejects.toThrow('already in progress');
    await parked;
    expect(await core.watch(quickly)).toEqual([]);
  });

  test('the room echoing an agent its own op is not new work', async () => {
    const { core } = loaded([]);
    const created = await core.create({ text: 'mine', x: 1, y: 2 });
    const echo = core.listOps().find((op) => op.id === created?.id);
    if (!echo) throw new Error('create recorded nothing');
    core.apply({ type: 'op', op: echo });
    expect(await core.watch(quickly)).toEqual([]);
    expect(core.listOps()).toHaveLength(1);
  });
});

describe('RoomCore writes', () => {
  test('a read-only participant can start, step and end a transient presentation', async () => {
    const { core, sent } = loaded([], { canEdit: false });
    const started = await core.teachStart({ steps: ['first', 'second'] });
    expect(started).not.toBeNull();
    const presentationId = started?.presentationId ?? '';
    expect(await core.teachStep({ presentationId, index: 0, caption: '说明', selector: '#save' })).toBe(true);
    expect(await core.teachEnd(presentationId)).toBe(true);
    expect(sent).toEqual([
      { type: 'teach_state', presentationId, state: 'active', step: 0, total: 2 },
      { type: 'teach_highlight', presentationId, selector: '#save' },
      { type: 'teach_caption', presentationId, text: '说明', step: 0 },
      { type: 'teach_state', presentationId, state: 'ended' },
    ]);
  });
  test('a view-only room is refused locally, so no read lies about what the human sees', async () => {
    const { core, sent } = loaded([comment()], { canEdit: false });
    expect(await core.create({ text: 'x', x: 0, y: 0 })).toBeNull();
    expect(await core.acknowledge('c1')).toBe(false);
    expect(sent).toEqual([]);
    expect(core.viewOnly).toBe(true);
  });

  test('a write that races an access flip latches read-only', async () => {
    const { core } = loaded([comment()]);
    core.apply({ type: 'error', code: 'read_only' });
    expect(await core.reply('c1', 'x')).toBe(false);
  });

  test('a send the transport refused is not recorded', async () => {
    const { core } = loaded([], { canSend: false });
    expect(await core.create({ text: 'x', x: 0, y: 0 })).toBeNull();
    expect(core.listOps()).toEqual([]);
  });

  test('a patch for an op the room does not hold never leaves', async () => {
    const { core, sent } = loaded([comment()]);
    expect(await core.acknowledge('missing')).toBe(false);
    expect(sent).toEqual([]);
  });

  test('a reply lands on any annotation kind, at its anchor, on the parent stroke', async () => {
    const area: DrawOp = {
      id: 'a1',
      layerId: 'review',
      tool: 'area',
      color: '#000',
      lineWidth: 5,
      startX: 40,
      startY: 50,
      endX: 10,
      endY: 20,
      ts: 1,
    };
    const { core, sent } = loaded([comment(), area]);
    expect(await core.reply('a1', 'on it')).toBe(true);
    expect(sent[0]).toMatchObject({
      type: 'op',
      op: { parentId: 'a1', layerId: 'review', x: 10, y: 20, lineWidth: 5, num: 2, author: AGENT, assignedAgent: AGENT },
    });
  });

  test('a reply cannot be replied to', async () => {
    const { core, sent } = loaded([comment(), comment({ id: 'r1', parentId: 'c1' })]);
    expect(await core.reply('r1', 'x')).toBe(false);
    expect(sent).toEqual([]);
  });

  test('numbers a comment off the roots, not off every op', async () => {
    const { core, sent } = loaded([comment(), comment({ id: 'r1', parentId: 'c1' })]);
    await core.create({ text: 'x', x: 0, y: 0 });
    expect(sent[0]).toMatchObject({ op: { num: 2 } });
  });

  test('P6 every op an agent writes carries the one signature, through the schema', async () => {
    const { core, sent } = loaded([]);
    await core.create({ text: 'x', x: 0, y: 0 });
    await core.ask({ prompt: 'Ship?', options: ['yes', 'no'] });
    await core.setNextSteps([{ text: 'Rename the CTA' }]);
    const stored = sent.flatMap((msg) => (msg.type === 'op' ? [drawOpSchema.parse(msg.op)] : []));
    expect(stored.map((op) => op.tool)).toEqual(['comment', 'question', 'step']);
    expect(stored.every((op) => 'author' in op && isAgentAuthored(op))).toBe(true);
  });

  test('replacing the checklist undoes the old steps first', async () => {
    const { core, sent } = loaded([]);
    const first = await core.setNextSteps([{ text: 'One' }]);
    await core.setNextSteps([{ text: 'Two' }]);
    expect(sent[1]).toEqual({ type: 'undo', opId: first?.ids[0] ?? '' });
    expect(core.listOps().map((op) => op.tool === 'step' && op.text)).toEqual(['Two']);
  });

  test('D6 resolving writes the status, and posts the summary first', async () => {
    const { core, sent } = loaded([comment()]);
    expect(await core.resolve('c1', 'renamed it')).toBe(true);
    expect(sent.map((msg) => msg.type)).toEqual(['op', 'update_op']);
    expect(sent[1]).toEqual({ type: 'update_op', opId: 'c1', patch: { status: 'resolved' } });
  });
});

describe('RoomCore state', () => {
  test('says how much of the room it could not read', () => {
    const { core } = room();
    core.apply({ type: 'init', ops: [comment(), { tool: 'hologram' }] });
    expect(core.listOps()).toHaveLength(1);
    expect(core.getMeta().unreadableOps).toBe(1);
  });

  test('a fully readable room says nothing about it', () => {
    expect('unreadableOps' in loaded([comment()]).core.getMeta()).toBe(false);
  });

  test('a read of the page takes the url from the room', async () => {
    expect((await loaded([]).core.readPage())?.url).toBe('https://example.com');
  });

  test('D4 the peer id separates sessions of one agent', () => {
    expect(room().core.peerId).toBe('mcp-claude-code-s1');
  });

  test('lists roots by status, and gives replies with their thread', () => {
    const { core } = loaded([
      comment({ status: 'resolved' }),
      comment({ id: 'c2' }),
      comment({ id: 'r1', parentId: 'c2' }),
    ]);
    expect(core.listAnnotations({ status: 'open' }).map((op) => op.id)).toEqual(['c2']);
    expect(core.getAnnotation('c2')?.replies.map((op) => op.id)).toEqual(['r1']);
  });

  test('forgets what the room forgot', () => {
    const { core } = loaded([comment()]);
    core.apply({ type: 'undo', opId: 'c1' });
    expect(core.listOps()).toEqual([]);
  });
});


test('room info follows initial and broadcast execution mode', () => {
  const { core } = room();
  core.apply({ type: 'init', ops: [], execMode: 'guide' });
  expect(core.getMeta().execMode).toBe('guide');
  core.apply({ type: 'exec_mode', execMode: 'pair' });
  expect(core.getMeta().execMode).toBe('pair');
});

