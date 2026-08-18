#!/usr/bin/env node
/**
 * Publish marklayer-mcp, but only when its version is actually ahead of the
 * registry. A plain `npm publish` on an unchanged version exits 403 and would
 * fail the whole release for the common case where only the Worker changed.
 *
 * `--check` reports the plan without publishing, so a version or auth problem
 * surfaces before anything goes live: `node scripts/publish-if-new.mjs --check`.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const checkOnly = process.argv.includes('--check');

const abort = (message, hint) => {
  console.error(`publish — ${message}`);
  if (hint) console.error(`  ${hint}`);
  process.exit(1);
};

const readJson = (file) => JSON.parse(readFileSync(resolve(pkgRoot, file), 'utf8'));
const pkg = readJson('package.json');
const server = readJson('server.json');

if (!/^\d+\.\d+\.\d+$/.test(pkg.version)) {
  abort(
    `package.json version \`${pkg.version}\` is not a plain x.y.z release`,
    'This package does not ship prereleases; publish it by hand if that changes.',
  );
}

// server.json is the MCP registry manifest and carries the version twice. Either
// copy drifting publishes a manifest that points at a tarball nobody can install.
const manifestVersions = [server.version, ...server.packages.map((p) => p.version)];
const drifted = manifestVersions.filter((v) => v !== pkg.version);
if (drifted.length > 0) {
  abort(
    `server.json is out of sync with package.json (${pkg.version} vs ${[...new Set(drifted)].join(', ')})`,
    'Update server.json `version` and `packages[].version` to match.',
  );
}

/** -1 / 0 / 1 over x.y.z releases. */
const compare = (a, b) => {
  const [left, right] = [a.split('.').map(Number), b.split('.').map(Number)];
  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
  }
  return 0;
};

// Read the published version straight from the registry: unlike `npm view` this
// needs no auth, so an unchanged version stays a no-op even when logged out.
const response = await fetch(`https://registry.npmjs.org/${pkg.name}/latest`).catch((cause) => {
  abort(`could not reach the npm registry — ${cause.message}`);
});
if (!response.ok && response.status !== 404) {
  abort(`the npm registry answered ${response.status} for ${pkg.name}`);
}
const published = response.status === 404 ? null : (await response.json()).version;

if (published !== null) {
  const delta = compare(pkg.version, published);
  if (delta === 0) {
    console.log(`publish — ${pkg.name}@${pkg.version} is already on npm; nothing to do.`);
    process.exit(0);
  }
  if (delta < 0) {
    abort(
      `local ${pkg.name} is ${pkg.version} but npm already has ${published}`,
      'Bump package.json and server.json past the published version.',
    );
  }
}

const whoami = spawnSync('npm', ['whoami'], { encoding: 'utf8' });
if (whoami.status !== 0) {
  abort(
    `${pkg.name} ${pkg.version} is ready to publish, but npm is not authenticated`,
    'Run `npm login`, or set NPM_TOKEN, then run this again.',
  );
}

const transition = published === null ? `${pkg.version} (first publish)` : `${published} → ${pkg.version}`;
if (checkOnly) {
  console.log(`publish — will publish ${pkg.name} ${transition} as ${whoami.stdout.trim()}.`);
  process.exit(0);
}

console.log(`publish — ${pkg.name} ${transition}`);
const { status } = spawnSync('npm', ['publish', '--access', 'public'], { cwd: pkgRoot, stdio: 'inherit' });
process.exit(status ?? 1);
