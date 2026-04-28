import { resolve } from 'node:path';
import { cloudflare } from '@cloudflare/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [cloudflare(), tailwindcss()],
  resolve: {
    alias: {
      '@ext': resolve(__dirname, '../extension'),
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
});
