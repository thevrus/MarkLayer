import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { OwnedLink } from '@marklayer/types';
import { links, updateLinkSettings } from './session';

const realFetch = globalThis.fetch;

const held: OwnedLink = {
  id: 'a',
  url: 'https://example.com',
  createdAt: 1,
  lastAccessedAt: 2,
  expiresAt: null,
  access: 'edit',
  ownerExpiresAt: null,
};

function stubServer({ patch }: { patch: Response }) {
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const path = String(input);
      if (method === 'PATCH' && path === '/auth/links/a') return patch;
      if (method === 'GET' && path === '/auth/links') return Response.json({ links: [held] });
      return new Response('unexpected', { status: 404 });
    },
    { preconnect: realFetch.preconnect },
  );
}

describe('updateLinkSettings', () => {
  beforeEach(() => {
    links.value = [held];
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    links.value = [];
  });

  it('a refused settings change leaves the dashboard showing what the server holds', async () => {
    stubServer({ patch: Response.json({ error: 'x' }, { status: 500 }) });
    expect(await updateLinkSettings({ id: 'a', patch: { access: 'view' } })).toBe(false);
    expect(links.value[0]?.access).toBe('edit');
  });

  it('a 200 that did not update anything is still a refusal', async () => {
    stubServer({ patch: Response.json({ updated: false }) });
    expect(await updateLinkSettings({ id: 'a', patch: { access: 'view' } })).toBe(false);
    expect(links.value[0]?.access).toBe('edit');
  });

  it('an accepted settings change sticks', async () => {
    stubServer({ patch: Response.json({ updated: true }) });
    expect(await updateLinkSettings({ id: 'a', patch: { access: 'view' } })).toBe(true);
    expect(links.value[0]?.access).toBe('view');
  });
});
