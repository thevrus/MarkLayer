import { describe, expect, test } from 'bun:test';
import type { AnnotationOp, CommentOp } from '@marklayer/types/ops';
import { callTool, classifyOp, type RoomOps, TOOLS } from './index';

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
    readOnlyByChoice: false,
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
    listOps: () => [comment()],
    setNextSteps: (steps) => {
      calls.push(`steps:${steps.length}`);
      return { ids: steps.map((_, i) => `step-${i}`) };
    },
    setStepDone: ({ id, done }) => {
      calls.push(`step:${id}:${done}`);
      return true;
    },
    ask: () => ({ id: 'q-1' }),
  };
  return { ...base, ...over, calls };
}

const run = (name: string, args: unknown, room: RoomOps = fakeRoom()) =>
  callTool({
    name,
    args,
    room,
    apiBase: 'https://marklayer.app',
    createPreview: async () => ({ error: 'no preview here' }),
  });

const body = (result: Awaited<ReturnType<typeof run>>) => JSON.parse(result?.content[0]?.text ?? '{}');

describe('callTool', () => {
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

  test('a read-only session refuses writes before they reach an editable room, and still reads', async () => {
    const room = fakeRoom({ readOnlyByChoice: true });
    const refused = await run('marklayer_resolve', { id: 'op-1', summary: 'done' }, room);
    expect(body(refused).error).toContain('started read-only');
    expect(room.calls).toEqual([]);
    expect((await run('marklayer_list_annotations', {}, room))?.isError).toBeFalsy();
  });

  test('reports a refused write on a writable link as a missing annotation', async () => {
    const room = fakeRoom({ acknowledge: () => false });
    const result = await run('marklayer_acknowledge', { id: 'op-1' }, room);
    expect(result?.isError).toBe(true);
    expect(body(result).error).toBe('annotation not found: op-1');
  });

  const rects = [{ x: 0, y: 0, width: 1, height: 1 }];

  test.each<[string, unknown]>([
    ['marklayer_watch_annotations', {}],
    ['marklayer_acknowledge', { id: 'op-1' }],
    ['marklayer_resolve', { id: 'op-1' }],
    ['marklayer_dismiss', { id: 'op-1', reason: 'not actionable' }],
    ['marklayer_reply', { id: 'op-1', text: 'hi' }],
    ['marklayer_create_annotation', { text: 'hi', x: 0, y: 0 }],
    ['marklayer_suggest_edit', { text: 'Continue', suggestion: 'Next', rects }],
    ['marklayer_set_next_steps', { steps: [{ text: 'Fix it' }] }],
    ['marklayer_complete_next_step', { id: 'step-1' }],
    ['marklayer_ask', { prompt: 'Ship?', options: ['yes', 'no'] }],
  ])('%s refuses a connection that cannot carry it', async (name, args) => {
    const room = fakeRoom({ checkLive: () => 'socket closed' });
    expect(body(await run(name, args, room)).error).toBe('socket closed');
    expect(room.calls).toEqual([]);
  });

  test.each<[string, unknown]>([
    ['marklayer_read_page', {}],
    ['marklayer_room_info', {}],
    ['marklayer_list_annotations', {}],
    ['marklayer_get_annotation', { id: 'op-1' }],
    ['marklayer_get_feedback', {}],
  ])('%s still answers from what a dead connection left behind', async (name, args) => {
    const page = { url: 'https://example.com', title: null, entries: [], clientRendered: false, truncated: false };
    const room = fakeRoom({ checkLive: () => 'socket closed', readPage: async () => page });
    expect((await run(name, args, room))?.isError).toBeUndefined();
  });

  test('answers an acknowledge with the status it moved the thread to', async () => {
    expect(body(await run('marklayer_acknowledge', { id: 'op-1' })).status).toBe('in_progress');
  });

  // A pending promise is truthy, so an unawaited refusal reads as success. The Worker's room answers over RPC.
  test.each<[string, unknown, Partial<RoomOps>]>([
    ['marklayer_acknowledge', { id: 'op-1' }, { acknowledge: async () => false }],
    ['marklayer_resolve', { id: 'op-1' }, { resolve: async () => false }],
    ['marklayer_dismiss', { id: 'op-1', reason: 'not actionable' }, { dismiss: async () => false }],
    ['marklayer_reply', { id: 'op-1', text: 'hi' }, { reply: async () => false }],
  ])('%s reports a refusal that arrives asynchronously', async (name, args, over) => {
    expect((await run(name, args, fakeRoom(over)))?.isError).toBe(true);
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
      { selector: '#a', tag: 'button', markdown: '`<button>`', offsetX: 0, offsetY: 0 },
      undefined,
    ]);
    // A selector stands in for coordinates, and the pin then sits on the element; without one both are required.
    const anchored = { text: 'hi', selector: '#a', tag: 'button', markdown: '`<button>`' };
    expect(body(await run('marklayer_create_annotation', anchored, room)).id).toBe('new-1');
    expect(created.at(-1)?.target).toMatchObject({ offsetX: 0, offsetY: 0 });
    expect((await run('marklayer_create_annotation', { text: 'hi' }, room))?.isError).toBe(true);
    expect((await run('marklayer_create_annotation', { text: 'hi', x: 1 }, room))?.isError).toBe(true);
  });

  // Counted as "given" by the triple check, then dropped as falsy: the result is an unanchored pin at 0,0.
  test.each(['selector', 'tag', 'markdown'])(
    'P12 refuses an empty %s instead of pinning at the origin',
    async (key) => {
      const created: unknown[] = [];
      const room = fakeRoom({
        create: (a) => {
          created.push(a);
          return { id: 'new-1' };
        },
      });
      const empty = { text: 'hi', selector: '#a', tag: 'button', markdown: '`<button>`', [key]: '' };
      expect((await run('marklayer_create_annotation', empty, room))?.isError).toBe(true);
      expect(created).toEqual([]);
    },
  );

  test('P103 refuses a whitespace-only suggestion rather than storing it raw', async () => {
    const blank = { text: 'Continue', suggestion: '   ', rects: [{ x: 0, y: 0, width: 1, height: 1 }] };
    expect((await run('marklayer_suggest_edit', blank))?.isError).toBe(true);
  });

  test('P103 hands the room a trimmed suggestion', async () => {
    const suggested: string[] = [];
    const room = fakeRoom({
      suggestEdit: (a) => {
        suggested.push(a.suggestion);
        return { id: 'new-2' };
      },
    });
    const padded = { text: 'Continue', suggestion: '  Next  ', rects: [{ x: 0, y: 0, width: 1, height: 1 }] };
    await run('marklayer_suggest_edit', padded, room);
    expect(suggested).toEqual(['Next']);
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

  // A step linked to an id that is not there renders a link to nothing in front of the reviewers.
  test('refuses next steps that point at annotations the room does not have', async () => {
    const room = fakeRoom();
    const result = await run(
      'marklayer_set_next_steps',
      { steps: [{ text: 'Fix it', annotationIds: ['ghost'] }] },
      room,
    );
    expect(body(result).error).toContain('ghost');
    expect(room.calls).toEqual([]);
  });

  test('says a step is missing rather than patching nothing', async () => {
    const room = fakeRoom();
    expect((await run('marklayer_complete_next_step', { id: 'nope' }, room))?.isError).toBe(true);
    expect(room.calls).toEqual([]);
  });
});

describe('marklayer_share_preview', () => {
  const create = (args: unknown) => {
    const asked: unknown[] = [];
    const result = callTool({
      name: 'marklayer_share_preview',
      args,
      room: null,
      apiBase: 'https://marklayer.app',
      createPreview: async (request) => {
        asked.push(request);
        return { id: 'r1', url: 'https://marklayer.app/s/r1', version: 1, previous: null };
      },
    });
    return { result, asked };
  };

  test('needs no room, and hands back the link and where to reconnect', async () => {
    const { result } = create({ url: 'https://preview.example.com', title: 'x' });
    expect(body(await result)).toMatchObject({
      url: 'https://marklayer.app/s/r1',
      mcpUrl: 'https://marklayer.app/s/r1/mcp',
      previous: null,
    });
  });

  // The URL is framed for every reviewer who opens the link; only a web page belongs there.
  test('refuses a preview url that is not http(s)', async () => {
    const { result, asked } = create({ url: 'javascript:alert(1)', title: 'x' });
    expect((await result)?.isError).toBe(true);
    expect(asked).toEqual([]);
  });

  test('refuses a poll with a single option', async () => {
    const { result, asked } = create({
      url: 'https://preview.example.com',
      title: 'x',
      questions: [{ prompt: 'Ship?', options: ['yes'] }],
    });
    expect((await result)?.isError).toBe(true);
    expect(asked).toEqual([]);
  });
});

describe('with no room connected', () => {
  const noRoom = (name: string) =>
    callTool({
      name,
      args: {},
      room: null,
      apiBase: 'https://marklayer.app',
      createPreview: async () => ({ error: 'unused' }),
    });

  const roomless = ['marklayer_connect_room', 'marklayer_share_preview'];

  test.each(TOOLS.map((tool) => tool.name).filter((name) => !roomless.includes(name)))(
    '%s says how to get one',
    async (name) => {
      expect((await noRoom(name))?.content[0]?.text).toContain('marklayer_connect_room');
    },
  );

  test.each(['marklayer_connect_room', 'marklayer_nonsense'])('%s stays the caller’s to answer', async (name) => {
    expect(await noRoom(name)).toBeNull();
  });
});
