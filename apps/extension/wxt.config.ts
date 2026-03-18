import preact from '@preact/preset-vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';

export default defineConfig({
  vite: () => ({
    plugins: [preact(), tailwindcss()],
  }),
  manifest: {
    name: 'MarkLayer',
    description: 'Mark up any website with comments, drawings, and more',
    version: '0.1.0',
    action: {},
  },
});
