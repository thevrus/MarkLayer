/**
 * Post-build checks for the prerendered marketing site.
 *
 * These pages carry the site's search rankings and are served straight from the
 * asset layer, so a bad internal link or a missing canonical ships silently —
 * `astro build` succeeds either way. Fail the build instead.
 */
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = resolve(dirname(fileURLToPath(import.meta.url)), '../dist');

/** Paths the Worker serves. They are valid link targets but never exist in dist. */
const WORKER_PATHS = new Set([
  '/',
  '/llms.txt',
  '/llms-full.txt',
  '/robots.txt',
  '/.well-known/api-catalog',
  '/.well-known/security.txt',
]);

const files = (await readdir(DIST, { recursive: true })).map((file) => file.replaceAll('\\', '/'));
const htmlFiles = files.filter((f) => f.endsWith('.html'));
const distSet = new Set(files.map((f) => f.split('\\').join('/')));

const errors = [];

const resolves = (path) => {
  if (WORKER_PATHS.has(path)) return true;
  const p = path.replace(/^\//, '');
  return distSet.has(p) || distSet.has(`${p}.html`) || distSet.has(`${p}/index.html`);
};

const MAX_TITLE = 60;
const MAX_DESCRIPTION = 160;

const decode = (s) =>
  s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(Number.parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

const STALE_RETENTION = /(?:cleaned up|persist(?:s)? for|deleted) 30 days/;

let linkCount = 0;
const indexable = new Set();

for (const file of htmlFiles) {
  const html = await readFile(join(DIST, file), 'utf8');
  const page = `/${file.replace(/\.html$/, '')}`;

  // 1. Every internal link resolves to something we actually ship.
  for (const [, raw] of html.matchAll(/href="([^"]+)"/g)) {
    const href = raw.replace(/&amp;/g, '&');
    if (/^(https?:|mailto:|#|data:)/.test(href)) continue;
    linkCount++;
    const path = href.split('#')[0].split('?')[0];
    if (path && !resolves(path)) errors.push(`${page}: broken internal link -> ${href}`);
  }

  // 2. Indexable pages need a canonical, a title and a meta description.
  const noindex = /name="robots"[^>]*content="[^"]*noindex/.test(html);
  if (!noindex) {
    indexable.add(page === '/index' ? '/' : page.replace(/\/index$/, ''));
    if (!/rel="canonical"/.test(html)) errors.push(`${page}: missing <link rel="canonical">`);
    if (!/<meta name="description"/.test(html)) errors.push(`${page}: missing meta description`);
    const title = decode(html.match(/<title>([^<]*)<\/title>/)?.[1]?.trim() ?? '');
    if (!title) errors.push(`${page}: missing <title>`);
    // Google truncates past these in the SERP; the cut usually lands on the claim.
    if (title.length > MAX_TITLE) errors.push(`${page}: title is ${title.length} chars (max ${MAX_TITLE})`);
    const description = decode(html.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? '');
    if (description.length > MAX_DESCRIPTION) {
      errors.push(`${page}: meta description is ${description.length} chars (max ${MAX_DESCRIPTION})`);
    }
  }

  // 3. Exactly one <h1>.
  const h1s = html.match(/<h1[\s>]/g)?.length ?? 0;
  if (h1s !== 1) errors.push(`${page}: expected exactly one <h1>, found ${h1s}`);

  // 4. Any JSON-LD block must parse.
  for (const [, block] of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try {
      JSON.parse(block);
    } catch (e) {
      errors.push(`${page}: invalid JSON-LD (${e.message})`);
    }
  }

  // 5. The retention window is a promise about deleting user data, and the cron
  //    in apps/worker/src/cron.ts is the source of truth (90 days from last
  //    access). A stale "30 days" here contradicts the product.
  if (STALE_RETENTION.test(html)) {
    errors.push(`${page}: claims a 30-day retention window; the cleanup cron deletes 90 days after last access`);
  }
}

// 6. `/` is the app shell. apps/worker's build stages it as its Vite entry, and
//    sync-shell.mjs is what refuses a shell without its mount point or entry script.
const shellHtml = distSet.has('index.html') ? await readFile(join(DIST, 'index.html'), 'utf8') : null;
if (shellHtml === null) errors.push('dist/index.html is missing; apps/worker has no app shell to build from');

// 7. The prerendered homepage must carry the same headline as the live one.
//
//    main.tsx clears #app on boot, so nobody with JS ever sees this markup and
//    drift goes unnoticed — it previously ran months out of date, serving
//    crawlers a headline the live page had stopped using. Both renderers now
//    read src/data/home-copy.json, so this only has to confirm the prerendered
//    markup really emitted it.
const copy = JSON.parse(await readFile(resolve(DIST, '../src/data/home-copy.json'), 'utf8'));
const headline = `${copy.headlinePrefix} ${copy.headlineJoiner} ${copy.headlineChannel} ${copy.headlineSuffix}`;

const shellH1 = shellHtml
  ?.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1]
  ?.replace(/<[^>]+>/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

// Skip when the shell is already missing — check 6 has reported the real problem.
if (shellHtml !== null && shellH1 !== headline) {
  errors.push(
    `homepage headline drift:\n      prerendered: ${JSON.stringify(shellH1)}\n      home-copy.json: ${JSON.stringify(headline)}`,
  );
}

// 8. Load-bearing claims must appear in the PRERENDERED markup, not just in
//    Landing.tsx. AI crawlers (GPTBot, PerplexityBot, ClaudeBot, CCBot) do not
//    execute JavaScript, so anything that lives only in the SPA is invisible to
//    exactly the engines these pages are written to be cited by. Checking the
//    h1 alone let the two homepages diverge on every other claim.
const SHELL_CLAIMS = [
  { label: 'retention window', re: /90 days after their last activity/ },
  { label: 'licence', re: /Apache-2\.0/ },
  { label: 'competitor pricing proof', re: /\$79\/month/ },
  { label: 'free-tools audit link', re: /\/guides\/free-website-annotation-tools/ },
];

if (shellHtml !== null) {
  for (const { label, re } of SHELL_CLAIMS) {
    if (!re.test(shellHtml)) {
      errors.push(
        `index.html is missing the ${label} claim (${re}).\n` +
          '      It must be in apps/site/src/components/home/HomeContent.astro — JS-only copy is invisible to AI crawlers.',
      );
    }
  }
}

// 9. No unfilled `{{word}}` placeholder reaches an agent. The Worker inlines
//    robots.txt and SKILL.md from source and llms*.txt from dist (apps/worker/src/agent-surface.ts),
//    so a placeholder the site build fills only in dist must never be read from source.
const SITE = resolve(DIST, '..');
const AGENT_TEXT = [
  'src/content/agent/robots.txt',
  'src/content/agent/SKILL.md',
  'dist/llms.txt',
  'dist/llms-full.txt',
  'dist/pricing.md',
];
const agentText = new Map(
  await Promise.all(AGENT_TEXT.map(async (rel) => [rel, await readFile(join(SITE, rel), 'utf8')])),
);
for (const [rel, text] of agentText) {
  for (const [placeholder] of text.matchAll(/\{\{\s*\w+\s*\}\}/g)) {
    errors.push(`${rel}: unfilled placeholder ${placeholder} would be served verbatim`);
  }
}

// 10. The sitemap lists every indexable page exactly once, and nothing else.
const sitemap = distSet.has('sitemap.xml') ? await readFile(join(DIST, 'sitemap.xml'), 'utf8') : '';
if (!sitemap) errors.push('dist/sitemap.xml is missing');
const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(([, loc]) => new URL(loc).pathname);
const locSet = new Set(locs);
for (const path of locSet) {
  if (locs.indexOf(path) !== locs.lastIndexOf(path)) errors.push(`sitemap.xml: duplicate <loc> ${path}`);
  if (!resolves(path)) errors.push(`sitemap.xml: <loc> ${path} does not resolve to a built page`);
  else if (!indexable.has(path)) {
    errors.push(`sitemap.xml: <loc> ${path} is not an indexable page`);
  }
}
for (const path of indexable) {
  if (!locSet.has(path)) errors.push(`sitemap.xml: indexable page ${path} is missing from the sitemap`);
}

// 11. Absolute links in the agent text resolve too. Agents follow these without
//     ever seeing an <a href>, so check 1 never reaches them.
//     The Worker serves the paths in wrangler.jsonc's `run_worker_first`, so those
//     are skipped: `/x/*` entries are prefixes, the rest exact. Read by regex, not
//     JSON.parse, because the file is JSONC and its comments hold `//` in URLs.
const wrangler = await readFile(resolve(SITE, '../worker/wrangler.jsonc'), 'utf8');
const workerFirst = [
  ...(wrangler.match(/"run_worker_first"\s*:\s*\[([^\]]*)\]/)?.[1] ?? '').matchAll(/"([^"]+)"/g),
].map(([, entry]) => entry);
if (workerFirst.length === 0) errors.push('wrangler.jsonc: could not read assets.run_worker_first');
const WORKER_EXACT = new Set(workerFirst.filter((e) => !e.endsWith('/*')));
const WORKER_PREFIXES = workerFirst.filter((e) => e.endsWith('/*')).map((e) => e.slice(0, -1));
// "/" is worker-first, so the bare origin is skipped; it resolves anyway.
for (const [rel, text] of agentText) {
  if (!rel.startsWith('dist/')) continue;
  for (const [, raw = ''] of text.matchAll(/https:\/\/marklayer\.app(\/[^\s)\]>"'`]*)?/g)) {
    const path = raw.replace(/[?#].*$/, '').replace(/[.,:;]+$/, '') || '/';
    if (WORKER_EXACT.has(path) || WORKER_PREFIXES.some((p) => path.startsWith(p))) continue;
    if (!resolves(path)) errors.push(`${rel}: broken absolute link -> https://marklayer.app${path}`);
  }
}

// 12. The extension's version needs a release note: the site reports the newest note
//     as `softwareVersion` and in llms.txt, so a bump without one leaves both behind.
const extensionVersion = JSON.parse(await readFile(resolve(SITE, '../extension/package.json'), 'utf8')).version;
const releaseVersions = await Promise.all(
  (await readdir(resolve(SITE, 'src/content/releases'))).map(async (file) => {
    const text = await readFile(resolve(SITE, 'src/content/releases', file), 'utf8');
    return text.match(/^version:\s*'?([\d.]+)'?/m)?.[1] ?? '0.0.0';
  }),
);
if (!releaseVersions.includes(extensionVersion)) {
  errors.push(`extension is ${extensionVersion} but no src/content/releases file carries that version`);
}

// 13. Every built page carries Cache-Control, or says in routes.json why it does not.
//     These pages skip the Worker, so nothing else sets it, and a page missing from
//     routes.json also falls through :5173's dev proxy into the Worker's catch-all.
const routes = JSON.parse(await readFile(resolve(SITE, 'src/data/routes.json'), 'utf8'));
const cacheRules = (await readFile(join(DIST, '_headers'), 'utf8'))
  .split(/\n(?=\S)/)
  .filter((rule) => /^\s+Cache-Control:/m.test(rule))
  .map((rule) => rule.split('\n')[0].trim());
const uncached = new Set(routes.uncached);
const served = [
  ...htmlFiles.map(
    (f) =>
      `/${f
        .split('\\')
        .join('/')
        .replace(/\.html$/, '')}`,
  ),
  ...files.filter((f) => /\.(md|xml)$/.test(f)).map((f) => `/${f}`),
];
for (const page of served) {
  if (page === '/index' || uncached.has(page)) continue;
  if (WORKER_EXACT.has(page) || WORKER_PREFIXES.some((p) => page.startsWith(p))) continue;
  const covered = cacheRules.some((r) => (r.endsWith('/*') ? page.startsWith(r.slice(0, -1)) : r === page));
  if (!covered) errors.push(`${page}: no Cache-Control rule; add it to src/data/routes.json`);
}

if (errors.length) {
  console.error(`\nverify-build — ${errors.length} problem(s):\n`);
  for (const e of errors) console.error(`  ${e}`);
  process.exit(1);
}

console.log(`verify-build — ${htmlFiles.length} pages, ${linkCount} internal links, all checks passed`);
