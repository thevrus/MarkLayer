/**
 * Append the per-route Cache-Control rules from src/data/routes.json to dist/_headers.
 *
 * public/_headers keeps the rules with no route behind them. Cloudflare comma-joins a
 * header set by two matching rules, so `/*` must never carry Cache-Control: that is also
 * what keeps the SPA shell at `/` from inheriting a one-hour max-age.
 */
import { appendFile, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HOUR = 'public, max-age=3600';
const DAY = 'public, max-age=86400';

const routes = JSON.parse(await readFile(join(SITE, 'src/data/routes.json'), 'utf8'));

const rule = ({ path, cache, type }) =>
  `${path}\n  Cache-Control: ${cache}\n${type ? `  Content-Type: ${type}\n` : ''}`;

const rules = [
  ...routes.pages.map((path) => rule({ path, cache: HOUR })),
  ...routes.trees.map((path) => rule({ path: `${path}/*`, cache: HOUR })),
  ...Object.entries(routes.documents).map(([path, type]) => rule({ path, cache: DAY, type })),
];

await appendFile(join(SITE, 'dist/_headers'), `\n${rules.join('\n')}`);
console.log(`emit-headers — ${rules.length} route rules appended to dist/_headers`);
