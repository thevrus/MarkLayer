import { describe, expect, test } from 'bun:test';
import type { AnnotationOp, CommentOp } from '@marklayer/types';
import { callRoomTool, classifyOp, describedSchema, type RoomOps } from './index';

const comment = (over: Partial<CommentOp> = {}): CommentOp => ({
  id: 'op-1',
  tool: 'comment',
  num: 1,
  text: 'the button label is vague',
  x: 10,
  y: 20,
  color: '#D97757',
  lineWidth: 2,
  ts: 1_700_000_000_000,
  ...over,
});

/** A room that records what it was asked to do, so the dispatch is what is under test. */
function fakeRoom(over: Partial<RoomOps> = {}): RoomOps & { calls: string[] } {
  const calls: string[] = [];
  const base: RoomOps = {
    roomId: 'room-1',
    viewOnly: false,
    getMeta: () => ({ url: 'https://example.com', width: 1280, createdAt: 1, expiresAt: null }),
    checkLive: () => null,
    listAnnotations: () => [comment()],
    getAnnotation: (id) => (id === 'op-1' ? { op: comment(), replies: [] } : null),
    watch: async () => [],
    acknowledge: (id) => {
      calls.push(`ack:${id}`);
      return true;
    },
    resolve: (id) => {
      calls.push(`resolve:${id}`);
      return true;
    },
    dismiss: (id) => {
      calls.push(`dismiss:${id}`);
      return true;
    },
    reply: (id) => {
      calls.push(`reply:${id}`);
      return true;
    },
    readPage: async () => null,
    create: () => ({ id: 'new-1' }),
    suggestEdit: () => ({ id: 'new-2' }),
  };
  return { ...base, ...over, calls };
}

const run = (name: string, args: unknown, room: RoomOps = fakeRoom()) =>
  callRoomTool({ name, args, room, apiBase: 'https://marklayer.app' });

const body = (result: Awaited<ReturnType<typeof run>>) => JSON.parse(result?.content[0]?.text ?? '{}');

describe('callRoomTool', () => {
  test('leaves a name it does not own to the caller', async () => {
    expect(await run('marklayer_connect_room', { room: 'x' })).toBeNull();
    expect(await run('nonsense', {})).toBeNull();
  });

  test('reports a bad argument instead of acting on it', async () => {
    const room = fakeRoom();
    const result = await run('marklayer_acknowledge', { id: '' }, room);
    expect(result?.isError).toBe(true);
    expect(room.calls).toEqual([]);
  });

  test('projects annotations through one shape', async () => {
    const listed = body(await run('marklayer_list_annotations', {}));
    expect(listed.count).toBe(1);
    expect(listed.annotations[0]).toMatchObject({ id: 'op-1', kind: 'comment', status: 'open' });
  });

  test('says an id is missing rather than failing silently', async () => {
    const result = await run('marklayer_get_annotation', { id: 'nope' });
    expect(result?.isError).toBe(true);
    expect(body(result).error).toContain('nope');
  });

  test('names the view-only link when that is why a write failed', async () => {
    const room = fakeRoom({ viewOnly: true, acknowledge: () => false });
    const result = await run('marklayer_acknowledge', { id: 'op-1' }, room);
    expect(body(result).error).toContain('view-only');
  });

  test('reports a refused write on a writable link as a missing annotation', async () => {
    const room = fakeRoom({ acknowledge: () => false });
    const result = await run('marklayer_acknowledge', { id: 'op-1' }, room);
    expect(result?.isError).toBe(true);
    expect(body(result).error).toBe('annotation not found: op-1');
  });

  test('refuses to act on a connection that cannot carry the write', async () => {
    const room = fakeRoom({ checkLive: () => 'socket closed' });
    const result = await run('marklayer_reply', { id: 'op-1', text: 'hi' }, room);
    expect(body(result).error).toBe('socket closed');
    expect(room.calls).toEqual([]);
  });

  test('awaits a mutation that answers asynchronously', async () => {
    const room = fakeRoom({ acknowledge: async () => true });
    expect(body(await run('marklayer_acknowledge', { id: 'op-1' }, room)).status).toBe('in_progress');
  });

  test('carries the reply that handed a thread over, as the instruction', async () => {
    const parent = comment({ id: 'op-9' });
    const reply = comment({ id: 'r-1', parentId: 'op-9', text: 'yes, do that', author: 'Sleepy Wombat' });
    const room = fakeRoom({ watch: async () => [{ kind: 'handoff', op: parent as AnnotationOp, reply }] });
    const events = body(await run('marklayer_watch_annotations', {}, room)).events;
    expect(events[0].kind).toBe('handoff');
    expect(events[0].request).toEqual({ from: 'Sleepy Wombat', text: 'yes, do that' });
  });

  test('omits the request on an annotation nobody handed over', async () => {
    const room = fakeRoom({ watch: async () => [{ kind: 'new', op: comment() as AnnotationOp }] });
    const events = body(await run('marklayer_watch_annotations', {}, room)).events;
    expect(events[0].kind).toBe('new');
    expect('request' in events[0]).toBe(false);
  });

  test('rejects a suggestion that changes nothing', async () => {
    const same = { text: 'Continue', suggestion: 'Continue', rects: [{ x: 0, y: 0, width: 1, height: 1 }] };
    expect((await run('marklayer_suggest_edit', same))?.isError).toBe(true);
  });

  test('takes the element triple all or none', async () => {
    const created: Parameters<RoomOps['create']>[0][] = [];
    const room = fakeRoom({
      create: (a) => {
        created.push(a);
        return { id: 'new-1' };
      },
    });
    const partial = { text: 'hi', x: 0, y: 0, selector: '#a' };
    expect((await run('marklayer_create_annotation', partial, room))?.isError).toBe(true);
    const whole = { text: 'hi', x: 0, y: 0, selector: '#a', tag: 'button', markdown: '`<button>`' };
    expect(body(await run('marklayer_create_annotation', whole, room)).id).toBe('new-1');
    await run('marklayer_create_annotation', { text: 'hi', x: 0, y: 0 }, room);
    expect(created.map((a) => a.target)).toEqual([
      { selector: '#a', tag: 'button', markdown: '`<button>`' },
      undefined,
    ]);
  });
});

describe('classifyOp', () => {
  const AGENT = 'claude-code';
  const agentThread = comment({ id: 'mine', author: AGENT });
  const humanThread = comment({ id: 'theirs', author: 'Grace' });
  const ops = [agentThread, humanThread];
  const reply = (over: Partial<CommentOp>) => comment({ id: 'r-1', author: 'Ada', text: 'yes, do that', ...over });

  const cases: { name: string; op: CommentOp; want: 'new' | 'handoff' | null; parent?: CommentOp }[] = [
    {
      name: 'a reply on the agent’s own thread hands it over',
      op: reply({ parentId: 'mine' }),
      want: 'handoff',
      parent: agentThread,
    },
    { name: 'the agent’s own reply does not wake it', op: reply({ parentId: 'mine', author: AGENT }), want: null },
    {
      name: 'a reply that @mentions the agent on someone else’s thread hands it over',
      op: reply({ parentId: 'theirs', mentions: [{ id: AGENT, name: 'Claude' }] }),
      want: 'handoff',
      parent: humanThread,
    },
    {
      name: 'a mention matches on id, not on the display name',
      op: reply({ parentId: 'theirs', mentions: [{ id: 'someone-else', name: AGENT }] }),
      want: null,
    },
    { name: 'two people talking under a human thread reach nobody', op: reply({ parentId: 'theirs' }), want: null },
    { name: 'a reply to a thread the room does not hold is ignored', op: reply({ parentId: 'gone' }), want: null },
    { name: 'a new root comment is new work', op: comment({ id: 'fresh', author: 'Ada' }), want: 'new' },
  ];

  for (const c of cases) {
    test(c.name, () => {
      const event = classifyOp({ op: c.op, ops: [...ops, c.op], agentId: AGENT });
      if (c.want === null) return expect(event).toBeNull();
      expect(event?.kind).toBe(c.want);
      if (c.want === 'new') return expect(event?.op.id).toBe(c.op.id);
      expect(event?.op.id).toBe(c.parent?.id);
      expect(event?.reply?.id).toBe(c.op.id);
    });
  }
});

describe('describedSchema', () => {
  test('advertises the tool’s own schema, and accepts what the dispatch will check', () => {
    const json = { type: 'object' as const, properties: { id: { type: 'string' } } };
    const schema = describedSchema(json);
    expect(schema['~standard'].jsonSchema.input()).toEqual(json);
    expect(schema['~standard'].validate({ anything: true })).toEqual({ value: { anything: true } });
  });
});

describe('marklayer_read_page', () => {
  const page = {
    url: 'https://example.com',
    title: 'Pets',
    entries: [{ selector: '#root > h1:nth-of-type(1)', tag: 'h1', text: 'Your pets', markdown: '`<h1>` Your pets' }],
    truncated: false,
  };

  test('hands back entries shaped for the write tools', async () => {
    const room = fakeRoom({ readPage: async () => ({ ...page, clientRendered: false }) });
    const read = body(await run('marklayer_read_page', {}, room));
    expect(read.entries[0]).toMatchObject({ selector: '#root > h1:nth-of-type(1)', tag: 'h1', text: 'Your pets' });
    expect(read.note).toBeUndefined();
  });

  test('warns rather than lets an agent audit an empty shell', async () => {
    const room = fakeRoom({ readPage: async () => ({ ...page, entries: [], clientRendered: true }) });
    expect(body(await run('marklayer_read_page', {}, room)).note).toContain('renders client-side');
  });

  test('reports an unreadable page instead of returning nothing', async () => {
    const room = fakeRoom({ readPage: async () => null });
    expect((await run('marklayer_read_page', {}, room))?.isError).toBe(true);
  });
});
