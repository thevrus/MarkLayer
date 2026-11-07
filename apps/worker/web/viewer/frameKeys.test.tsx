import { afterAll, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

GlobalRegistrator.register({ url: 'https://marklayer.test/s/room' });

// tinykeys reads modifiers through this, which happy-dom's KeyboardEvent does not implement.
Object.defineProperty(KeyboardEvent.prototype, 'getModifierState', { value: () => false, configurable: true });

const { setAnalytics } = await import('@ext/lib/analytics');
const { activeTool } = await import('@ext/lib/tool-state');
const { render } = await import('preact');
const { WebMeasureLayer } = await import('../WebMeasureLayer');
const { forwardFrameKey } = await import('./forwardFrameKey');

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

test('a key pressed in the frame reaches a tool once, though it fires there and replays on the host', async () => {
  const walked: string[] = [];
  setAnalytics({ sink: (event) => walked.push(event), surface: 'viewer' });

  const frame = document.createElement('iframe');
  document.body.appendChild(frame);
  const win = frame.contentWindow;
  const doc = frame.contentDocument;
  if (!win || !doc) throw new Error('happy-dom gave the iframe no window');
  doc.body.innerHTML = '<p id="a">a</p><p id="b">b</p><p id="c">c</p>';

  activeTool.value = 'measure';
  const stage = document.createElement('div');
  document.body.appendChild(stage);
  render(<WebMeasureLayer frameRef={{ current: frame }} />, stage);
  // Effects run after paint, 35ms at the latest when preact/hooks loaded before this DOM existed.
  await new Promise((resolve) => setTimeout(resolve, 60));

  doc.getElementById('a')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

  const key = { key: 'ArrowDown', code: 'ArrowDown', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false };
  win.dispatchEvent(new KeyboardEvent('keydown', { ...key, cancelable: true }));
  forwardFrameKey({ message: { type: 'ml-key', phase: 'keydown', ...key, editable: false }, host: window });

  expect(walked.filter((event) => event === 'measure_walked')).toEqual(['measure_walked']);

  render(null, stage);
  activeTool.value = 'navigate';
  // Lets the unmount's scheduled frame run while `window` still exists.
  await new Promise((resolve) => setTimeout(resolve, 60));
});
