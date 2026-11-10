import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 截图入口在小组件中被替换为空组件；预留 64 字节给共享调用与演示状态协议。
const GZ_BUDGET = 103_872;

const FORBIDDEN = [
  // Identity in a customer's localStorage: a visitor's is one page load long.
  'ml-username',
  'ml-usercolor',
  'ml-clientid',
  // Extension and fx code that only reaches the bundle through a capability it must not have.
  'browser.runtime',
  'createOscillator',
  'idb-keyval',
];

describe('the widget bundle', () => {
  const out = mkdtempSync(join(tmpdir(), 'marklayer-widget-'));
  let app = '';

  beforeAll(async () => {
    const proc = Bun.spawn(['bun', 'widget/build.ts', out], {
      cwd: join(import.meta.dir, '..'),
      // `bun test` sets NODE_ENV=test, which would measure a build nobody ships.
      env: { ...process.env, NODE_ENV: 'production' },
      stdout: 'ignore',
      stderr: 'pipe',
    });
    const [stderr, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
    if (code !== 0) throw new Error(`widget build failed:\n${stderr}`);
    const file = readdirSync(join(out, 'widget')).find((f) => f.startsWith('app-'));
    if (!file) throw new Error('widget build wrote no app chunk');
    app = readFileSync(join(out, 'widget', file), 'utf8');
  }, 60_000);

  afterAll(() => rmSync(out, { recursive: true, force: true }));

  test('stays in budget', () => {
    expect(Bun.gzipSync(app).length).toBeLessThanOrEqual(GZ_BUDGET);
  });

  test('scopes Tailwind to the widget graph', () => {
    // `cursor-move` is used only by InspectorLayer; `animate-spin` by CommentPinCard, which ships.
    expect(app).toContain('.animate-spin');
    expect(app).not.toContain('.cursor-move');
  });

  test.each(FORBIDDEN)('carries no %s', (needle) => {
    expect(app).not.toContain(needle);
  });
});
