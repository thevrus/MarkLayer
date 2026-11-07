import { describe, expect, test } from 'bun:test';

const KERNEL = [
  'comment-meta',
  'guides',
  'host',
  'identity',
  'ops',
  'page-errors',
  'prefs',
  'presence',
  'realtime',
  'rename',
  'room',
  'room-id',
  'share',
  'storage',
  'tool-state',
  'ui-state',
];

describe('importing the kernel', () => {
  // A subprocess, because the test DOM preload is exactly what would hide a stray read.
  test('touches no document, location or storage until initHost', async () => {
    const script = `${KERNEL.map((m) => `await import('./lib/${m}');`).join('\n')}\nconsole.log('bare ok');`;
    const proc = Bun.spawn(['bun', '--no-install', '-e', script], {
      cwd: `${import.meta.dir}/..`,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    expect(stderr).toBe('');
    expect(code).toBe(0);
    expect(stdout).toContain('bare ok');
  });
});
