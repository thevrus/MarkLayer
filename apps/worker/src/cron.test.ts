import { describe, expect, test } from 'bun:test';

/** The schedule spans two files no compiler relates. Read both as text, rather
 *  than importing the Worker, which would pull the whole app in. */
const read = (file: string) => Bun.file(new URL(`../${file}`, import.meta.url)).text();

const cronsIn = (jsonc: string): string[] => {
  const arr = /"crons"\s*:\s*\[([^\]]*)\]/.exec(jsonc)?.[1];
  return arr ? [...arr.matchAll(/'([^']*)'|"([^"]*)"/g)].map((m) => m[1] ?? m[2] ?? '') : [];
};

async function retentionCron(): Promise<string> {
  const found = /RETENTION_CRON\s*=\s*'([^']+)'/.exec(await read('src/index.ts'))?.[1];
  if (!found) throw new Error('RETENTION_CRON is no longer a literal in src/index.ts');
  return found;
}

describe('cron schedule', () => {
  test('the expression the sweep branches on is one Cloudflare actually fires', async () => {
    const [config, retention] = await Promise.all([read('wrangler.jsonc'), retentionCron()]);
    expect(cronsIn(config)).toContain(retention);
  });

  test('a second expression exists to carry the demo reset', async () => {
    // `scheduled` resets the board only on a non-retention tick, so the
    // retention cron alone would leave the landing page's board never wiped.
    const [config, retention] = await Promise.all([read('wrangler.jsonc'), retentionCron()]);
    expect(cronsIn(config).filter((c) => c !== retention).length).toBeGreaterThan(0);
  });
});
