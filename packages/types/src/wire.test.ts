import { describe, expect, test } from 'bun:test';
import { clientMsgSchema, serverMsgSchema } from './wire';

describe('clientMsgSchema', () => {
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
