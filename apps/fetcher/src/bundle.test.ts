import { expect, test } from 'bun:test';
import { dirname } from 'node:path';

const transpiler = new Bun.Transpiler({ loader: 'ts' });

/** Every module `file` reaches, following imports through workspace source. */
async function reach(file: string, seen = new Set<string>()): Promise<Set<string>> {
  if (seen.has(file)) return seen;
  seen.add(file);
  if (file.includes('/node_modules/')) return seen;
  for (const { path } of transpiler.scanImports(await Bun.file(file).text())) {
    if (!path.startsWith('node:')) await reach(Bun.resolveSync(path, dirname(file)), seen);
  }
  return seen;
}

// The Dockerfile links the workspace with no install, and CI builds no image, so a
// third-party import would pass every check here and fail only the next deploy.
test('the relay reaches nothing outside the workspace', async () => {
  const reached = await reach(Bun.resolveSync('./server.ts', import.meta.dir));
  expect([...reached].filter((file) => file.includes('/node_modules/'))).toEqual([]);
  expect(reached.size).toBeGreaterThan(3);
});
