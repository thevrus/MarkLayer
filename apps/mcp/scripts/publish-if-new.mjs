#!/usr/bin/env node
/**
 * Publish marklayer-mcp, but only when its version is actually ahead of the
 * registry. A plain `npm publish` on an unchanged version exits 403 and would
 * fail the whole release for the common case where only the Worker changed.
 *
 * Publishing has two halves: the npm tarball, and the MCP registry entry that
 * agent directories read. They drifted once already (npm at 0.1.2, the registry
 * empty), so both run here and the script is re-runnable: each half is a no-op
 * when it is already current, so a failure in the second can be retried without
 * republishing the first.
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

const MCP_REGISTRY = 'https://registry.modelcontextprotocol.io';

/** The version the MCP registry serves for this server, or null when it has never heard of it. */
const mcpRegistryVersion = async () => {
  const url = `${MCP_REGISTRY}/v0/servers?search=${encodeURIComponent(server.name)}`;
  const res = await fetch(url).catch((cause) => abort(`could not reach the MCP registry — ${cause.message}`));
  if (!res.ok) abort(`the MCP registry answered ${res.status} for ${server.name}`);
  const body = await res.json();
  // The list shape has moved between registry revisions; accept either an entry
  // carrying the fields directly or one nesting them under `server`.
  const entries = Array.isArray(body.servers) ? body.servers : [];
  const mine = entries.map((e) => e.server ?? e).find((e) => e?.name === server.name);
  return mine?.version ?? null;
};

/**
 * Push server.json to the MCP registry. Returns a short status string, or aborts
 * when the publisher is missing or unauthenticated — npm has already shipped by
 * then, and re-running the script skips npm and retries just this step.
 */
const publishToMcpRegistry = () => {
  const result = spawnSync('mcp-publisher', ['publish'], { cwd: pkgRoot, stdio: 'inherit' });
  if (result.error?.code === 'ENOENT') {
    abort(
      'mcp-publisher is not installed, so the MCP registry entry was not updated',
      'brew install mcp-publisher (or see github.com/modelcontextprotocol/registry), then `mcp-publisher login github` and re-run this script.',
    );
  }
  if (result.status !== 0) {
    abort(
      'mcp-publisher failed, so the MCP registry entry was not updated',
      'Run `mcp-publisher login github` as the io.github.thevrus namespace owner, then re-run this script.',
    );
  }
};

// Read the published version straight from the registry: unlike `npm view` this
// needs no auth, so an unchanged version stays a no-op even when logged out. The
// two registries have nothing to say to each other, so ask them at once.
const [registryVersion, response] = await Promise.all([
  mcpRegistryVersion(),
  fetch(`https://registry.npmjs.org/${pkg.name}/latest`).catch((cause) => {
    abort(`could not reach the npm registry — ${cause.message}`);
  }),
]);
if (!response.ok && response.status !== 404) {
  abort(`the npm registry answered ${response.status} for ${pkg.name}`);
}
const published = response.status === 404 ? null : (await response.json()).version;

if (published !== null && compare(pkg.version, published) < 0) {
  abort(
    `local ${pkg.name} is ${pkg.version} but npm already has ${published}`,
    'Bump package.json and server.json past the published version.',
  );
}

// Each registry is decided on its own: npm can already be current while the MCP
// registry lags behind it, which is exactly what happens when a publish half-fails.
const npmNeeded = published === null || compare(pkg.version, published) > 0;
const mcpNeeded = registryVersion !== pkg.version;

if (!npmNeeded && !mcpNeeded) {
  console.log(`publish — ${pkg.name}@${pkg.version} is already on npm and in the MCP registry; nothing to do.`);
  process.exit(0);
}

// Only an npm publish needs credentials, so only ask for them when one is due.
let publisher = null;
if (npmNeeded) {
  const whoami = spawnSync('npm', ['whoami'], { encoding: 'utf8' });
  if (whoami.status !== 0) {
    abort(
      `${pkg.name} ${pkg.version} is ready to publish, but npm is not authenticated`,
      'Run `npm login`, or set NPM_TOKEN, then run this again.',
    );
  }
  publisher = whoami.stdout.trim();
}

const from = (current) => (current === null ? `${pkg.version} (first publish)` : `${current} → ${pkg.version}`);
const plan = [
  npmNeeded
    ? `will publish ${pkg.name} ${from(published)} to npm as ${publisher}`
    : `${pkg.name}@${pkg.version} is already on npm`,
  mcpNeeded
    ? `will publish ${server.name} ${from(registryVersion)} to the MCP registry`
    : `the MCP registry is on ${pkg.version} already`,
];
for (const line of plan) console.log(`publish — ${line}`);
if (checkOnly) process.exit(0);

if (npmNeeded) {
  const { status } = spawnSync('npm', ['publish', '--access', 'public'], { cwd: pkgRoot, stdio: 'inherit' });
  if (status !== 0) process.exit(status ?? 1);
}
if (mcpNeeded) publishToMcpRegistry();
console.log(`publish — ${pkg.name} ${pkg.version} is live on npm and in the MCP registry.`);
