import { afterAll, afterEach, beforeAll, describe, expect, it, mock } from 'bun:test';

type Sanitize = (props: Record<string, unknown>) => Record<string, unknown>;
let sanitize: Sanitize | null = null;

const realLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
const realLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
const realHistory = Object.getOwnPropertyDescriptor(globalThis, 'history');

function stub({ name, value }: { name: string; value: unknown }) {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}

function restore({ name, desc }: { name: string; desc: PropertyDescriptor | undefined }) {
  if (desc) Object.defineProperty(globalThis, name, desc);
  else Reflect.deleteProperty(globalThis, name);
}

describe('analytics privacy', () => {
  beforeAll(() => {
    stub({
      name: 'location',
      value: { href: 'https://marklayer.app/s/abc', search: '', pathname: '/s/abc', hash: '' },
    });
    stub({ name: 'history', value: { replaceState: () => {} } });
    stub({ name: 'localStorage', value: { getItem: () => null } });
    mock.module('posthog-js', () => ({
      default: {
        init: (_key: string, opts: { sanitize_properties?: Sanitize }) => {
          sanitize = opts.sanitize_properties ?? null;
        },
        capture: () => {},
      },
    }));
  });
  afterAll(() => {
    restore({ name: 'location', desc: realLocation });
    restore({ name: 'history', desc: realHistory });
    restore({ name: 'localStorage', desc: realLocalStorage });
    mock.restore();
  });
  afterEach(() => {
    sanitize = null;
  });

  it('the viewer never reports a room id or a page query to PostHog', async () => {
    const { initAnalytics } = await import('./analytics');
    initAnalytics({ key: 'k', surface: 'viewer' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sanitize).not.toBeNull();
    const out = sanitize?.({
      $current_url: 'https://marklayer.app/s/abc?url=https%3A%2F%2Fx.com#id=sec',
      $referrer: 'https://google.com/search?q=private',
      $browser: 'Chrome',
    });
    expect(out?.$current_url).toBe('https://marklayer.app/s/abc');
    expect(out?.$referrer).toBe('https://google.com/search');
    expect(out?.$browser).toBe('Chrome');
  });
});
