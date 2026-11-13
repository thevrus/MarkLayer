import { describe, expect, test } from 'bun:test';
import { FRAME_MESSAGE, type FrameMessage, onFrameMessage } from './frame-protocol';

const framed = { name: 'framed window' };
const frame = { contentWindow: framed };

function listen() {
  const host = new EventTarget();
  const got: FrameMessage[] = [];
  const stop = onFrameMessage({
    frames: () => [null, frame],
    handler: ({ message }) => got.push(message),
    host,
  });
  const post = ({ data, source }: { data: unknown; source: object | null }) => {
    const event = new MessageEvent('message', { data });
    // The constructor only takes a real Window or port as `source`.
    Object.defineProperty(event, 'source', { value: source });
    host.dispatchEvent(event);
  };
  return { got, post, stop };
}

const navigate = { type: FRAME_MESSAGE.navigate, url: 'https://evil.example/' };

describe('onFrameMessage', () => {
  test('B88: a message from a foreign window is ignored, for every type', () => {
    const { got, post } = listen();
    post({ data: navigate, source: { name: 'a sibling window' } });
    post({ data: { type: FRAME_MESSAGE.ready }, source: { name: 'a sibling window' } });
    post({ data: navigate, source: null });
    expect(got).toEqual([]);
  });

  test('the framed window is heard', () => {
    const { got, post } = listen();
    post({ data: navigate, source: framed });
    expect(got).toEqual([navigate]);
  });

  test('accepts the bounded network failure relay shape', () => {
    const { got, post } = listen();
    const message = {
      type: FRAME_MESSAGE.networkErrors,
      errors: [{ method: 'GET', url: 'https://example.test/api', status: 503, durationMs: 12, at: 2 }],
    };
    post({ data: message, source: framed });
    expect(got).toEqual([message]);
  });

  test('a known type with the wrong shape never reaches the handler', () => {
    const { got, post } = listen();
    post({ data: { type: FRAME_MESSAGE.navigate, url: 42 }, source: framed });
    post({ data: 'ml-navigate', source: framed });
    expect(got).toEqual([]);
  });

  test('stopping removes the listener', () => {
    const { got, post, stop } = listen();
    stop();
    post({ data: navigate, source: framed });
    expect(got).toEqual([]);
  });
});
