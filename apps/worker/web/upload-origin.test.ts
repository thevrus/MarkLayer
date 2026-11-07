import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { configureHost } from '@ext/lib/host-config';
import { loadAnnotations } from '@ext/lib/share';
import { webHost } from './host';
import { uploadVideo } from './projects';

const PREVIEW = 'https://preview.marklayer.test';
const UPLOAD_ID = 'a'.repeat(21);
const real = { fetch: globalThis.fetch, location: globalThis.location };
const setGlobal = (key: 'fetch' | 'location', value: unknown) =>
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });

let requested: string[] = [];

describe('a viewer off production', () => {
  beforeAll(() => {
    setGlobal('location', { origin: PREVIEW, href: `${PREVIEW}/s/room` });
    setGlobal('fetch', async (url: string) => {
      requested.push(url);
      return Response.json({ id: UPLOAD_ID, url: '/f/x', ops: [] });
    });
    configureHost(webHost());
  });
  afterAll(() => {
    setGlobal('fetch', real.fetch);
    setGlobal('location', real.location);
    configureHost({});
  });

  test('joins rooms on its own origin, not on production', async () => {
    requested = [];
    await loadAnnotations('room');
    expect(requested).toEqual([`${PREVIEW}/api/room`]);
  });

  test('a video note still tells the server it is video', async () => {
    requested = [];
    expect(await uploadVideo(new Blob(['x'], { type: 'video/webm' }))).toBe(UPLOAD_ID);
    expect(requested).toEqual([`${PREVIEW}/f?kind=video`]);
  });
});
