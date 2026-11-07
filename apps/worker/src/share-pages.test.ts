import { describe, expect, test } from 'bun:test';
import { sharePages } from './share-pages';
import { nowInSeconds } from './store';
import { fakeDb, unsupported } from './test-d1';
import { FakeExecutionContext, fakeEnv } from './test-env';

const ID = 'dsWPMrdw6EZ8jkkhxvFKS';

/** Past its deadline, with every column the page's reads might ask for: the fake replays this row whatever the SELECT named. */
const expiredRow = () => ({
  password_hash: null,
  password_gen: 0,
  owner_id: null,
  ops: '[]',
  url: null,
  width: null,
  created_at: 1,
  access: 'edit',
  expires_at: nowInSeconds() - 60,
  owner_expires_at: null,
});

const shell: Fetcher = {
  fetch: async () =>
    new Response('<html><head></head><body></body></html>', { headers: { 'Content-Type': 'text/html' } }),
  connect: unsupported,
};

const cachedShell: Fetcher = {
  fetch: async () => new Response('<html></html>', { headers: { 'Cache-Control': 'public, max-age=3600' } }),
  connect: unsupported,
};

describe('share page', () => {
  test('W20 the embedded board never leaves a shell in a cache', async () => {
    const env = fakeEnv({ DB: fakeDb({ first: { ...expiredRow(), expires_at: null } }), ASSETS: cachedShell });
    const res = await sharePages.request(`/s/${ID}?still=1`, {}, env, new FakeExecutionContext());
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  test('W11 an expired room answers /s/:id with 410 instead of the shell', async () => {
    const env = fakeEnv({ DB: fakeDb({ first: expiredRow() }), ASSETS: shell });
    const res = await sharePages.request(`/s/${ID}`, {}, env, new FakeExecutionContext());
    expect(res.status).toBe(410);
  });
});
