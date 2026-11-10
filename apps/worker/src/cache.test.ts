import { expect, test } from 'bun:test';
import { cachedPng } from './cache';

test('refreshes old artwork at the same key and reuses current artwork', async () => {
  let metadata: Record<string, string> = {};
  let stored = new Uint8Array([1]);
  let renders = 0;
  const bucket = {
    get: async () => ({ body: new Blob([stored]).stream(), customMetadata: metadata }),
    put: async (_key: string, data: ArrayBuffer, options: { customMetadata: Record<string, string> }) => {
      stored = new Uint8Array(data);
      metadata = options.customMetadata;
    },
  } as unknown as R2Bucket;
  const pending: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => { pending.push(p); } };
  const render = async () => { renders++; return new Uint8Array([2]).buffer; };
  const first = await cachedPng({ bucket, key: 'existing-room.png', ctx, render });
  expect([...new Uint8Array(await first.arrayBuffer())]).toEqual([2]);
  await Promise.all(pending);
  const second = await cachedPng({ bucket, key: 'existing-room.png', ctx, render });
  expect([...new Uint8Array(await second.arrayBuffer())]).toEqual([2]);
  expect(renders).toBe(1);
});
