import { describe, expect, test } from 'bun:test';

import { RETENTION_CRON } from './cron';

/** The schedule spans a constant and a JSONC file no compiler relates. Read the config as text. */
const read = (file: string) => Bun.file(new URL(`../${file}`, import.meta.url)).text();

const cronsIn = (jsonc: string): string[] => {
  const arr = /"crons"\s*:\s*\[([^\]]*)\]/.exec(jsonc)?.[1];
  return arr ? [...arr.matchAll(/'([^']*)'|"([^"]*)"/g)].map((m) => m[1] ?? m[2] ?? '') : [];
};

describe('cron schedule', () => {
  test('the expression the sweep branches on is one Cloudflare actually fires', async () => {
    const config = await read('wrangler.jsonc');
    expect(cronsIn(config)).toContain(RETENTION_CRON);
  });

  test('a second expression exists to carry the demo reset', async () => {
    // `scheduled` resets the board only on a non-retention tick, so the
    // retention cron alone would leave the landing page's board never wiped.
    const config = await read('wrangler.jsonc');
    expect(cronsIn(config).filter((c) => c !== RETENTION_CRON).length).toBeGreaterThan(0);
  });
});
