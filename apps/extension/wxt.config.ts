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
      'Free open-source webpage annotator. Mark up any page, share a link, no account needed. Hand feedback to AI agents via MCP.',
    version: '0.9.0',
    action: {},
    permissions: ['activeTab', 'scripting', 'contextMenus'],
  },
  hooks: {
    'build:manifestGenerated': (_, manifest) => {
      // Fix web_accessible_resources: set matches to <all_urls> so CSS loads on any tab
      for (const entry of manifest.web_accessible_resources ?? []) {
        if (typeof entry === 'object' && entry.matches?.length === 0) {
          entry.matches = ['<all_urls>'];
        }
      }
    },
  },
});
