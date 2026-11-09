import { describe, expect, test } from 'bun:test';
import { agentPeerId } from '@marklayer/types/agents';
import type { AgentWatchRequest, AgentWatchResult, ClientMsg, ServerMsg } from '@marklayer/types/wire';
import { z } from 'zod/mini';
import { rooms } from './rooms';
import { fakeDb } from './test-d1';
import { FakeExecutionContext } from './test-env';

const ID = 'dsWPMrdw6EZ8jkkhxvFKS';
const AGENT = 'cursor';

const comment = {
  id: 'c1',
  tool: 'comment',
  num: 1,
  text: 'the label is vague',
  x: 10,
  y: 20,
  color: '#000000',
  lineWidth: 2,
  ts: 1,
  author: 'Ada',
};

/** Records the RPCs a request makes. `answers` are what parked watches return, in order, then an empty log. */
function fakeRoom({
  answers = [],
  cursor = 7,
  ops = [comment],
}: {
  answers?: AgentWatchResult[];
  cursor?: number;
  ops?: unknown[];
} = {}) {
  const heartbeats: string[] = [];
  const watches: AgentWatchRequest[] = [];
  const removed: string[][] = [];
  const pushed: { tool: string }[] = [];
  const sent: { msg: ClientMsg; peerId?: string }[] = [];
  const snapshot = async () => ({
    ops,
    url: null,
    width: null,
    createdAt: null,
    expiresAt: null,
    canEdit: true,
    cursor,
  });
  const stub = {
    join: async (peer: { id: string }) => {
      heartbeats.push(peer.id);
      return { ...(await snapshot()), missed: [] };
    },
    snapshot,
    send: async (msg: ClientMsg, peerId?: string) => {
      sent.push({ msg, peerId });
      if (msg.type === 'op') pushed.push(msg.op);
      if (msg.type === 'undo') removed.push([msg.opId]);
      return true;
    },
    watch: async (request: AgentWatchRequest) => {
      watches.push(request);
      const answer = answers.shift();
      if (answer) return answer;
      // Parks like the room does: answering at once would spin the core's watch loop.
      await Bun.sleep(request.timeoutMs);
      return { messages: [], cursor: request.since };
    },
  };
  return { stub, heartbeats, watches, removed, pushed, sent };
}

function post({ stub, body, session }: { stub: ReturnType<typeof fakeRoom>['stub']; body: unknown; session?: string }) {
  const db = fakeDb({ first: { password_hash: null, password_gen: 0, owner_id: null } });
  return rooms.fetch(
    new Request(`https://marklayer.app/s/${ID}/mcp?agent=${AGENT}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        ...(session ? { 'Mcp-Session-Id': session } : {}),
      },
      body: JSON.stringify(body),
    }),
    { DB: db, ANNOTATION_ROOM: { idFromName: () => 'do', get: () => stub } },
    new FakeExecutionContext(),
  );
}

const initialize = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } },
};
const toolsList = { jsonrpc: '2.0', id: 2, method: 'tools/list' };
const call = (name: string, args: unknown) => ({
  jsonrpc: '2.0',
  id: 3,
  method: 'tools/call',
  params: { name, arguments: args },
});

const rpcResult = z.object({
  result: z.object({ content: z.array(z.object({ text: z.string() })) }),
});

async function toolText(res: Response) {
  const frame = (await res.text()).split('\n').find((line) => line.startsWith('data: {'));
  return rpcResult.parse(JSON.parse(frame?.slice('data: '.length) ?? 'null')).result.content[0]?.text ?? '';
}

describe('D4 an HTTP agent’s session', () => {
  test('teaching tools carry the HTTP agent identity to the room', async () => {
    const { stub, sent } = fakeRoom();
    const start = JSON.parse(
      await toolText(await post({ stub, body: call('teach_start', { steps: ['first'] }), session: 's1' })),
    );
    const presentationId = start.presentationId;
    await toolText(
      await post({
        stub,
        body: call('teach_step', { presentationId, index: 0, caption: '说明', annotationId: 'c1' }),
        session: 's1',
      }),
    );
    await toolText(await post({ stub, body: call('teach_end', { presentationId }), session: 's1' }));
    expect(sent.map(({ msg }) => msg.type)).toEqual(['teach_state', 'teach_highlight', 'teach_caption', 'teach_state']);
    expect(sent.every(({ peerId }) => peerId === agentPeerId({ agentId: AGENT, session: 's1' }))).toBe(true);
  });

  test('initialize names one, and the client’s later requests keep that peer', async () => {
    const { stub, heartbeats } = fakeRoom();
    const res = await post({ stub, body: initialize });
    await res.text();
    const session = res.headers.get('Mcp-Session-Id');
    if (!session) throw new Error('no session minted');
    await (await post({ stub, body: toolsList, session })).text();
    expect(heartbeats).toEqual([agentPeerId({ agentId: AGENT, session }), agentPeerId({ agentId: AGENT, session })]);
  });

  test('two initializes are two peers, so unnamed agents stop collapsing', async () => {
    const { stub, heartbeats } = fakeRoom();
    await (await post({ stub, body: initialize })).text();
    await (await post({ stub, body: initialize })).text();
    expect(new Set(heartbeats).size).toBe(2);
  });

  test('a client that never initialized stays one peer rather than a new one per call', async () => {
    const { stub, heartbeats } = fakeRoom();
    await (await post({ stub, body: toolsList })).text();
    await (await post({ stub, body: toolsList })).text();
    expect(new Set(heartbeats).size).toBe(1);
  });

  // The header ends up in an id broadcast to everyone in the room.
  test('a session id this server could not have minted is not echoed into the room', async () => {
    const { stub, heartbeats } = fakeRoom();
    await (await post({ stub, body: toolsList, session: '<img src=x>' })).text();
    expect(heartbeats[0]).not.toContain('<img');
  });
});

describe('the HTTP transport', () => {
  test('lists no tool a URL-bound room cannot serve', async () => {
    const { stub } = fakeRoom();
    const text = await (await post({ stub, body: toolsList })).text();
    // `timeoutSeconds` is a schema property: the tool's arguments survive the trip through the SDK.
    expect(text).toContain('timeoutSeconds');
    expect(text).not.toContain('"marklayer_connect_room"');
  });

  test('P4 P99 a watch resumes from the snapshot, and each pass from the last answer', async () => {
    const assigned: ServerMsg = { type: 'update_op', opId: 'c1', patch: { assignee: AGENT } };
    const { stub, watches } = fakeRoom({ answers: [{ messages: [assigned], cursor: 9 }], cursor: 7 });
    const text = await toolText(
      await post({
        stub,
        body: call('marklayer_watch_annotations', { timeoutSeconds: 1, batchMs: 10 }),
      }),
    );
    expect(text).toContain('"kind": "handoff"');
    expect(watches.map((w) => w.since)).toEqual([7, 9]);
  });

  test('P98 batchMs reaches the wait, so a burst gathers on HTTP too', async () => {
    const op = (id: string): ServerMsg => ({ type: 'op', op: { ...comment, id, tool: 'comment' } });
    const { stub } = fakeRoom({
      answers: [
        { messages: [op('c2')], cursor: 8 },
        { messages: [op('c3')], cursor: 9 },
      ],
    });
    const text = await toolText(
      await post({
        stub,
        body: call('marklayer_watch_annotations', { timeoutSeconds: 1, batchMs: 10 }),
      }),
    );
    expect(text).toContain('"count": 2');
  });

  test('a checklist replaced over HTTP removes the old steps through the room', async () => {
    const step = {
      id: 's1',
      tool: 'step',
      text: 'Old',
      order: 0,
      color: '#000000',
      lineWidth: 2,
      ts: 1,
    };
    const { stub, removed, pushed } = fakeRoom({ ops: [comment, step] });
    const res = await post({ stub, body: call('marklayer_set_next_steps', { steps: [{ text: 'New' }] }) });
    await res.text();
    expect(removed).toEqual([['s1']]);
    expect(pushed.map((op) => op.tool)).toEqual(['step']);
  });
});
