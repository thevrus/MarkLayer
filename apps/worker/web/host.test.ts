import { afterAll, expect, test } from 'bun:test';
import { configureHost } from '@ext/lib/host-config';
import { fileUrl } from '@ext/lib/share';
import { webHost } from './host';

afterAll(() => {
  configureHost({});
  Reflect.deleteProperty(globalThis, 'location');
});

// Off production a request sent to marklayer.app still succeeds (`/f` allows any origin), so nothing would look wrong.
test('a dev or self-hosted app talks to its own origin, not production', () => {
  Object.defineProperty(globalThis, 'location', { value: { origin: 'http://localhost:5173' }, configurable: true });
  configureHost(webHost());
  expect(fileUrl('abc')).toBe('http://localhost:5173/f/abc');
});
