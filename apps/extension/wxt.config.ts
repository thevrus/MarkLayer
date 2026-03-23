import preact from '@preact/preset-vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';

export default defineConfig({
  vite: () => ({
    plugins: [preact(), tailwindcss()],
  }),
  manifest: {
    name: 'MarkLayer — Webpage Annotator & Visual Feedback Tool',
    description:
      'MarkLayer is a free webpage annotation tool for Chrome. Draw, comment, and mark up any live website — then share a link so anyone can see your annotations instantly. No account required.',
    version: '0.2.0',
    action: {},
    permissions: ['activeTab', 'scripting'],
  },
  hooks: {
    'build:manifestGenerated': (_, manifest) => {
      // Fix web_accessible_resources: set matches to <all_urls> so CSS loads on any tab
      for (const entry of manifest.web_accessible_resources ?? []) {
        if (typeof entry === 'object' && entry.matches?.length === 0) {
          entry.matches = ['<all_urls>'];
        }
      }
      // Remove empty host_permissions WXT may auto-generate
      delete (manifest as Record<string, unknown>).host_permissions;
    },
  },
});
