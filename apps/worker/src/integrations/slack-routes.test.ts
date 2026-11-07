import { afterEach, describe, expect, test } from 'bun:test';
import type { CommentOp, DrawOp } from '@marklayer/types/ops';
import { fakeDb } from '../test-d1';
import { encryptToken, signSlackBody } from './slack-crypto';
import { slackRoutes } from './slack-routes';
import { slackStore } from './slack-store';
import { postBatchToSlack } from './slack-sync';

const SIGNING = 'signing-secret';
const KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
const ROOM = 'dsWPMrdw6EZ8jkkhxvFKS';
const OTHER_ROOM = 'xxWPMrdw6EZ8jkkhxvFKS';
const BOT = 'UBOT';

const parent: CommentOp = {
  id: 'ann-1',
  tool: 'comment',
  num: 1,
  text: 'Logo is blurry',
  x: 10,
  y: 20,
  ts: 1,
  color: '#000',
  lineWidth: 2,
  author: 'Ada',
};
const decoy: CommentOp = { ...parent, id: 'ann-2', num: 2, x: 500, y: 600, text: 'Other' };

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Slack's Web API, answering each method from a table and recording what was asked. */
function fakeSlack(answers: Record<string, unknown[]>) {
  const calls: { method: string; body: string }[] = [];
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = String(input).split('/').pop() ?? '';
      calls.push({ method, body: String(init?.body ?? '') });
      return Response.json(answers[method]?.shift() ?? { ok: false });
    },
    { preconnect: realFetch.preconnect },
  );
  return calls;
}

async function installRow(roomId: string) {
  return {
    room_id: roomId,
    team_id: 'T1',
    team_name: 'Acme',
    channel_id: 'C1',
    channel_name: '#design',
    bot_user_id: BOT,
    bot_token: await encryptToken({ secret: KEY, token: 'xoxb-test', roomId }),
  };
}

function setup(firstQueue: unknown[]) {
  const pushed: { roomId: string; op: DrawOp }[] = [];
  const stubFor = (roomId: string) => ({
    snapshot: async () => ({ ops: [decoy, parent] }),
    send: async (msg: { type: string; op?: DrawOp }) => {
      if (msg.op) pushed.push({ roomId, op: msg.op });
      return true;
    },
  });
  const env = {
    DB: fakeDb({ firstQueue }),
    ANNOTATION_ROOM: { idFromName: (name: string) => name, get: stubFor },
    SLACK_CLIENT_ID: 'id',
    SLACK_CLIENT_SECRET: 'secret',
    SLACK_SIGNING_SECRET: SIGNING,
    SLACK_TOKEN_KEY: KEY,
  };
  const waits: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => waits.push(p), passThroughOnException() {}, props: {} };
  const send = async ({
    body,
    ageSeconds = 0,
    signature,
  }: {
    body: unknown;
    ageSeconds?: number;
    signature?: string;
  }) => {
    const raw = JSON.stringify(body);
    const timestamp = String(Math.floor(Date.now() / 1000) - ageSeconds);
    const res = await slackRoutes.request(
      '/events',
      {
        method: 'POST',
        body: raw,
        headers: {
          'x-slack-request-timestamp': timestamp,
          'x-slack-signature': signature ?? (await signSlackBody({ signingSecret: SIGNING, timestamp, body: raw })),
        },
      },
      env,
      ctx,
    );
    await Promise.all(waits);
    return res;
  };
  return { send, pushed };
}

const threadReply = (event: Record<string, unknown> = {}) => ({
  type: 'event_callback',
  team_id: 'T1',
  event: {
    type: 'message',
    channel: 'C1',
    user: 'UHUMAN',
    text: 'Fixed in &lt;main&gt;',
    ts: '200.2',
    thread_ts: '100.1',
    ...event,
  },
});

describe('POST /integrations/slack/events', () => {
  test('a body signed with the wrong secret is refused before anything runs', async () => {
    const { send, pushed } = setup([]);
    const raw = JSON.stringify(threadReply());
    const forged = await signSlackBody({
      signingSecret: 'not-it',
      timestamp: String(Math.floor(Date.now() / 1000)),
      body: raw,
    });
    const res = await send({ body: threadReply(), signature: forged });
    expect(res.status).toBe(401);
    expect(pushed).toEqual([]);
  });

  test('a correctly signed request older than five minutes is refused as a replay', async () => {
    const { send, pushed } = setup([]);
    const res = await send({ body: threadReply(), ageSeconds: 6 * 60 });
    expect(res.status).toBe(401);
    expect(pushed).toEqual([]);
  });

  test("the bot's own posts never come back in as replies", async () => {
    const withBotId = setup([{ room_id: ROOM, annotation_id: 'ann-1' }, await installRow(ROOM)]);
    expect((await withBotId.send({ body: threadReply({ bot_id: 'B1' }) })).status).toBe(200);
    expect(withBotId.pushed).toEqual([]);

    // No `bot_id`, but the author is the install's own bot user.
    const asBotUser = setup([{ room_id: ROOM, annotation_id: 'ann-1' }, await installRow(ROOM)]);
    fakeSlack({});
    expect((await asBotUser.send({ body: threadReply({ user: BOT }) })).status).toBe(200);
    expect(asBotUser.pushed).toEqual([]);
  });

  test('a threaded human reply lands as a reply op on the annotation that thread belongs to', async () => {
    const { send, pushed } = setup([{ room_id: ROOM, annotation_id: 'ann-1' }, await installRow(ROOM)]);
    fakeSlack({ 'users.info': [{ ok: true, user: { profile: { display_name: 'Grace' } } }] });
    expect((await send({ body: threadReply() })).status).toBe(200);

    expect(pushed).toHaveLength(1);
    const [{ roomId, op }] = pushed;
    expect(roomId).toBe(ROOM);
    expect(op).toMatchObject({
      tool: 'comment',
      parentId: 'ann-1',
      text: 'Fixed in <main>',
      author: 'Grace',
      x: 10,
      y: 20,
    });
    // Derived from the message, so Slack redelivering the event cannot write it twice.
    expect(op.id).toBe('slack-C1-200_2');
  });

  test('a token sealed for another room does not decrypt, so the reply is still attributed but not by name', async () => {
    const { send, pushed } = setup([
      { room_id: ROOM, annotation_id: 'ann-1' },
      { ...(await installRow(OTHER_ROOM)), room_id: ROOM },
    ]);
    const calls = fakeSlack({});
    await send({ body: threadReply() });
    expect(calls).toEqual([]);
    expect(pushed[0]?.op).toMatchObject({ author: 'Slack user', parentId: 'ann-1' });
  });
});

describe('postBatchToSlack', () => {
  test('a reply posted in the same batch as its comment goes into that comment’s thread', async () => {
    const reply: CommentOp = { ...parent, id: 'r-1', text: 'Agreed', parentId: 'ann-1', author: 'Lin' };
    const calls = fakeSlack({
      'chat.postMessage': [
        { ok: true, ts: '111.1' },
        { ok: true, ts: '111.2' },
      ],
    });
    const install = await slackStore(fakeDb({ first: await installRow(ROOM) })).install(ROOM);
    if (!install) throw new Error('no install');
    const result = await postBatchToSlack({
      db: fakeDb({ first: null }),
      install,
      tokenKey: KEY,
      roomId: ROOM,
      items: [parent, reply],
      ops: () => [parent, reply],
      roomUrl: `https://marklayer.app/s/${ROOM}`,
      origin: 'https://marklayer.app',
    });
    expect(result).toEqual({ sent: 2, failed: 0 });
    const [first, second] = calls.map((c) => JSON.parse(c.body));
    expect(first.thread_ts).toBeUndefined();
    expect(second).toMatchObject({ channel: 'C1', thread_ts: '111.1' });
  });
});
