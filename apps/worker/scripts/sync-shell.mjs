/**
 * Pull the app shell that apps/site prerendered into this Worker's Vite entry.
 *
 * `/` is owned by apps/site (src/pages/index.astro): it carries the head meta,
 * the JSON-LD @graph and the prerendered marketing content. Vite still has to
 * process the document so it can rewrite `/web/main.tsx` into the hashed bundle
 * and inject the stylesheet link, and Vite processes its HTML entry from its own
 * root — so the built shell is copied into place here first.
 *
 * apps/worker/index.html is therefore a build artifact, not source. Edit
 * apps/site/src/pages/index.astro instead.
 */
import { copyFile, readFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const workerRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const shell = resolve(workerRoot, '../site/dist/index.html');
const dest = join(workerRoot, 'index.html');

try {
  await stat(shell);
} catch {
  console.error(
    `sync-shell — ${shell} is missing.\n` +
      'apps/site must build first. Run `turbo run build`, which orders it via the\n' +
      'workspace dependency, rather than calling `vite build` directly.',
  );
  process.exit(1);
}

const html = await readFile(shell, 'utf8');

// Vite rewrites this into the hashed bundle. Without it the shell would ship
// as a static page and the app would never boot.
if (!html.includes('src="/web/main.tsx"')) {
  console.error(
    'sync-shell — the prerendered shell has no <script src="/web/main.tsx">.\n' +
      'Vite would emit an index.html that never loads the SPA, so `/`, and the\n' +
      'Viewer handoff from `?url=`, would render static marketing and nothing else.\n' +
      'Check the entry <script> in apps/site/src/pages/index.astro is `is:inline`.',
  );
  process.exit(1);
}

if (!html.includes('id="app"')) {
  console.error('sync-shell — the prerendered shell has no #app mount point; main.tsx would throw on boot.');
  process.exit(1);
}

await copyFile(shell, dest);
console.log(`sync-shell — app shell from apps/site (${(html.length / 1024).toFixed(1)} KB) staged as the Vite entry`);
