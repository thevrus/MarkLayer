import { describe, expect, test } from 'bun:test';
import { clientMsgSchema, serverMsgSchema } from './wire';

describe('clientMsgSchema', () => {
  test('accepts teaching messages and rejects an unknown control action', () => {
    expect(
      clientMsgSchema.safeParse({ type: 'teach_highlight', presentationId: 'p1', selector: '#save' }).success,
    ).toBe(true);
    expect(
      clientMsgSchema.safeParse({ type: 'teach_caption', presentationId: 'p1', text: '说明', step: 1 }).success,
    ).toBe(true);
    expect(clientMsgSchema.safeParse({ type: 'teach_state', presentationId: 'p1', state: 'active' }).success).toBe(
      true,
    );
    expect(clientMsgSchema.safeParse({ type: 'teach_control', presentationId: 'p1', action: 'next' }).success).toBe(
      true,
    );
    expect(clientMsgSchema.safeParse({ type: 'teach_control', presentationId: 'p1', action: 'delete' }).success).toBe(
      false,
    );
  });
  test('accepts a flock toggle in both directions', () => {
    expect(clientMsgSchema.safeParse({ type: 'flock', on: true }).success).toBe(true);
    expect(clientMsgSchema.safeParse({ type: 'flock', on: false }).success).toBe(true);
  });

  test('rejects a flock message with no state to apply', () => {
    expect(clientMsgSchema.safeParse({ type: 'flock' }).success).toBe(false);
    expect(clientMsgSchema.safeParse({ type: 'flock', on: 'yes' }).success).toBe(false);
  });
});

// A socket message that fails to parse is dropped, so each of these is a silent failure if it regresses.
describe('serverMsgSchema', () => {
  const parse = (msg: unknown) => serverMsgSchema.safeParse(msg);
  const comment = {
    id: 'c1',
    tool: 'comment',
    num: 1,
    text: 'hi',
    x: 0,
    y: 0,
    color: '#000',
    lineWidth: 2,
    ts: 1,
  };

  test('keeps the presenting peer and target on a teaching message', () => {
    const message = {
      type: 'teach_highlight',
      presentationId: 'p1',
      peerId: 'agent-1',
      annotationId: 'c1',
      rect: { x: 1, y: 2, width: 30, height: 40 },
    } as const;
    expect(parse(message).data).toEqual(message);
  });

  test('an init holding an op from a newer client still arrives whole', () => {
    const parsed = parse({ type: 'init', ops: [comment, { tool: 'hologram' }], peers: [] });
    expect(parsed.data).toMatchObject({ type: 'init', ops: [comment, { tool: 'hologram' }] });
  });

  test('takes the init a room sends today, nullable fields and all', () => {
    const init = {
      type: 'init',
      ops: [],
      peers: [{ id: 'p1', uid: 'u1', name: 'Ada', color: '#fff', joinedAt: 1, ops: 2, updates: 3 }],
      createdAt: null,
      expiresAt: null,
      owned: false,
      url: null,
      width: null,
      access: 'edit',
      canEdit: true,
      iceServers: [{ urls: 'stun:x' }, { urls: ['turn:y'], username: 'u', credential: 'c' }],
    };
    expect(parse(init).success).toBe(true);
  });

  test('takes a peer_join from a worker that does not send uid', () => {
    expect(parse({ type: 'peer_join', peer: { id: 'mcp-a', name: 'a', color: '#000' } }).success).toBe(true);
  });

  test('keeps the SDP and ICE fields the room forwards unread', () => {
    const offer = { type: 'rtc_offer', to: 'p2', from: 'p1', sdp: { type: 'offer', sdp: 'v=0' } };
    expect(parse(offer).data).toMatchObject(offer);
  });

  test('refuses an op it cannot read rather than letting it into a room', () => {
    expect(parse({ type: 'op', op: { tool: 'hologram' } }).success).toBe(false);
  });
});


test('execution mode messages accept only the three room modes', () => {
  for (const execMode of ['solo', 'guide', 'pair']) {
    expect(clientMsgSchema.safeParse({ type: 'set_exec_mode', execMode }).success).toBe(true);
    expect(serverMsgSchema.safeParse({ type: 'exec_mode', execMode }).success).toBe(true);
  }
  expect(clientMsgSchema.safeParse({ type: 'set_exec_mode', execMode: 'invalid' }).success).toBe(false);
  expect(serverMsgSchema.safeParse({ type: 'init', ops: [], execMode: 'invalid' }).success).toBe(false);
});


test('layer commands and snapshots validate their identifiers and names', () => {
  expect(clientMsgSchema.safeParse({ type: 'layer_create', id: 'review', name: '页面问题' }).success).toBe(true);
  expect(clientMsgSchema.safeParse({ type: 'layer_create', id: '', name: '页面问题' }).success).toBe(false);
  expect(clientMsgSchema.safeParse({ type: 'layer_rename', id: 'review', name: '' }).success).toBe(false);
  expect(serverMsgSchema.safeParse({ type: 'layers', layers: [{ id: 'default', name: '默认图层', created_at: 1 }] }).success).toBe(true);
});
test('AI claim and task messages require identifiers', () => {
  expect(clientMsgSchema.safeParse({ type: 'agent_claim', agentId: 'codex' }).success).toBe(true);
  expect(clientMsgSchema.safeParse({ type: 'agent_claim', agentId: '' }).success).toBe(false);
  expect(clientMsgSchema.safeParse({ type: 'task_submit', taskId: 't1', agentId: 'codex', annotationId: 'a1', sourceId: 'a1', layerId: 'review' }).success).toBe(true);
  expect(clientMsgSchema.safeParse({ type: 'task_submit', taskId: 't1', agentId: 'codex', annotationId: 'a1', sourceId: 'a1' }).success).toBe(false);
});
