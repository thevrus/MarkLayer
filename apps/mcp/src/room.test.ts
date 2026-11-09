import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { callTool } from '@marklayer/agent-tools';
import { ROOM_LOCKED_CLOSE_CODE } from '@marklayer/types/wire';
import type { ServerWebSocket } from 'bun';
import { type ConnectedRoom, connectRoom } from './room';

const AGENT = 'claude-code';

const comment = (id: string) => ({
  id,
  tool: 'comment',
  num: 1,
  text: 'the button label is vague',
  x: 10,
  y: 20,
  color: '#D97757',
  lineWidth: 2,
  ts: 1_700_000_000_000,
  author: 'Ada',
});

/** What the fake room does when a peer joins; each test sets its own. */
let onOpen: (ws: ServerWebSocket<unknown>) => void = () => {};
let peer: ServerWebSocket<unknown> | null = null;
let joinedAt = '';
const received: { type?: string; opId?: string }[] = [];

const server = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  fetch(req, srv) {
    joinedAt = req.url;
    return srv.upgrade(req) ? undefined : new Response('upgrade required', { status: 426 });
  },
  websocket: {
    open(ws) {
      peer = ws;
      onOpen(ws);
    },
    message(_ws, data) {
      received.push(JSON.parse(String(data)));
    },
  },
});

const clients: ConnectedRoom[] = [];
const dial = () =>
  connectRoom({ apiBase: `http://127.0.0.1:${server.port}`, roomId: 'room-1', agentId: AGENT, initTimeoutMs: 200 });

async function connect(init: Record<string, unknown>): Promise<ConnectedRoom> {
  onOpen = (ws) => ws.send(JSON.stringify({ type: 'init', canEdit: true, ...init }));
  const client = await dial();
  clients.push(client);
  return client;
}

const toPeer = (msg: unknown) => peer?.send(JSON.stringify(msg));

async function until(cond: () => boolean, ms = 2000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error('condition never held');
    await Bun.sleep(5);
  }
}

afterEach(() => {
  for (const c of clients.splice(0)) c.close();
  received.length = 0;
  peer = null;
});

afterAll(() => {
  server.stop(true);
});

describe('connectRoom', () => {
  test('keeps the ops it can parse when one in the room is from a newer client', async () => {
    const { room } = await connect({ ops: [comment('op-1'), { id: 'z', tool: 'future-tool', ts: 1 }] });
    expect(room.listAnnotations().map((op) => op.id)).toEqual(['op-1']);
  });

  test('joins as an agent peer, on an id two sessions of one agent do not share', async () => {
    const first = await connect({ ops: [] });
    const firstId = new URL(joinedAt).searchParams.get('peerId');
    await connect({ ops: [] });
    const url = new URL(joinedAt);
    expect(url.searchParams.get('peerId')).toStartWith(`mcp-${AGENT}-`);
    expect(url.searchParams.get('peerId')).not.toBe(firstId);
    expect(url.searchParams.get('uid')).toBe(AGENT);
    expect(first.room.peerId).toBe(firstId ?? '');
  });

  test('a field in init it cannot read does not strand the connection', async () => {
    const { room } = await connect({
      ops: [comment('op-1')],
      url: 'https://example.com',
      width: 'wide',
      peers: 'everyone',
      iceServers: [{ urls: null }],
    });
    expect(room.getMeta()).toMatchObject({ url: 'https://example.com', width: null });
    expect(room.listOps()).toHaveLength(1);
  });

  test('rejects rather than hangs when no init arrives', async () => {
    onOpen = () => {};
    await expect(dial()).rejects.toThrow('no init payload');
  });

  test('says why a room refused the socket', async () => {
    onOpen = (ws) => void setTimeout(() => ws.close(ROOM_LOCKED_CLOSE_CODE, 'locked'), 10);
    await expect(dial()).rejects.toThrow('password protected');
  });
});

/** Today's production worker, as `annotation-room.ts` sends it: no `cursor`, and peers it announces without `uid`. */
describe('against a worker on the old wire', () => {
  test('a watch works through peers without a uid and traffic it does not care about', async () => {
    const { room } = await connect({
      ops: [comment('op-1')],
      peers: [{ id: 'mcp-abc', name: 'cursor', color: '#3F3F46' }],
      createdAt: 1,
      expiresAt: null,
      owned: false,
      url: 'https://example.com',
      width: 1280,
      access: 'edit',
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });
    const batch = room.watch({ timeoutSeconds: 2, batchMs: 20 });
    toPeer({ type: 'peer_join', peer: { id: 'p2', name: 'Ada', color: '#111111' } });
    toPeer({ type: 'cursor', peerId: 'p2', x: 1, y: 2 });
    toPeer({ type: 'rtc_offer', from: 'p2', to: 'p3', sdp: 'opaque' });
    toPeer({ type: 'op', op: comment('op-2') });
    expect((await batch).map((e) => [e.kind, e.kind === 'teach_control' ? e.control.presentationId : e.op.id])).toEqual(
      [['new', 'op-2']],
    );
  });
});

describe('marklayer_watch_annotations', () => {
  const watch = (client: ConnectedRoom) =>
    callTool({
      name: 'marklayer_watch_annotations',
      args: { timeoutSeconds: 1 },
      room: client.room,
      apiBase: 'https://marklayer.app',
      createPreview: async () => ({ error: 'unused' }),
    });

  test('teaching tools use the socket and watch returns a participant control', async () => {
    const client = await connect({ ops: [] });
    const invoke = (name: string, args: unknown) =>
      callTool({
        name,
        args,
        room: client.room,
        apiBase: 'https://marklayer.app',
        createPreview: async () => ({ error: 'unused' }),
      });
    const start = await invoke('teach_start', {});
    const presentationId = JSON.parse(start?.content[0]?.text ?? '{}').presentationId;
    await invoke('teach_step', { presentationId, index: 0, caption: '说明', selector: '#save' });
    await invoke('teach_end', { presentationId });
    await until(() => received.filter((msg) => msg.type?.startsWith('teach_')).length === 4);
    expect(received.filter((msg) => msg.type?.startsWith('teach_')).map((msg) => msg.type)).toEqual([
      'teach_state',
      'teach_highlight',
      'teach_caption',
      'teach_state',
    ]);
    const waiting = client.room.watch({ timeoutSeconds: 1, batchMs: 5 });
    toPeer({ type: 'teach_control', presentationId, action: 'next', peerId: 'human' });
    expect((await waiting)[0]).toMatchObject({ kind: 'teach_control', control: { presentationId, action: 'next' } });
  });

  test('reports a dropped socket instead of waiting on a dead room', async () => {
    const client = await connect({ ops: [] });
    peer?.close(1012, 'service restart');
    await until(() => client.disconnectedReason() !== null);
    const result = await watch(client);
    expect(result?.isError).toBe(true);
    expect(result?.content[0]?.text).toContain('marklayer_connect_room');
  });

  test('a socket that drops mid-watch fails the watch rather than leaving it parked', async () => {
    const { room } = await connect({ ops: [] });
    const parked = room.watch({ timeoutSeconds: 30 });
    peer?.close(1012, 'service restart');
    await expect(parked).rejects.toThrow('socket closed (code 1012)');
  });

  test('closing the room frees a parked watch', async () => {
    const client = await connect({ ops: [] });
    const parked = client.room.watch({ timeoutSeconds: 30 });
    client.close();
    await expect(parked).rejects.toThrow('client disconnected');
  });

  test('what lands between two watches reaches the second', async () => {
    const { room } = await connect({ ops: [] });
    await room.watch({ timeoutSeconds: 0.01 });
    toPeer({ type: 'op', op: comment('op-2') });
    await until(() => room.listOps().length > 0);
    const events = await room.watch({ timeoutSeconds: 5, batchMs: 5 });
    expect(events.map((e) => (e.kind === 'teach_control' ? e.control.presentationId : e.op.id))).toEqual(['op-2']);
  });
});

describe('view-only latch', () => {
  test('stops writing once the room refuses one, and resumes when access is granted', async () => {
    const { room } = await connect({ ops: [comment('op-1')] });
    toPeer({ type: 'error', code: 'read_only' });
    await until(() => room.viewOnly);

    expect(await room.acknowledge('op-1')).toBe(false);
    await Bun.sleep(50);
    expect(received).toEqual([]);
    expect(room.listAnnotations()[0]?.status).toBeUndefined();

    toPeer({ type: 'access', canEdit: true });
    await until(() => !room.viewOnly);
    expect(await room.acknowledge('op-1')).toBe(true);
    await until(() => received.length > 0);
    await Bun.sleep(50);
    expect(received.map((m) => [m.type, m.opId])).toEqual([['update_op', 'op-1']]);
  });
});

describe('handoff', () => {
  test('wakes the watcher once when a thread is assigned, not on every later patch', async () => {
    const { room } = await connect({ ops: [comment('op-1')] });
    // A grace window wide enough that a second, wrongly emitted handoff would land in the same batch.
    const batch = room.watch({ timeoutSeconds: 2, batchMs: 150 });
    toPeer({ type: 'update_op', opId: 'op-1', patch: { assignee: AGENT } });
    toPeer({ type: 'update_op', opId: 'op-1', patch: { status: 'open' } });
    const events = await batch;
    expect(events.map((e) => [e.kind, e.kind === 'teach_control' ? e.control.presentationId : e.op.id])).toEqual([
      ['handoff', 'op-1'],
    ]);
  });
});
