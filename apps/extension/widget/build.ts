/**
 * Builds the embeddable widget into the worker's asset output:
 *   widget.js           the loader site owners paste (short cache, stable URL)
 *   widget/app-<hash>.js the comment-only overlay it imports (immutable)
 *
 * Run by apps/worker's build after `vite build` + `embed:site`, since `vite build`
 * empties public/ and embed:site supplies the _headers this appends to.
 * Usage: bun widget/build.ts [outDir]
 */
import { appendFile, readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import preact from '@preact/preset-vite';
import tailwindcss from '@tailwindcss/vite';
import { build, type Plugin, type Rolldown } from 'vite';

const extRoot = resolve(import.meta.dir, '..');
const outDir = resolve(process.argv[2] ?? join(extRoot, '../worker/public/client'));
const normalizePath = (path: string) => path.replaceAll('\\', '/');
// The bundler writes `//#region` paths relative to cwd into the output, so the chunk
// hash would otherwise depend on which workspace launched the build.
process.chdir(extRoot);
/**
 * Shared modules the widget replaces, purely for size: each drops Base UI (Menu,
 * Popover, Drawer), which was most of its bundle. Correctness is not a swap: origin,
 * storage, drafts and capture are `initHost` config in app.tsx. Matched by resolved
 * path so no shared file needs a widget branch. Each stand-in is typed against the
 * module it replaces, so a drifted signature fails tsc.
 */
const SWAPS = new Map([
  [join(extRoot, 'components/CommentTriage.tsx'), join(import.meta.dir, 'lite/CommentTriage.tsx')],
  [join(extRoot, 'components/MentionTextarea.tsx'), join(import.meta.dir, 'lite/MentionTextarea.tsx')],
  [join(extRoot, 'components/Reactions.tsx'), join(import.meta.dir, 'lite/Reactions.tsx')],
  [join(extRoot, 'components/BottomSheet.tsx'), join(import.meta.dir, 'lite/BottomSheet.tsx')],
  [join(extRoot, 'lib/icons.tsx'), join(import.meta.dir, 'lite/icons.tsx')],
  [join(extRoot, 'lib/agents.tsx'), join(import.meta.dir, 'lite/agents.tsx')],
  [join(extRoot, 'components/VideoNote.tsx'), join(import.meta.dir, 'lite/VideoNote.tsx')],
  [join(extRoot, 'components/PriorityMenu.tsx'), join(import.meta.dir, 'lite/PriorityMenu.tsx')],
  [join(extRoot, 'components/Tooltip.tsx'), join(import.meta.dir, 'lite/Tooltip.tsx')],
  [join(extRoot, 'components/ScreenCapture.tsx'), join(import.meta.dir, 'lite/ScreenCapture.tsx')],
  [join(extRoot, 'components/BatchSwitch.tsx'), join(import.meta.dir, 'lite/BatchSwitch.tsx')],
].map(([from, to]) => [normalizePath(from!), to!] as [string, string]));

const swapModules: Plugin = {
  name: 'marklayer-widget-swaps',
  enforce: 'pre',
  async resolveId(source, importer, options) {
    const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
    return (resolved && SWAPS.get(normalizePath(resolved.id))) ?? null;
  },
};

const stylesheet = join(extRoot, 'entrypoints/content/style.css');

/**
 * Tailwind would otherwise scan the whole extension and inline every tool's classes.
 * Given the bundle's own module graph, the stylesheet sees exactly those files.
 */
const scopeTailwind = (sources: string[]): Plugin => ({
  name: 'marklayer-widget-tailwind-sources',
  enforce: 'pre',
  transform(code, id) {
    if (normalizePath(id.split('?')[0] ?? '') !== normalizePath(stylesheet)) return null;
    const scoped = sources.map((file) => `@source "${normalizePath(relative(dirname(stylesheet), file))}";`).join('\n');
    return code.replace('@import "tailwindcss";', `@import "tailwindcss" source(none);\n${scoped}`);
  },
});

async function buildApp({ sources, write }: { sources?: string[]; write: boolean }) {
  const output = await build({
    configFile: false,
    root: extRoot,
    logLevel: 'warn',
    plugins: [swapModules, ...(sources ? [scopeTailwind(sources)] : []), preact(), tailwindcss()],
    // Lib mode leaves `process.env` alone, and Preact branches on it.
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    build: {
      outDir,
      write,
      emptyOutDir: false,
      copyPublicDir: false,
      minify: true,
      lib: { entry: join(import.meta.dir, 'app.tsx'), formats: ['es'] },
      rolldownOptions: {
        output: { entryFileNames: 'widget/app-[hash].js', codeSplitting: false },
      },
    },
  });
  const results: Rolldown.RolldownOutput[] = Array.isArray(output) ? output : 'output' in output ? [output] : [];
  const chunk = results
    .flatMap((r) => r.output)
    .find((c): c is Rolldown.OutputChunk => c.type === 'chunk' && c.isEntry);
  if (!chunk) throw new Error('widget build: the app bundle produced no entry chunk');
  return chunk;
}

const probe = await buildApp({ write: false });
const sources = Object.keys(probe.modules)
  .map((id) => normalizePath(id.split('?')[0] ?? id))
  .filter((file) => /\.(tsx?|jsx?|mjs)$/.test(file) && !file.includes('/node_modules/'));
if (!Object.values(probe.modules).some((m) => m.renderedExports.includes('CommentPin'))) {
  throw new Error('widget build: module graph looks wrong, refusing to scope Tailwind to it');
}
const entry = await buildApp({ sources, write: true });

const loader = await Bun.build({
  entrypoints: [join(import.meta.dir, 'loader.ts')],
  format: 'iife',
  minify: true,
  target: 'browser',
  define: { __WIDGET_APP__: JSON.stringify(`/${entry.fileName}`) },
});
const [loaderJs] = loader.outputs;
if (!loader.success || !loaderJs) throw new Error(`widget build: loader failed\n${loader.logs.join('\n')}`);
await Bun.write(join(outDir, 'widget.js'), loaderJs);

// widget.js is the URL owners paste, so a fix has to reach them within minutes;
// the app is content-addressed. It is imported as a module, cross-origin, hence CORS.
const HEADERS = `
# Embeddable widget (apps/extension/widget/build.ts)
/widget.js
  Cache-Control: public, max-age=300

/widget/*
  Cache-Control: public, max-age=31536000, immutable
  Access-Control-Allow-Origin: *
`;
const headersPath = join(outDir, '_headers');
const existing = await readFile(headersPath, 'utf8').catch(() => '');
if (!existing.includes('/widget.js')) await appendFile(headersPath, HEADERS);

console.log(`widget — widget.js + ${entry.fileName} → ${outDir}`);
