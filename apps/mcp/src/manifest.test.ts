import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const pkg = JSON.parse(read('package.json'));
const server = JSON.parse(read('server.json'));
const cli = read('src/cli.ts');

describe('server.json (MCP registry manifest)', () => {
  test('names and versions follow package.json', () => {
    expect(server.name).toBe(pkg.mcpName);
    expect(server.version).toBe(pkg.version);
    for (const p of server.packages) {
      expect(p.identifier).toBe(pkg.name);
      expect(p.version).toBe(pkg.version);
    }
  });

  test('lists every environment variable and flag the CLI reads', () => {
    const [entry] = server.packages;
    const envs = new Set(entry.environmentVariables.map((e: { name: string }) => e.name));
    const flags = new Set(entry.packageArguments.map((a: { name: string }) => a.name));
    for (const [, name] of cli.matchAll(/process\.env\.(MARKLAYER_\w+)/g)) expect(envs.has(name)).toBe(true);
    for (const [, name] of cli.matchAll(/a === '(--(?!help)[\w-]+)'/g)) expect(flags.has(name)).toBe(true);
  });
});
