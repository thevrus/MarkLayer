import { describe, expect, test } from 'bun:test';
import type { AnnotationOp, CommentOp } from '@marklayer/types';
import { callRoomTool, describedSchema, type RoomOps } from './index';

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
    const partial = { text: 'hi', x: 0, y: 0, selector: '#a' };
    expect((await run('marklayer_create_annotation', partial))?.isError).toBe(true);
    const whole = { text: 'hi', x: 0, y: 0, selector: '#a', tag: 'button', markdown: '`<button>`' };
    expect(body(await run('marklayer_create_annotation', whole)).id).toBe('new-1');
  });
});

describe('describedSchema', () => {
  test('advertises the tool’s own schema, and accepts what the dispatch will check', () => {
    const json = { type: 'object' as const, properties: { id: { type: 'string' } } };
    const schema = describedSchema(json);
    expect(schema['~standard'].jsonSchema.input()).toEqual(json);
    expect(schema['~standard'].validate({ anything: true })).toEqual({ value: { anything: true } });
  });
});
