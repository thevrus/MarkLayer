import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { callRoomTool } from '@marklayer/agent-tools';
import type { ServerWebSocket } from 'bun';
import { RoomClient } from './room';

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
const received: { type?: string; opId?: string }[] = [];

const server = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  fetch(req, srv) {
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

const clients: RoomClient[] = [];

async function connect(init: Record<string, unknown>): Promise<RoomClient> {
  onOpen = (ws) => ws.send(JSON.stringify({ type: 'init', canEdit: true, ...init }));
  const client = new RoomClient(`http://127.0.0.1:${server.port}`, 'room-1', AGENT);
  clients.push(client);
  await client.connect({ initTimeoutMs: 2000 });
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

describe('RoomClient init', () => {
  test('keeps the ops it can parse when one in the room is from a newer client', async () => {
    const client = await connect({ ops: [comment('op-1'), { id: 'z', tool: 'future-tool', ts: 1 }] });
    expect(client.listAnnotations().map((op) => op.id)).toEqual(['op-1']);
  });
});

describe('marklayer_watch_annotations', () => {
  test('reports a dropped socket instead of waiting on a dead room', async () => {
    const client = await connect({ ops: [] });
    peer?.close(1012, 'service restart');
    await until(() => client.disconnectedReason() !== null);
    const result = await callRoomTool({
      name: 'marklayer_watch_annotations',
      args: { timeoutSeconds: 1 },
      room: client,
      apiBase: 'https://marklayer.app',
    });
    expect(result?.isError).toBe(true);
    expect(result?.content[0]?.text).toContain('marklayer_connect_room');
  });
});

describe('RoomClient view-only latch', () => {
  test('stops writing once the room refuses one, and resumes when access is granted', async () => {
    const client = await connect({ ops: [comment('op-1')] });
    toPeer({ type: 'error', code: 'read_only' });
    await until(() => client.viewOnly);

    expect(client.acknowledge('op-1')).toBe(false);
    await Bun.sleep(50);
    expect(received).toEqual([]);
    expect(client.listAnnotations()[0]?.status).toBeUndefined();

    toPeer({ type: 'access', canEdit: true });
    await until(() => !client.viewOnly);
    expect(client.acknowledge('op-1')).toBe(true);
    await until(() => received.length > 0);
    await Bun.sleep(50);
    expect(received.map((m) => [m.type, m.opId])).toEqual([['update_op', 'op-1']]);
  });
});

describe('RoomClient handoff', () => {
  test('wakes the watcher once when a thread is assigned, not on every later patch', async () => {
    const client = await connect({ ops: [comment('op-1')] });
    // A grace window wide enough that a second, wrongly emitted handoff would land in the same batch.
    const batch = client.watch({ timeoutSeconds: 2, batchMs: 150 });
    toPeer({ type: 'update_op', opId: 'op-1', patch: { assignee: AGENT } });
    toPeer({ type: 'update_op', opId: 'op-1', patch: { status: 'open' } });
    const events = await batch;
    expect(events.map((e) => [e.kind, e.op.id])).toEqual([['handoff', 'op-1']]);
  });
});
