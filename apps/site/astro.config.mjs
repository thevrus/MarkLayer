// @ts-check

import { unified } from '@astrojs/markdown-remark';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';
import rehypeExternalLinks from 'rehype-external-links';
import { WORKER_DEV } from './src/lib/site';

export default defineConfig({
  site: 'https://marklayer.app',
  output: 'static',

  // The Worker serves these pages today at extensionless, trailing-slash-free
  // URLs (`/vs/markup-io`). `format: 'file'` emits `vs/markup-io.html`, which
  // Workers' default `auto-trailing-slash` handling serves at exactly that URL.
  // The default `format: 'directory'` would emit `vs/markup-io/index.html` and
  // move every page to `/vs/markup-io/` — 30 redirects and a needless
  // reshuffle of established rankings.
  build: { format: 'file' },
  trailingSlash: 'never',

  // No integrations: every page here is static HTML with zero client JS. `/` is
  // the app shell — the SPA bundle is built by apps/worker, not here. See
  // docs/adr/0002 for why the app cannot be prerendered as a Preact island.

  markdown: {
    // Mirrors linkifyFirst() in the old renderer, which opened competitor links
    // in a new tab with noopener/noreferrer.
    //
    // Astro 7 defaults to the Rust Sätteri processor, whose `hastPlugins` hook
    // does not accept unified/rehype plugins (verified: the attributes were
    // silently dropped). The content here is 30 short intro paragraphs, so the
    // unified pipeline's extra ~100ms is not worth hand-rolling a Sätteri
    // equivalent.
    // The old renderer emitted the author's straight quotes verbatim, and the
    // .astro templates still do. Leaving smart punctuation on would curl quotes
    // in Markdown bodies only, so the same page would mix ' and ’.
    processor: unified({
      smartypants: false,
      rehypePlugins: [[rehypeExternalLinks, { target: '_blank', rel: ['noopener', 'noreferrer'] }]],
    }),
  },

  vite: {
    plugins: [tailwindcss()],
    // The middleware below redirects anything this site 404s to the Worker, which
    // is right for a navigation but loses a request body: a 302 downgrades POST
    // to GET, and Astro hands middleware a bodyless stub request for prerendered
    // routes anyway, so it cannot forward one itself. These are proxied at the
    // dev server instead, where the body is still intact.
    server: { proxy: { '^/(f|api)(/.*)?$': { target: WORKER_DEV, changeOrigin: true } } },
  },
});
