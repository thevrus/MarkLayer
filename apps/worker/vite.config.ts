import { resolve } from 'node:path';
import { cloudflare } from '@cloudflare/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

/** `astro dev` in apps/site. Keep in sync with its dev port. */
const SITE_DEV_SERVER = { target: 'http://localhost:4321', changeOrigin: true };

export default defineConfig({
  plugins: [cloudflare(), tailwindcss()],
  resolve: {
    alias: {
      '@ext': resolve(__dirname, '../extension'),
      '@site': resolve(__dirname, '../site/src'),
      react: 'preact/compat',
      'react-dom': 'preact/compat',
    },
  },
  esbuild: {
    jsxFactory: 'h',
    jsxFragment: 'Fragment',
    jsxImportSource: 'preact',
    jsx: 'automatic',
  },
  publicDir: 'static',
  build: {
    outDir: 'public',
    emptyOutDir: true,
  },
  // Scoped to the `client` environment only: @cloudflare/vite-plugin builds
  // separate Worker environments (one per `wrangler.jsonc` entry) that share
  // the top-level `build` config, and those don't know what to do with an
  // HTML entry — a shared `build.rollupOptions.input` here breaks the Worker
  // build with "Entry module ... cannot be external".
  environments: {
    client: {
      build: {
        rollupOptions: {
          input: {
            main: resolve(__dirname, 'index.html'),
            doc: resolve(__dirname, 'doc.html'),
            app: resolve(__dirname, 'app.html'),
          },
        },
      },
    },
  },
  server: {
    // apps/site's shell hardcodes this origin (`WORKER_DEV` in src/lib/site.ts)
    // to borrow the stylesheet and SPA entry in dev. Vite's default is to bump
    // to the next free port when 5173 is taken, which leaves `/` on :4321
    // pointing at whatever still holds 5173 — usually a stale server from an
    // earlier session, answering with 500s. Fail loudly on the collision instead.
    port: 5173,
    strictPort: true,
    // In production these paths are prerendered files inside this Worker's asset
    // bundle (see scripts/embed-site.mjs), so the Worker never sees them. There
    // is no bundle in dev, so without this they fall through Hono to the
    // `proxy.all('*')` catch-all and 404. Forward them to `astro dev` instead,
    // which `turbo run dev` starts alongside this server.
    proxy: {
      '^/(compare|use-cases|about|privacy|404|sitemap\\.xml|pricing(\\.md)?)$': SITE_DEV_SERVER,
      '^/(vs|for|alternatives|guides)(/.*)?$': SITE_DEV_SERVER,
    },
  },
});
