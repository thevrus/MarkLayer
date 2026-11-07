import { expect, test } from 'bun:test';
import { HSTS } from '@marklayer/brand';

// Asset-served pages skip the Worker's middleware, so this file is their only HSTS, and
// it cannot import the constant. Drift would quietly shorten the preload-list max-age.
test('public/_headers restates the HSTS the Worker sends', async () => {
  const headers = await Bun.file(new URL('../../public/_headers', import.meta.url)).text();
  expect(headers).toContain(`Strict-Transport-Security: ${HSTS}`);
});
