import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { type AnalyticsProps, setAnalytics } from './analytics';
import { copyText, toast, toasts } from './toasts';

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

const events: Array<[string, AnalyticsProps | undefined]> = [];

const stubClipboard = (writeText: () => Promise<void>) =>
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

beforeEach(() => {
  toasts.value = [];
  events.length = 0;
  setAnalytics({ sink: (event, props) => events.push([event, props]), surface: 'extension' });
});

afterAll(() => {
  setAnalytics({ sink: () => {}, surface: 'extension' });
});

describe('toast', () => {
  test('queues a message with its type', () => {
    toast('Saved', 'success');
    expect(toasts.value).toEqual([{ id: expect.any(Number), message: 'Saved', type: 'success' }]);
  });

  test('defaults to an informational toast', () => {
    toast('Heads up');
    expect(toasts.value[0]?.type).toBe('info');
  });

  test('dismisses itself after its own duration', async () => {
    toast('Quick', 'info', 10);
    expect(toasts.value).toHaveLength(1);
    await tick(30);
    expect(toasts.value).toEqual([]);
  });

  test('dismisses by id, so a short toast cannot take a longer one with it', async () => {
    // Removing by index would drop whichever toast happened to sit there.
    toast('long', 'info', 400);
    toast('short', 'info', 10);
    await tick(40);
    expect(toasts.value.map((t) => t.message)).toEqual(['long']);
  });

  test('gives every toast a distinct id, even for the same message', () => {
    toast('same');
    toast('same');
    const [a, b] = toasts.value;
    expect(a?.id).not.toBe(b?.id);
  });
});

describe('copyText', () => {
  test('reports success and counts the copy', async () => {
    stubClipboard(() => Promise.resolve());
    copyText('hello world', 'Selector copied');
    await tick();

    expect(toasts.value[0]).toMatchObject({ message: 'Selector copied', type: 'success' });
    expect(events).toEqual([['copied', { surface: 'extension', label: 'Selector copied', chars: 11 }]]);
  });

  test('labels the copy "Copied" by default', async () => {
    stubClipboard(() => Promise.resolve());
    copyText('x');
    await tick();
    expect(toasts.value[0]?.message).toBe('Copied');
  });

  test('surfaces a rejected clipboard write instead of failing silently', async () => {
    // The clipboard is how work leaves this product; a denied permission has to
    // be visible, not a no-op.
    stubClipboard(() => Promise.reject(new Error('denied')));
    copyText('x', 'Markdown copied');
    await tick();

    expect(toasts.value[0]).toMatchObject({ message: 'Failed to copy', type: 'error' });
    expect(events).toEqual([['copy_failed', { surface: 'extension', label: 'Markdown copied' }]]);
  });

  test('counts characters, never the text itself', () => {
    // The privacy contract is a scrubber over flat values; the copied content
    // must not travel.
    stubClipboard(() => Promise.resolve());
    copyText('a secret selector', 'Copied');
    return tick().then(() => {
      expect(JSON.stringify(events)).not.toContain('secret');
    });
  });
});
