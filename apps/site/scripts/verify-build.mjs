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

const files = await readdir(DIST, { recursive: true });
const htmlFiles = files.filter((f) => f.endsWith('.html'));
const distSet = new Set(files.map((f) => f.split('\\').join('/')));

const errors = [];

const resolves = (path) => {
  if (WORKER_PATHS.has(path)) return true;
  const p = path.replace(/^\//, '');
  return distSet.has(p) || distSet.has(`${p}.html`) || distSet.has(`${p}/index.html`);
};

const STALE_RETENTION = /(?:cleaned up|persist(?:s)? for|deleted) 30 days/;

let linkCount = 0;

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
    if (!/rel="canonical"/.test(html)) errors.push(`${page}: missing <link rel="canonical">`);
    if (!/<meta name="description"/.test(html)) errors.push(`${page}: missing meta description`);
    const title = html.match(/<title>([^<]*)<\/title>/)?.[1]?.trim();
    if (!title) errors.push(`${page}: missing <title>`);
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
  //    in apps/worker/src/index.ts is the source of truth (90 days from last
  //    access). A stale "30 days" here contradicts the product.
  if (STALE_RETENTION.test(html)) {
    errors.push(`${page}: claims a 30-day retention window; the cleanup cron deletes 90 days after last access`);
  }
}

// 6. `/` is the app shell. apps/worker's build stages it as its Vite entry
//    (sync-shell.mjs), so the mount point and the entry script must survive.
const shellHtml = distSet.has('index.html') ? await readFile(join(DIST, 'index.html'), 'utf8') : null;
if (shellHtml === null) {
  errors.push('dist/index.html is missing; apps/worker has no app shell to build from');
} else {
  if (!shellHtml.includes('id="app"')) errors.push('index.html has no #app mount point; main.tsx would throw on boot');
  if (!shellHtml.includes('src="/web/main.tsx"')) {
    errors.push('index.html has no /web/main.tsx entry script; Vite would emit a shell that never boots the SPA');
  }
}

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

if (errors.length) {
  console.error(`\nverify-build — ${errors.length} problem(s):\n`);
  for (const e of errors) console.error(`  ${e}`);
  process.exit(1);
}

console.log(`verify-build — ${htmlFiles.length} pages, ${linkCount} internal links, all checks passed`);
