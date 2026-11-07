import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { signal } from '@preact/signals';
import { FRAME_MESSAGE } from '../../shared/frame-protocol';

const navigated: string[] = [];
mock.module('../projects', () => ({ navigateTo: ({ url }: { url: string }) => navigated.push(url) }));
const { bindFrameMessages } = await import('./useFrameMessages');

// Bun has no KeyboardEvent; the bridge only needs one that dispatches.
class FakeKeyboardEvent extends Event {}
const realKeyboardEvent = Object.getOwnPropertyDescriptor(globalThis, 'KeyboardEvent');
Object.defineProperty(globalThis, 'KeyboardEvent', { value: FakeKeyboardEvent, configurable: true });
afterAll(() => {
  if (realKeyboardEvent) Object.defineProperty(globalThis, 'KeyboardEvent', realKeyboardEvent);
  else Reflect.deleteProperty(globalThis, 'KeyboardEvent');
});

const framed = { name: 'the framed page' };
const foreign = { name: 'any other window' };
const key = { key: 'r', code: 'KeyR', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false };

function bridge() {
  const host = new EventTarget();
  const keys: string[] = [];
  for (const phase of ['keydown', 'keyup']) host.addEventListener(phase, () => keys.push(phase));
  const frame = { contentWindow: framed };
  bindFrameMessages({
    frameRef: { current: frame },
    frameReady: () => {},
    failRender: () => {},
    blockedEgressIp: signal(null),
    blockedFirewall: signal(null),
    host,
  });
  const post = ({ data, source = framed }: { data: unknown; source?: object }) => {
    const event = new MessageEvent('message', { data });
    Object.defineProperty(event, 'source', { value: source });
    host.dispatchEvent(event);
  };
  return { keys, post };
}

const navigate = { type: FRAME_MESSAGE.navigate, url: 'https://example.org/' };

describe('the viewer frame bridge', () => {
  beforeEach(() => {
    navigated.length = 0;
  });

  test('B88: navigate is obeyed from the framed page and ignored from anywhere else', () => {
    const { post } = bridge();
    post({ data: navigate, source: foreign });
    expect(navigated).toEqual([]);
    post({ data: navigate });
    expect(navigated).toEqual([navigate.url]);
  });

  test('B13: a press aimed at a field in the page never reaches the shortcuts, its release does', () => {
    const { keys, post } = bridge();
    post({ data: { type: FRAME_MESSAGE.key, phase: 'keydown', ...key, editable: true } });
    post({ data: { type: FRAME_MESSAGE.key, phase: 'keyup', ...key, editable: true } });
    expect(keys).toEqual(['keyup']);
  });

  test('a press outside any field crosses to the host', () => {
    const { keys, post } = bridge();
    post({ data: { type: FRAME_MESSAGE.key, phase: 'keydown', ...key, editable: false } });
    expect(keys).toEqual(['keydown']);
  });
});
