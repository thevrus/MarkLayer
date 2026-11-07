import { afterAll, describe, expect, mock, test } from 'bun:test';

// Loading the real analytics, kept to restore below, reaches extension state, which reads these at import.
const globals = {
  location: { href: 'https://marklayer.app/s/abc', search: '', pathname: '/s/abc', hash: '' },
  localStorage: { getItem: () => null },
};
const originals = Object.keys(globals).map((name) => ({
  name,
  desc: Object.getOwnPropertyDescriptor(globalThis, name),
}));
for (const [name, value] of Object.entries(globals)) {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}

const real = { ...(await import('./analytics')) };
const events: string[] = [];
mock.module('./analytics', () => ({ ...real, capture: (event: string) => events.push(event) }));
const { voiceActive } = await import('./voiceSignals');

// Module mocks outlive this file, and the next spec to import analytics must get the real one.
afterAll(() => {
  mock.module('./analytics', () => real);
  for (const { name, desc } of originals) {
    if (desc) Object.defineProperty(globalThis, name, desc);
    else Reflect.deleteProperty(globalThis, name);
  }
});

describe('voice call telemetry', () => {
  // The join button sets `voiceActive` before the mic prompt is answered, so a refusal flips it straight back.
  // Only the engine knows media flowed, and it reports the call itself, so these signals must stay silent.
  test('B35 a refused mic prompt counts as no call at all', () => {
    voiceActive.value = true;
    voiceActive.value = false;
    expect(events).toEqual([]);
  });
});
