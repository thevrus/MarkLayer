/**
 * Copy apps/site's prerendered pages into this Worker's client asset output.
 *
 * Runs after `vite build`, which empties `public/`.
 *
 * `index.html` is deliberately excluded: apps/site owns the shell's source, but
 * the copy Vite produced is the one that boots the app. The guards below fail
 * the build rather than let a shell ship that renders marketing with no SPA
 * behind it — a failure that leaves every other page looking green.
 */
import { cp, readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const workerRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const siteDist = resolve(workerRoot, '../site/dist');
const clientDir = join(workerRoot, 'public/client');

const exists = async (p) => {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
};

if (!(await exists(siteDist))) {
  console.error(
    `embed:site — apps/site has not been built (${siteDist} is missing).\n` +
      'Run `turbo run build` so the site builds first.',
  );
  process.exit(1);
}

if (!(await exists(clientDir))) {
  console.error(`embed:site — ${clientDir} is missing; expected \`vite build\` to have run first.`);
  process.exit(1);
}

// `/` is the one page apps/site does NOT hand over directly. Its index.html is
// the *source* shell (see sync-shell.mjs); the copy in public/client is the same
// document after Vite rewrote /web/main.tsx into the hashed bundle and injected
// the stylesheet. Copying the raw one over it would ship a page that never boots.
const builtShell = join(clientDir, 'index.html');
const shellHtml = (await exists(builtShell)) ? await readFile(builtShell, 'utf8') : '';
if (!shellHtml) {
  console.error('embed:site — public/client/index.html is missing; Vite did not process the shell.');
  process.exit(1);
}
if (shellHtml.includes('/web/main.tsx')) {
  console.error(
    'embed:site — public/client/index.html still references /web/main.tsx.\n' +
      'Vite did not rewrite the entry, so the SPA would 404 on boot and `/` would\n' +
      'render prerendered marketing with no app behind it.',
  );
  process.exit(1);
}

await cp(siteDist, clientDir, { recursive: true, filter: (src) => src !== join(siteDist, 'index.html') });
const pages = (await readdir(siteDist, { recursive: true })).filter((f) => f.endsWith('.html') && f !== 'index.html');
console.log(`embed:site — copied ${pages.length} prerendered pages into public/client (shell handled by Vite)`);
